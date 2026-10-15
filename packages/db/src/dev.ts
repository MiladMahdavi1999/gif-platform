import { Algorithm, hash } from '@node-rs/argon2';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { roleGrants, users } from './schema.js';

export function assertDevelopmentDatabase(env: NodeJS.ProcessEnv): string {
  if (
    env.NODE_ENV !== 'development' ||
    env.APP_ENV !== 'development' ||
    env.ALLOW_DEV_DATABASE_COMMANDS !== 'true'
  )
    throw new Error('Development database commands are disabled');
  const url = new URL(env.DATABASE_URL ?? '');
  const database = decodeURIComponent(url.pathname.slice(1));
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]', 'db'].includes(url.hostname) ||
    !/^gif_platform(?:_[a-z0-9]+)*$/.test(database)
  )
    throw new Error('Development database target refused');
  return database;
}
export async function verifyDevelopmentTarget(
  client: PoolClient,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const expected = assertDevelopmentDatabase(env);
  const result = await client.query<{ name: string }>(
    'SELECT current_database() AS name',
  );
  if (result.rows[0]?.name !== expected)
    throw new Error('Development database target mismatch');
  return expected;
}

export async function seedDevelopment(
  client: PoolClient,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await verifyDevelopmentTarget(client, env);
  const accounts = [
    {
      email: env.DEV_UPLOADER_EMAIL,
      password: env.DEV_UPLOADER_PASSWORD,
      role: 'UPLOADER',
    },
    {
      email: env.DEV_REVIEWER_EMAIL,
      password: env.DEV_REVIEWER_PASSWORD,
      role: 'REVIEWER',
    },
  ];
  if (
    accounts.some(
      (a) =>
        !a.email ||
        a.email !== a.email.trim().toLowerCase() ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email) ||
        !a.password ||
        a.password.length < 16,
    ) ||
    accounts[0]!.email === accounts[1]!.email
  )
    throw new Error('Invalid development seed configuration');
  // Hash outside the transaction; never print passwords or hashes.
  const hashes = await Promise.all(
    accounts.map((a) =>
      hash(a.password!, {
        algorithm: Algorithm.Argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      }),
    ),
  );
  const db = drizzle(client);
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(71401, 1)');
    for (const [index, account] of accounts.entries()) {
      const [user] = await db
        .insert(users)
        .values({ email: account.email!, passwordHash: hashes[index]! })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id });
      const userId =
        user?.id ??
        (
          await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, account.email!))
        )[0]!.id;
      const grants = await db
        .select()
        .from(roleGrants)
        .where(eq(roleGrants.userId, userId));
      if (grants.some((grant) => grant.role !== account.role))
        throw new Error('Seed role separation conflict');
      await db
        .insert(roleGrants)
        .values({ userId, role: account.role })
        .onConflictDoNothing();
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function inspectDevelopment(
  client: PoolClient,
  env: NodeJS.ProcessEnv,
) {
  await verifyDevelopmentTarget(client, env);
  const db = drizzle(client);
  const accounts = await db
    .select({ id: users.id, role: roleGrants.role })
    .from(users)
    .innerJoin(roleGrants, eq(users.id, roleGrants.userId))
    .where(
      inArray(users.email, [
        env.DEV_UPLOADER_EMAIL ?? '',
        env.DEV_REVIEWER_EMAIL ?? '',
      ]),
    );
  const count = await client.query<{ count: string }>(
    'SELECT count(*) FROM assets',
  );
  return { accounts, assetCount: Number(count.rows[0]!.count) };
}
