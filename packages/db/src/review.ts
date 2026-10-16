import pg, { type PoolClient } from 'pg';
import {
  decisionRequestSchema,
  removalRequestSchema,
  type ReviewDecision,
  type ReviewRemoval,
  type ReviewResult,
  type ReviewDetail,
  type ReviewItem,
  type ReviewVariant,
} from '@gif/contracts';
import { transitionMediaState, type MediaState } from '@gif/domain';

export class ReviewFault extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const conflict = () =>
  new ReviewFault(
    409,
    'STATE_CONFLICT',
    'Asset changed or review prerequisites are not satisfied. Reload before deciding.',
  );
const notFound = () =>
  new ReviewFault(404, 'NOT_FOUND', 'Review asset not found');
const selection = `SELECT a.id AS "assetId",a.title,a.owner_id AS "ownerId",a.row_version AS "rowVersion",
  a.kind,(a.rights_attested_at IS NOT NULL AND a.rights_attestation_version='v1') AS "rightsAttested",
  s.processing_state AS processing,s.moderation_state AS moderation,
  json_build_object('upload',s.upload_state,'processing',s.processing_state,'visibility',s.visibility_state,
  'searchEligibility',s.search_eligibility_state,'indexing',s.indexing_state,'apiAvailability',s.api_availability_state,
  'deliveryReadiness',s.delivery_readiness_state,'moderation',s.moderation_state) AS states
  FROM assets a JOIN asset_states s ON s.asset_id=a.id`;
type Row = Omit<ReviewItem, 'rowVersion'> & {
  rowVersion: string;
  states: MediaState;
  kind: string;
  rightsAttested: boolean;
};
const item = (r: Row): ReviewItem => ({
  assetId: r.assetId,
  title: r.title,
  ownerId: r.ownerId,
  processing: r.processing,
  moderation: r.moderation,
  rowVersion: Number(r.rowVersion),
});
async function variants(
  client: Pick<PoolClient, 'query'>,
  id: string,
): Promise<ReviewVariant[]> {
  const result = await client.query(
    `SELECT name,object_key AS "objectKey",object_version_id AS "objectVersionId",
    mime_type AS "mimeType",size_bytes AS "sizeBytes",sha256,frame_count AS "frameCount",rendition_version AS generation
    FROM asset_variants WHERE asset_id=$1 AND rendition_version=(SELECT max(rendition_version) FROM asset_variants WHERE asset_id=$1)`,
    [id],
  );
  return result.rows.map((v) => ({ ...v, sizeBytes: Number(v.sizeBytes) }));
}
export function assertReviewVariants(id: string, values: ReviewVariant[]) {
  if (
    values.length !== 2 ||
    new Set(values.map((v) => v.name)).size !== 2 ||
    values.some(
      (v) =>
        !['DISPLAY_GIF', 'POSTER_PNG'].includes(v.name) ||
        !v.objectVersionId ||
        v.objectVersionId === 'null' ||
        !/^[a-f0-9]{64}$/.test(v.sha256) ||
        !Number.isSafeInteger(v.sizeBytes) ||
        v.sizeBytes <= 0 ||
        v.mimeType !== (v.name === 'DISPLAY_GIF' ? 'image/gif' : 'image/png') ||
        v.frameCount === null ||
        v.frameCount < (v.name === 'DISPLAY_GIF' ? 2 : 1) ||
        v.objectKey !==
          `assets/${id}/v${v.generation}/${v.sha256}/${v.name === 'DISPLAY_GIF' ? 'display.gif' : 'poster.png'}`,
    )
  )
    throw conflict();
}
export function createReviewRepository(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 1500,
    query_timeout: 12000,
  });
  pool.on('error', () => {});
  const repository = {
    async queue(limit: number, cursor?: string) {
      if (
        cursor &&
        !(await pool.query('SELECT 1 FROM assets WHERE id=$1', [cursor]))
          .rowCount
      )
        throw new ReviewFault(400, 'VALIDATION_ERROR', 'Invalid queue cursor');
      const result = await pool.query<Row>(
        `${selection} WHERE s.processing_state='SUCCEEDED' AND s.moderation_state='PENDING'
        AND ($2::uuid IS NULL OR (a.created_at,a.id)<(SELECT created_at,id FROM assets WHERE id=$2))
        ORDER BY a.created_at DESC,a.id DESC LIMIT $1`,
        [limit + 1, cursor ?? null],
      );
      return {
        items: result.rows.slice(0, limit).map(item),
        ...(result.rows.length > limit
          ? { nextCursor: result.rows[limit - 1]!.assetId }
          : {}),
      };
    },
    async detail(id: string): Promise<ReviewDetail> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const r = (await client.query<Row>(`${selection} WHERE a.id=$1`, [id]))
          .rows[0];
        if (!r) throw notFound();
        const tags = (
          await client.query(
            'SELECT t.slug FROM asset_tags at JOIN tags t ON t.id=at.tag_id WHERE at.asset_id=$1 ORDER BY t.slug',
            [id],
          )
        ).rows.map((t) => t.slug as string);
        const values = await variants(client, id);
        let previews: ReviewDetail['previews'] = [];
        if (r.processing === 'SUCCEEDED') {
          try {
            assertReviewVariants(id, values);
            previews = values.map((v) => ({
              variant: v.name,
              path: `/api/v1/review/assets/${id}/media/${v.name}`,
            }));
          } catch {
            /* Incomplete derivatives have no preview. */
          }
        }
        const decisions = (
          await client.query(
            `SELECT id,reviewer_id AS "reviewerId",action,reason_code AS "reasonCode",reason_note AS "reasonNote",prior_state AS "priorState",decided_at AS "decidedAt" FROM moderation_decisions WHERE asset_id=$1 ORDER BY decided_at,id`,
            [id],
          )
        ).rows.map((d) => ({ ...d, decidedAt: d.decidedAt.toISOString() }));
        const audit = (
          await client.query(
            `SELECT id,event_type AS "eventType",actor_user_id AS "actorUserId",created_at AS "createdAt",metadata->>'decisionId' AS "decisionId" FROM audit_events WHERE asset_id=$1 ORDER BY created_at,id`,
            [id],
          )
        ).rows.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }));
        await client.query('COMMIT');
        return {
          ...item(r),
          states: r.states,
          tags,
          rightsAttested: r.rightsAttested,
          previews,
          decisions,
          audit,
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async preview(id: string, name: string) {
      const r = (await pool.query<Row>(`${selection} WHERE a.id=$1`, [id]))
        .rows[0];
      if (!r || r.processing !== 'SUCCEEDED') throw notFound();
      const values = await variants(pool, id);
      assertReviewVariants(id, values);
      const value = values.find((v) => v.name === name);
      if (!value) throw notFound();
      return value;
    },
    async decide(
      reviewerId: string,
      id: string,
      action: 'APPROVE' | 'REJECT' | 'REMOVE',
      input: ReviewDecision | ReviewRemoval,
      requestId: string,
      verify: (values: ReviewVariant[]) => Promise<void>,
    ): Promise<ReviewResult> {
      const parsed =
        action === 'REMOVE'
          ? removalRequestSchema.safeParse(input)
          : decisionRequestSchema.safeParse(input);
      if (
        !parsed.success ||
        ('decision' in parsed.data && parsed.data.decision !== action)
      )
        throw new ReviewFault(
          400,
          'VALIDATION_ERROR',
          'Valid decision, reason and expectedVersion required',
        );
      const { expectedVersion, reasonCode, reasonNote } = parsed.data;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout='4s'");
        // Lock principal and grant as well as the asset; role revocation cannot race a commit.
        const role = await client.query(
          `SELECT u.id FROM users u JOIN role_grants g ON g.user_id=u.id WHERE u.id=$1 AND u.status='ACTIVE' AND g.role='REVIEWER' FOR SHARE OF u,g`,
          [reviewerId],
        );
        if (!role.rowCount)
          throw new ReviewFault(403, 'FORBIDDEN', 'Reviewer access required');
        const r = (
          await client.query<Row>(
            `${selection} WHERE a.id=$1 FOR UPDATE OF a,s`,
            [id],
          )
        ).rows[0];
        if (!r) throw notFound();
        if (r.ownerId === reviewerId)
          throw new ReviewFault(
            403,
            'FORBIDDEN',
            'Owners cannot review their own assets',
          );
        const current = BigInt(r.rowVersion);
        if (current !== BigInt(expectedVersion)) {
          // Replay is scoped to the same actor, input version, exact semantics and current result.
          const replay = await client.query(
            `SELECT 1 FROM moderation_decisions d JOIN audit_events e ON e.asset_id=d.asset_id AND e.metadata->>'decisionId'=d.id::text
            WHERE d.asset_id=$1 AND d.reviewer_id=$2 AND d.action=$3 AND d.reason_code=$4 AND d.reason_note IS NOT DISTINCT FROM $5
            AND e.event_type=$6 AND e.metadata->>'expectedVersion'=$7`,
            [
              id,
              reviewerId,
              action,
              reasonCode,
              reasonNote ?? null,
              `MODERATION_${action}`,
              String(expectedVersion),
            ],
          );
          if (
            current !== BigInt(expectedVersion) + 1n ||
            !replay.rowCount ||
            r.moderation !==
              (action === 'APPROVE'
                ? 'APPROVED'
                : action === 'REJECT'
                  ? 'REJECTED'
                  : 'REMOVED')
          )
            throw conflict();
          await client.query('COMMIT');
          return { id, states: r.states, rowVersion: Number(current) };
        }
        const values = await variants(client, id);
        if (action === 'APPROVE') {
          assertReviewVariants(id, values);
        }
        let next: MediaState;
        try {
          next = transitionMediaState(r.states, {
            type: action,
            reviewerId,
            ownerId: r.ownerId,
            roles: ['REVIEWER'],
            expectedVersion: BigInt(expectedVersion),
            actualVersion: current,
            reasonCode,
            rightsAttested: r.kind === 'GIF' && r.rightsAttested,
            verifiedDisplay: values.some((v) => v.name === 'DISPLAY_GIF'),
            verifiedPoster: values.some((v) => v.name === 'POSTER_PNG'),
          });
        } catch {
          throw conflict();
        }
        if (action === 'APPROVE') await verify(values);
        const decision = (
          await client.query(
            `INSERT INTO moderation_decisions(asset_id,reviewer_id,action,reason_code,reason_note,prior_state,decided_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()) RETURNING id`,
            [
              id,
              reviewerId,
              action,
              reasonCode,
              reasonNote ?? null,
              r.moderation,
            ],
          )
        ).rows[0].id;
        await client.query(
          `UPDATE asset_states SET moderation_state=$2,visibility_state=$3,search_eligibility_state=$4,indexing_state=$5,api_availability_state=$6,state_updated_at=clock_timestamp() WHERE asset_id=$1`,
          [
            id,
            next.moderation,
            next.visibility,
            next.searchEligibility,
            next.indexing,
            next.apiAvailability,
          ],
        );
        if (action === 'APPROVE')
          await client.query(
            `INSERT INTO search_documents(asset_id,title,tag_text) SELECT a.id,a.title,COALESCE((SELECT string_agg(t.slug,' ' ORDER BY t.slug) FROM asset_tags at JOIN tags t ON t.id=at.tag_id WHERE at.asset_id=a.id),'') FROM assets a WHERE a.id=$1 ON CONFLICT(asset_id) DO UPDATE SET title=excluded.title,tag_text=excluded.tag_text,indexed_at=clock_timestamp()`,
            [id],
          );
        else
          await client.query('DELETE FROM search_documents WHERE asset_id=$1', [
            id,
          ]);
        const updated = await client.query(
          'UPDATE assets SET row_version=row_version+1,updated_at=clock_timestamp() WHERE id=$1 AND row_version=$2 RETURNING row_version',
          [id, expectedVersion],
        );
        if (!updated.rowCount) throw conflict();
        await client.query(
          `INSERT INTO audit_events(actor_user_id,asset_id,event_type,request_id,metadata,created_at) VALUES($1,$2,$3,$4,$5,clock_timestamp())`,
          [
            reviewerId,
            id,
            `MODERATION_${action}`,
            requestId,
            JSON.stringify({
              decisionId: decision,
              expectedVersion,
              rowVersion: expectedVersion + 1,
              priorState: r.moderation,
              reasonCode,
            }),
          ],
        );
        await client.query('COMMIT');
        return { id, states: next, rowVersion: expectedVersion + 1 };
      } catch (error) {
        await client.query('ROLLBACK');
        if (
          ['55P03', '40P01', '40001'].includes((error as { code: string }).code)
        )
          throw conflict();
        throw error;
      } finally {
        client.release();
      }
    },
  };
  return { repository, close: () => pool.end() };
}
export type ReviewRepository = ReturnType<
  typeof createReviewRepository
>['repository'];
