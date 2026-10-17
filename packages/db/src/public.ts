import pg from 'pg';
import type {
  PublicQuery,
  PublicDetail,
  PublicGif,
  ReviewVariant,
} from '@gif/contracts';
import { assertReviewVariants, loadReviewVariants } from './review.js';
import {
  createPublicCursor,
  mediaUnavailable,
  publicNotFound,
} from './public-cursor.js';
export { PublicFault, createPublicCursor } from './public-cursor.js';

// Authoritative gates shared by list, detail and every origin authorization check.
const policy = `a.kind='GIF' AND a.rights_attested_at IS NOT NULL AND a.rights_attestation_version='v1'
  AND s.upload_state='RECEIVED' AND s.processing_state='SUCCEEDED'
  AND s.moderation_state='APPROVED' AND s.visibility_state='PUBLIC'
  AND s.search_eligibility_state='ELIGIBLE' AND s.indexing_state='INDEXED'
  AND s.api_availability_state='ENABLED' AND s.delivery_readiness_state='READY'`;
const from = 'FROM assets a JOIN asset_states s ON s.asset_id=a.id';
const fields = `a.id,a.title,a.description,a.owner_id AS "ownerId",
  to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
  ARRAY(SELECT t.slug FROM asset_tags at JOIN tags t ON t.id=at.tag_id WHERE at.asset_id=a.id ORDER BY t.slug) AS tags`;
interface Row {
  id: string;
  title: string;
  description: string | null;
  ownerId: string;
  createdAt: string;
  tags: string[];
  rank: number;
}
function item(row: Row): PublicGif {
  return {
    id: row.id,
    title: row.title,
    tags: row.tags,
    creator: {
      id: row.ownerId,
      displayName: `Creator ${row.ownerId.slice(0, 8)}`,
    },
    createdAt: row.createdAt,
    posterUrl: `/media/${row.id}/poster.png`,
    displayUrl: `/media/${row.id}/display.gif`,
  };
}
export function createPublicRepository(
  connectionString: string,
  cursorSecret: string,
) {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 1500,
    query_timeout: 5500,
    statement_timeout: 5000,
  });
  pool.on('error', () => {});
  const cursors = createPublicCursor(cursorSecret);
  const repository = {
    async list(input: PublicQuery) {
      const position = input.cursor
        ? cursors.decode(input.cursor, input.q, input.tag)
        : null;
      const result = await pool.query<Row>(
        `WITH candidates AS (SELECT ${fields},
        CASE WHEN $1='' THEN 0::real ELSE ts_rank(sd.search_vector,websearch_to_tsquery('simple',$1)) END AS rank
        ${from} JOIN search_documents sd ON sd.asset_id=a.id WHERE ${policy}
        AND ($1='' OR sd.search_vector @@ websearch_to_tsquery('simple',$1))
        AND ($2::text IS NULL OR EXISTS(SELECT 1 FROM asset_tags at JOIN tags t ON t.id=at.tag_id WHERE at.asset_id=a.id AND t.slug=$2)))
        SELECT * FROM candidates WHERE ($3::real IS NULL OR (rank,"createdAt"::timestamptz,id)<($3::real,$4::timestamptz,$5::uuid))
        ORDER BY rank DESC,"createdAt"::timestamptz DESC,id DESC LIMIT $6`,
        [
          input.q,
          input.tag ?? null,
          position?.rank ?? null,
          position?.createdAt ?? null,
          position?.id ?? null,
          input.limit + 1,
        ],
      );
      const rows = result.rows.slice(0, input.limit);
      const last = rows.at(-1);
      return {
        items: rows.map(item),
        ...(result.rows.length > input.limit && last
          ? {
              nextCursor: cursors.encode(
                { rank: last.rank, createdAt: last.createdAt, id: last.id },
                input.q,
                input.tag,
              ),
            }
          : {}),
      };
    },
    async detail(id: string): Promise<PublicDetail> {
      const row = (
        await pool.query<Row>(
          `SELECT ${fields} ${from} WHERE a.id=$1 AND ${policy}`,
          [id],
        )
      ).rows[0];
      if (!row) throw publicNotFound();
      const value = item(row);
      return {
        ...value,
        description: row.description,
        attribution: value.creator.displayName,
      };
    },
    async authorize(id: string) {
      if (
        !(
          await pool.query(`SELECT 1 ${from} WHERE a.id=$1 AND ${policy}`, [id])
        ).rowCount
      )
        throw publicNotFound();
    },
    async media(
      id: string,
      alias: 'display.gif' | 'poster.png',
      requestId: string,
    ) {
      // UUID spelling must not turn valid lowercase descriptors into false degradation.
      id = id.toLowerCase();
      await repository.authorize(id);
      const values = await loadReviewVariants(pool, id);
      try {
        assertReviewVariants(id, values);
      } catch {
        await repository.degrade(id, values, requestId);
        throw mediaUnavailable();
      }
      return {
        value: values.find(
          (v) =>
            v.name === (alias === 'display.gif' ? 'DISPLAY_GIF' : 'POSTER_PNG'),
        )!,
        values,
      };
    },
    async degrade(id: string, observed: ReviewVariant[], requestId: string) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Match moderation's asset-first lock order. Never overwrite a newer generation or a takedown.
        await client.query('SELECT id FROM assets WHERE id=$1 FOR UPDATE', [
          id,
        ]);
        const eligible = await client.query(
          `SELECT 1 ${from} WHERE a.id=$1 AND ${policy} FOR UPDATE OF s`,
          [id],
        );
        const current = await loadReviewVariants(client, id);
        const fingerprint = (values: ReviewVariant[]) =>
          JSON.stringify(
            [...values].sort((a, b) => a.name.localeCompare(b.name)),
          );
        if (
          eligible.rowCount &&
          fingerprint(current) === fingerprint(observed)
        ) {
          await client.query(
            "UPDATE asset_states SET delivery_readiness_state='DEGRADED',state_updated_at=now() WHERE asset_id=$1",
            [id],
          );
          await client.query(
            'UPDATE assets SET row_version=row_version+1,updated_at=now() WHERE id=$1',
            [id],
          );
          await client.query(
            'INSERT INTO audit_events(asset_id,event_type,request_id,metadata) VALUES($1,\'DELIVERY_DEGRADED\',$2,\'{"reason":"DERIVATIVE_UNAVAILABLE"}\')',
            [id, requestId],
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
  return { repository, close: () => pool.end() };
}
export type PublicRepository = ReturnType<
  typeof createPublicRepository
>['repository'];
