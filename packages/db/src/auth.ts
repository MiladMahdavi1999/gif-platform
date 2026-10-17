import { createResilientPool } from './pool.js';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';

export type Role = 'UPLOADER' | 'REVIEWER' | 'ADMIN';
export interface AuthUser {
  id: string;
  email: string;
  roles: Role[];
}
export interface LoginUser extends AuthUser {
  passwordHash: string;
  status: string;
}
export interface StoredSession {
  id: string;
  user: AuthUser;
  csrfTokenHash: Buffer;
  expiresAt: Date;
}
export interface AuthRepository {
  findUser(email: string): Promise<LoginUser | undefined>;
  findSession(tokenHash: Buffer): Promise<StoredSession | undefined>;
  createSession(
    userId: string,
    tokenHash: Buffer,
    csrfTokenHash: Buffer,
    expiresAt: Date,
    previousHash?: Buffer,
  ): Promise<void>;
  revokeSession(tokenHash: Buffer): Promise<void>;
}

// A missing account still performs the same Argon2id work as a seeded account.
export const createDummyPasswordHash = () =>
  hash(randomBytes(32), {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
export async function verifyPassword(passwordHash: string, password: string) {
  if (!passwordHash.startsWith('$argon2id$')) return false;
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function createAuthRepository(connectionString: string) {
  const pool = createResilientPool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 1500,
    query_timeout: 3000,
  });
  const repository: AuthRepository = {
    async findUser(email) {
      const result = await pool.query<LoginUser>(
        `
        SELECT u.id,u.email,u.password_hash AS "passwordHash",u.status,
          COALESCE(array_agg(r.role ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL),'{}') AS roles
        FROM users u LEFT JOIN role_grants r ON r.user_id=u.id
        WHERE u.email=$1 GROUP BY u.id`,
        [email],
      );
      return result.rows[0];
    },
    async findSession(tokenHash) {
      const result = await pool.query<{
        id: string;
        userId: string;
        email: string;
        roles: Role[];
        csrfTokenHash: Buffer;
        expiresAt: Date;
      }>(
        `
        SELECT s.id,u.id AS "userId",u.email,s.csrf_token_hash AS "csrfTokenHash",s.expires_at AS "expiresAt",
          COALESCE(array_agg(r.role ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL),'{}') AS roles
        FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN role_grants r ON r.user_id=u.id
        WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status='ACTIVE'
        GROUP BY s.id,u.id`,
        [tokenHash],
      );
      const row = result.rows[0];
      return (
        row && {
          id: row.id,
          user: { id: row.userId, email: row.email, roles: row.roles },
          csrfTokenHash: row.csrfTokenHash,
          expiresAt: row.expiresAt,
        }
      );
    },
    async createSession(
      userId,
      tokenHash,
      csrfTokenHash,
      expiresAt,
      previousHash,
    ) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Lock and recheck status so a concurrent account disable cannot issue a session.
        const active = await client.query(
          "SELECT id FROM users WHERE id=$1 AND status='ACTIVE' FOR UPDATE",
          [userId],
        );
        if (!active.rowCount) throw new Error('Session creation refused');
        if (previousHash)
          await client.query(
            'UPDATE sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',
            [previousHash],
          );
        await client.query(
          'INSERT INTO sessions(user_id,token_hash,csrf_token_hash,expires_at) VALUES($1,$2,$3,$4)',
          [userId, tokenHash, csrfTokenHash, expiresAt],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async revokeSession(tokenHash) {
      await pool.query(
        'UPDATE sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',
        [tokenHash],
      );
    },
  };
  return { repository, close: () => pool.end() };
}
