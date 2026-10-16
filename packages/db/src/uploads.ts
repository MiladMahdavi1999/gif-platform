import { randomUUID } from 'node:crypto';
import pg, { type PoolClient } from 'pg';
import type { UploadRequest, OwnerAsset } from '@gif/contracts';

export interface UploadSession {
  id: string;
  assetId: string;
  key: string;
  expiresAt: Date;
  completedAt: Date | null;
  claimedSize: string | null;
  upload: string;
  processing: string;
}
export class UploadFault extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const fault = (status: number, code: string, message: string) =>
  new UploadFault(status, code, message);
const selection = `SELECT u.id,u.asset_id AS "assetId",u.quarantine_key AS key,
  u.expires_at AS "expiresAt",u.completed_at AS "completedAt",u.claimed_size_bytes AS "claimedSize",
  s.upload_state AS upload,s.processing_state AS processing
  FROM upload_sessions u JOIN asset_states s ON s.asset_id=u.asset_id`;
const ownerSelection = `SELECT a.id AS "assetId",a.title,a.created_at AS "createdAt",a.row_version AS "rowVersion",
  COALESCE((SELECT array_agg(t.slug ORDER BY t.slug) FROM asset_tags at JOIN tags t ON t.id=at.tag_id WHERE at.asset_id=a.id),'{}') AS tags,
  json_build_object('upload',s.upload_state,'processing',s.processing_state,'visibility',s.visibility_state,
  'searchEligibility',s.search_eligibility_state,'indexing',s.indexing_state,'apiAvailability',s.api_availability_state,
  'deliveryReadiness',s.delivery_readiness_state,'moderation',s.moderation_state) AS states,
  s.processing_error_code AS "errorCode"
  FROM assets a JOIN asset_states s ON s.asset_id=a.id`;
function ownerDto(
  row: Omit<OwnerAsset, 'createdAt' | 'rowVersion'> & {
    createdAt: Date;
    rowVersion: string;
  },
): OwnerAsset {
  return {
    assetId: row.assetId,
    title: row.title,
    tags: row.tags,
    states: row.states,
    createdAt: row.createdAt.toISOString(),
    rowVersion: Number(row.rowVersion),
    variantsReady: row.states.deliveryReadiness === 'READY',
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
  };
}
export function createUploadRepository(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 1500,
    query_timeout: 7000,
  });
  pool.on('error', () => {});
  async function transaction<T>(
    run: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='4s'");
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async function expire(client: Pick<PoolClient, 'query'>, ownerId: string) {
    await client.query(
      `UPDATE asset_states s SET upload_state='EXPIRED',state_updated_at=clock_timestamp()
      FROM upload_sessions u WHERE u.asset_id=s.asset_id AND u.owner_id=$1
      AND u.completed_at IS NULL AND u.expires_at <= clock_timestamp() AND s.upload_state='INTENT'`,
      [ownerId],
    );
  }
  const repository = {
    async intent(
      ownerId: string,
      idempotency: string,
      input: UploadRequest,
      ttlSeconds: number,
    ) {
      const result = await transaction(async (client) => {
        // Serialize this owner/key across API processes before any inserts.
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
          [`${ownerId}:${idempotency}`],
        );
        const existing = (
          await client.query<UploadSession>(
            `${selection} WHERE u.owner_id=$1 AND u.idempotency_key=$2 FOR UPDATE OF u`,
            [ownerId, idempotency],
          )
        ).rows[0];
        if (existing) {
          if (existing.expiresAt.getTime() <= Date.now()) {
            await expire(client, ownerId);
            return fault(
              409,
              'UPLOAD_INTENT_EXPIRED',
              'Upload intent expired. Start a new upload.',
            );
          }
          const asset = (
            await client.query(`${ownerSelection} WHERE a.id=$1`, [
              existing.assetId,
            ])
          ).rows[0];
          if (
            asset.title !== input.title ||
            JSON.stringify([...asset.tags].sort()) !==
              JSON.stringify([...input.tags].sort()) ||
            existing.claimedSize !==
              (input.claimedSizeBytes === undefined
                ? null
                : String(input.claimedSizeBytes))
          )
            return fault(
              409,
              'IDEMPOTENCY_CONFLICT',
              'This upload key was already used with different metadata.',
            );
          return existing;
        }
        const recent = await client.query(
          "SELECT count(*) FROM upload_sessions WHERE owner_id=$1 AND created_at > now()-interval '15 minutes'",
          [ownerId],
        );
        if (Number(recent.rows[0].count) >= 20)
          return fault(
            429,
            'UPLOAD_RATE_LIMITED',
            'Too many uploads. Try again later.',
          );
        // Lock owner for the per-owner budget across different keys.
        await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [
          ownerId,
        ]);
        const budget = await client.query(
          "SELECT count(*) FROM upload_sessions WHERE owner_id=$1 AND created_at > clock_timestamp()-interval '15 minutes'",
          [ownerId],
        );
        if (Number(budget.rows[0].count) >= 20)
          return fault(
            429,
            'UPLOAD_RATE_LIMITED',
            'Too many uploads. Try again later.',
          );
        const assetId = randomUUID();
        const uploadId = randomUUID();
        await client.query(
          `INSERT INTO assets(id,owner_id,kind,title,rights_attested_at,rights_attestation_version)
          VALUES($1,$2,'GIF',$3,clock_timestamp(),'v1')`,
          [assetId, ownerId, input.title],
        );
        await client.query('INSERT INTO asset_states(asset_id) VALUES($1)', [
          assetId,
        ]);
        for (const tag of [...input.tags].sort()) {
          const row = await client.query(
            'INSERT INTO tags(slug) VALUES($1) ON CONFLICT(slug) DO UPDATE SET slug=EXCLUDED.slug RETURNING id',
            [tag],
          );
          await client.query(
            'INSERT INTO asset_tags(asset_id,tag_id) VALUES($1,$2)',
            [assetId, row.rows[0].id],
          );
        }
        await client.query(
          `INSERT INTO upload_sessions(id,asset_id,owner_id,idempotency_key,quarantine_key,requested_content_type,claimed_size_bytes,expires_at)
          VALUES($1,$2,$3,$4,$5,'image/gif',$6,clock_timestamp()+make_interval(secs=>$7))`,
          [
            uploadId,
            assetId,
            ownerId,
            idempotency,
            `quarantine/${assetId}/${uploadId}/original.gif`,
            input.claimedSizeBytes ?? null,
            ttlSeconds,
          ],
        );
        return (
          await client.query<UploadSession>(`${selection} WHERE u.id=$1`, [
            uploadId,
          ])
        ).rows[0]!;
      });
      if (result instanceof UploadFault) throw result;
      return result;
    },
    async complete(
      ownerId: string,
      uploadId: string,
      requestId: string,
      maxBytes: number,
      head: (key: string) => Promise<{
        size: number;
        contentType: string;
        etag: string;
        versionId: string;
      } | null>,
    ) {
      const result = await transaction(async (client) => {
        const session = (
          await client.query<UploadSession>(
            `${selection}
          JOIN assets a ON a.id=u.asset_id WHERE u.id=$1 AND u.owner_id=$2 AND a.owner_id=$2 FOR UPDATE OF u,s`,
            [uploadId, ownerId],
          )
        ).rows[0];
        if (!session) return fault(404, 'NOT_FOUND', 'Upload not found');
        if (session.completedAt)
          return {
            assetId: session.assetId,
            upload: session.upload,
            processing: session.processing,
          };
        const expired = async () => {
          const value = await client.query(
            'SELECT expires_at <= clock_timestamp() AS expired FROM upload_sessions WHERE id=$1',
            [uploadId],
          );
          if (!value.rows[0].expired) return false;
          await client.query(
            "UPDATE asset_states SET upload_state='EXPIRED',state_updated_at=clock_timestamp() WHERE asset_id=$1",
            [session.assetId],
          );
          return true;
        };
        if (await expired())
          return fault(
            410,
            'UPLOAD_INTENT_EXPIRED',
            'Upload expired. Start a new upload.',
          );
        const object = await head(session.key);
        if (await expired())
          return fault(
            410,
            'UPLOAD_INTENT_EXPIRED',
            'Upload expired. Start a new upload.',
          );
        if (!object)
          return fault(
            409,
            'UPLOAD_OBJECT_MISSING',
            'File has not reached storage. Retry the file upload.',
          );
        if (object.size > maxBytes)
          return fault(
            413,
            'UPLOAD_TOO_LARGE',
            'File exceeds the upload size limit.',
          );
        if (
          object.size < 1 ||
          (session.claimedSize !== null &&
            BigInt(session.claimedSize) !== BigInt(object.size))
        )
          return fault(
            409,
            'UPLOAD_SIZE_MISMATCH',
            'Stored file size does not match the upload intent.',
          );
        if (object.contentType !== 'image/gif')
          return fault(
            409,
            'UPLOAD_MIME_MISMATCH',
            'Stored file must have image/gif content type.',
          );
        if (!object.etag || !object.versionId || object.versionId === 'null')
          return fault(
            503,
            'STORAGE_UNAVAILABLE',
            'Versioned private storage is unavailable.',
          );
        await client.query(
          `UPDATE upload_sessions SET completed_at=clock_timestamp(),received_size_bytes=$2,received_etag=$3,received_version_id=$4 WHERE id=$1`,
          [uploadId, object.size, object.etag, object.versionId],
        );
        await client.query(
          "UPDATE asset_states SET upload_state='RECEIVED',processing_state='QUEUED',state_updated_at=clock_timestamp() WHERE asset_id=$1",
          [session.assetId],
        );
        await client.query(
          "INSERT INTO media_jobs(asset_id,job_kind) VALUES($1,'PROCESS_GIF')",
          [session.assetId],
        );
        await client.query(
          "INSERT INTO audit_events(actor_user_id,asset_id,event_type,request_id,metadata) VALUES($1,$2,'UPLOAD_RECEIVED',$3,$4)",
          [
            ownerId,
            session.assetId,
            requestId,
            JSON.stringify({ sizeBytes: object.size }),
          ],
        );
        return {
          assetId: session.assetId,
          upload: 'RECEIVED',
          processing: 'QUEUED',
        };
      });
      if (result instanceof UploadFault) throw result;
      return result;
    },
    async detail(ownerId: string, assetId: string) {
      await expire(pool, ownerId);
      const row = (
        await pool.query(`${ownerSelection} WHERE a.owner_id=$1 AND a.id=$2`, [
          ownerId,
          assetId,
        ])
      ).rows[0];
      return row ? ownerDto(row) : null;
    },
    async list(ownerId: string, cursor?: string) {
      await expire(pool, ownerId);
      const rows = (
        await pool.query(
          `${ownerSelection} WHERE a.owner_id=$1
        AND ($2::uuid IS NULL OR (a.created_at,a.id) < (SELECT created_at,id FROM assets WHERE id=$2 AND owner_id=$1))
        ORDER BY a.created_at DESC,a.id DESC LIMIT 25`,
          [ownerId, cursor ?? null],
        )
      ).rows;
      const items = rows.slice(0, 24).map((row) => {
        const { assetId, ...rest } = ownerDto(row);
        return { id: assetId, ...rest };
      });
      return {
        items,
        ...(rows.length > 24 ? { nextCursor: items.at(-1)!.id } : {}),
      };
    },
  };
  return { repository, close: () => pool.end() };
}
export type UploadRepository = ReturnType<
  typeof createUploadRepository
>['repository'];
