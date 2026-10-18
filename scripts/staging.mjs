import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  existsSync,
  openSync,
  closeSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const command = process.argv[2];
const envPath = resolve(process.env.STAGING_ENV_FILE ?? 'work/staging.env');
function run(bin, args, options = {}) {
  const result = spawnSync(bin, args, { stdio: 'inherit', ...options });
  if (result.status !== 0)
    throw new Error(
      `Command failed: ${bin} (exit ${result.status ?? 'signal'})`,
    );
  return result.stdout?.toString().trim();
}
function output(bin, args, options = {}) {
  return run(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
}
function saveEnv(env) {
  writeFileSync(
    envPath,
    Object.entries(env)
      .map(([k, v]) => `${k}=${v}\n`)
      .join(''),
    { mode: 0o600 },
  );
}
function config() {
  if (statSync(envPath).mode & 0o077)
    throw new Error('Staging env must be private (chmod 600)');
  const env = parseEnv(readFileSync(envPath, 'utf8'));
  if (!/^gif-b09-[a-z0-9-]+$/.test(env.STAGING_PROJECT ?? ''))
    throw new Error('Dedicated disposable staging project required');
  const secretKeys = [
    'POSTGRES_PASSWORD',
    'MINIO_ROOT_PASSWORD',
    'S3_API_SECRET_ACCESS_KEY',
    'S3_WORKER_SECRET_ACCESS_KEY',
    'PUBLIC_CURSOR_SECRET',
    'BOOTSTRAP_UPLOADER_PASSWORD',
    'BOOTSTRAP_REVIEWER_PASSWORD',
  ];
  const secrets = secretKeys.map((k) => env[k]);
  if (
    secrets.some((s) => !s || !/^[a-f0-9]{64}$/.test(s)) ||
    new Set(secrets).size !== secrets.length
  )
    throw new Error(
      'Explicit distinct generated nonproduction secrets required',
    );
  if (env.BOOTSTRAP_UPLOADER_EMAIL === env.BOOTSTRAP_REVIEWER_EMAIL)
    throw new Error('Distinct staging identities required');
  for (const [key, role] of [
    ['ADMIN_DATABASE_URL', 'gif_staging_admin'],
    ['API_DATABASE_URL', 'gif_staging_api'],
    ['WORKER_DATABASE_URL', 'gif_processing_worker'],
  ]) {
    const u = new URL(env[key]);
    if (
      u.hostname !== 'db' ||
      u.pathname !== '/gif_platform_staging' ||
      u.username !== role ||
      u.password.length !== 64
    )
      throw new Error('Invalid staging database URL');
  }
  for (const key of ['APP_IMAGE', 'WORKER_IMAGE', 'MINIO_IMAGE', 'EDGE_IMAGE'])
    if (!/^gif-platform-staging-[a-z]+:[a-f0-9]{40}$/.test(env[key] ?? ''))
      throw new Error('Full source SHA image tag required');
  for (const file of ['ca.crt', 'public.crt', 'private.key'])
    if (!existsSync(resolve(env.STAGING_CERTS_DIR, file)))
      throw new Error('Local staging certificates required');
  return env;
}
function compose(env, args, options = {}) {
  return run(
    'docker',
    [
      'compose',
      '--project-name',
      env.STAGING_PROJECT,
      '--env-file',
      envPath,
      '-f',
      'infra/staging/compose.yaml',
      ...args,
    ],
    { env: { ...process.env, ...env }, ...options },
  );
}
function admin(env, operation) {
  compose(env, [
    'run',
    '--rm',
    '--no-deps',
    'admin',
    'node',
    'scripts/staging-admin.mjs',
    operation,
  ]);
}
const appServices = ['edge', 'web', 'api', 'worker'];
function versionInventory(env) {
  const lines = compose(
    env,
    [
      'run',
      '--rm',
      '--no-deps',
      'admin',
      'node',
      'scripts/staging-admin.mjs',
      'verify-pins',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  ).split('\n');
  const value = lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .find((value) => value?.event === 'staging_version_inventory');
  if (!value) throw new Error('Missing version inventory evidence');
  return value;
}
function stop(env) {
  compose(env, ['stop', ...appServices]);
}
function verifyImages(env) {
  for (const key of [
    'APP_IMAGE',
    'WORKER_IMAGE',
    'MINIO_IMAGE',
    'EDGE_IMAGE',
  ]) {
    const info = JSON.parse(
      output('docker', ['image', 'inspect', env[key]]),
    )[0];
    if (
      info.Config.Labels['org.opencontainers.image.revision'] !==
      env[key].split(':')[1]
    )
      throw new Error('Image source label mismatch');
  }
}
function start(env) {
  verifyImages(env);
  admin(env, 'verify');
  compose(env, [
    'up',
    '-d',
    '--no-build',
    '--pull',
    'never',
    '--wait',
    ...appServices,
  ]);
}
function verify(env) {
  for (const path of [
    '/api/v1/health/live',
    '/api/v1/health/ready',
    '/login',
    '/demo/host-picker',
  ]) {
    run('curl', [
      '--fail',
      '--silent',
      '--show-error',
      '--cacert',
      `${env.STAGING_CERTS_DIR}/ca.crt`,
      '--output',
      '/dev/null',
      `https://localhost:8443${path}`,
    ]);
  }
  compose(env, [
    'exec',
    '-T',
    'worker',
    'node',
    '-e',
    "const f=require('node:fs');process.exit(Date.now()-Number(f.readFileSync('/tmp/gif-worker-ready','utf8'))<15000?0:1)",
  ]);
  console.log(
    'PASS: HTTPS liveness, dependency readiness, Web, Picker and restricted Worker readiness',
  );
}
try {
  if (command === 'init') {
    if (existsSync(envPath))
      throw new Error('Refusing to replace existing staging configuration');
    mkdirSync(resolve(envPath, '..'), { recursive: true, mode: 0o700 });
    const directory = resolve('work/staging-certs');
    if (existsSync(directory))
      throw new Error('Refusing to replace existing staging CA');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    // Public local CA only. The private CA key is not mounted into any service.
    run(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:3072',
        '-nodes',
        '-keyout',
        `${directory}/ca.key`,
        '-out',
        `${directory}/ca.crt`,
        '-days',
        '7',
        '-subj',
        '/CN=GIF B09 disposable staging CA',
      ],
      { stdio: 'ignore' },
    );
    run(
      'openssl',
      [
        'req',
        '-newkey',
        'rsa:3072',
        '-nodes',
        '-keyout',
        `${directory}/private.key`,
        '-out',
        `${directory}/server.csr`,
        '-subj',
        '/CN=localhost',
      ],
      { stdio: 'ignore' },
    );
    writeFileSync(
      `${directory}/extensions.cnf`,
      'subjectAltName=DNS:localhost,DNS:minio,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n',
    );
    run(
      'openssl',
      [
        'x509',
        '-req',
        '-in',
        `${directory}/server.csr`,
        '-CA',
        `${directory}/ca.crt`,
        '-CAkey',
        `${directory}/ca.key`,
        '-CAcreateserial',
        '-out',
        `${directory}/public.crt`,
        '-days',
        '7',
        '-extfile',
        `${directory}/extensions.cnf`,
      ],
      { stdio: 'ignore' },
    );
    const secret = () => randomBytes(32).toString('hex');
    const revision = output('git', ['rev-parse', 'HEAD']);
    const env = {
      STAGING_PROJECT: `gif-b09-${randomBytes(4).toString('hex')}`,
      STAGING_CERTS_DIR: directory,
      POSTGRES_PASSWORD: secret(),
      MINIO_ROOT_USER: 'staging_root',
      MINIO_ROOT_PASSWORD: secret(),
      S3_API_ACCESS_KEY_ID: 'staging_api',
      S3_API_SECRET_ACCESS_KEY: secret(),
      S3_WORKER_ACCESS_KEY_ID: 'staging_worker',
      S3_WORKER_SECRET_ACCESS_KEY: secret(),
      PUBLIC_CURSOR_SECRET: secret(),
      BOOTSTRAP_UPLOADER_EMAIL: 'uploader@staging.invalid',
      BOOTSTRAP_UPLOADER_PASSWORD: secret(),
      BOOTSTRAP_REVIEWER_EMAIL: 'reviewer@staging.invalid',
      BOOTSTRAP_REVIEWER_PASSWORD: secret(),
      ALLOW_STAGING_BOOTSTRAP: 'false',
      ALLOW_STAGING_PROVISION: 'false',
    };
    for (const [key, role, password] of [
      ['ADMIN_DATABASE_URL', 'gif_staging_admin', env.POSTGRES_PASSWORD],
      ['API_DATABASE_URL', 'gif_staging_api', secret()],
      ['WORKER_DATABASE_URL', 'gif_processing_worker', secret()],
    ])
      env[key] =
        `postgresql://${role}:${password}@db:5432/gif_platform_staging`;
    for (const name of ['APP', 'WORKER', 'MINIO', 'EDGE'])
      env[`${name}_IMAGE`] =
        `gif-platform-staging-${name.toLowerCase()}:${revision}`;
    saveEnv(env);
    console.log(
      'Created private disposable staging configuration and seven-day local CA. No services or users started.',
    );
  } else {
    const env = config();
    if (command === 'validate') {
      compose(env, ['config', '--quiet']);
      const resolved = JSON.parse(
        compose(env, ['config', '--format', 'json'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      );
      for (const [name, service] of Object.entries(resolved.services)) {
        if (
          service.build ||
          service.tmpfs?.some(
            (value) =>
              !value.startsWith('/') || !value.includes('noexec,nosuid,nodev'),
          )
        )
          throw new Error('Invalid staging filesystem isolation');
        if (
          ['api', 'web', 'worker', 'admin'].includes(name) &&
          service.environment.NODE_ENV !== 'production'
        )
          throw new Error('Invalid staging runtime mode');
      }
      console.log(
        'PASS: explicit nonproduction staging configuration and resolved production filesystem isolation',
      );
    } else if (command === 'build') {
      if (output('git', ['status', '--porcelain']))
        throw new Error('Commit staging sources before traceable build');
      const revision = output('git', ['rev-parse', 'HEAD']);
      for (const name of ['APP', 'WORKER', 'MINIO', 'EDGE'])
        env[`${name}_IMAGE`] =
          `gif-platform-staging-${name.toLowerCase()}:${revision}`;
      saveEnv(env);
      const databaseReference = JSON.parse(
        compose(env, ['config', '--format', 'json'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      ).services.db.image;
      run('docker', ['pull', databaseReference]);
      const databaseInfo = JSON.parse(
        output('docker', ['image', 'inspect', databaseReference]),
      )[0];
      const secret = process.env.CODEX_PROXY_CERT
        ? ['--secret', `id=proxy_ca,src=${process.env.CODEX_PROXY_CERT}`]
        : [];
      for (const [key, file, target] of [
        ['APP_IMAGE', 'infra/docker/Dockerfile', 'app'],
        ['WORKER_IMAGE', 'infra/docker/Dockerfile', 'worker'],
        ['MINIO_IMAGE', 'infra/minio/Dockerfile', null],
        ['EDGE_IMAGE', 'infra/staging/Edge.Dockerfile', null],
      ]) {
        run('docker', [
          'build',
          '--build-arg',
          `SOURCE_REVISION=${revision}`,
          ...secret,
          ...(target ? ['--target', target] : []),
          '-f',
          file,
          '-t',
          env[key],
          '.',
        ]);
      }
      if (
        output('git', ['status', '--porcelain']) ||
        output('git', ['rev-parse', 'HEAD']) !== revision
      )
        throw new Error(
          'Commit changed during build; discard candidate images',
        );
      const images = Object.fromEntries(
        ['APP_IMAGE', 'WORKER_IMAGE', 'MINIO_IMAGE', 'EDGE_IMAGE'].map(
          (key) => {
            const info = JSON.parse(
              output('docker', ['image', 'inspect', env[key]]),
            )[0];
            return [
              key,
              { tag: env[key], id: info.Id, sourceRevision: revision },
            ];
          },
        ),
      );
      writeFileSync(
        'work/b09-image-provenance.json',
        JSON.stringify(
          {
            revision,
            lockfileSha256: createHash('sha256')
              .update(readFileSync('pnpm-lock.yaml'))
              .digest('hex'),
            images,
            database: {
              reference: databaseReference,
              id: databaseInfo.Id,
              repoDigests: databaseInfo.RepoDigests,
            },
          },
          null,
          2,
        ) + '\n',
      );
      console.log(
        JSON.stringify({
          event: 'staging_images',
          revision,
          images,
          database: { reference: databaseReference, id: databaseInfo.Id },
        }),
      );
      console.log(
        'PASS: four local image identities and pinned PostgreSQL recorded; nothing published',
      );
    } else if (command === 'infra') {
      verifyImages(env);
      compose(env, [
        'up',
        '-d',
        '--no-build',
        '--pull',
        'never',
        '--wait',
        'db',
        'minio',
      ]);
    } else if (command === 'migrate') {
      stop(env);
      admin(env, 'migrate');
    } else if (command === 'provision') {
      stop(env);
      const provision = { ...env, ALLOW_STAGING_PROVISION: 'true' };
      admin(provision, 'provision');
      compose(provision, ['run', '--rm', '--no-deps', 'storage-iam']);
    } else if (command === 'bootstrap') {
      if (!process.argv.includes('--authorize-test-identities'))
        throw new Error('Explicit test identity authorization flag required');
      admin({ ...env, ALLOW_STAGING_BOOTSTRAP: 'true' }, 'bootstrap');
    } else if (command === 'start') start(env);
    else if (command === 'verify') await verify(env);
    else if (command === 'inventory') admin(env, 'inventory');
    else if (command === 'empty') admin(env, 'inventory-empty');
    else if (command === 'stop') stop(env);
    else if (command === 'down')
      compose(env, ['down', '--remove-orphans']); // Always preserve data.
    else if (command === 'smoke') {
      await verify(env);
      run(
        process.execPath,
        [
          'node_modules/@playwright/test/cli.js',
          'test',
          '--config=playwright.staging.config.ts',
        ],
        { env: { ...process.env, ...env, STAGING_ENV_FILE: envPath } },
      );
    } else if (command === 'backup') {
      const directory = resolve(process.argv[3] ?? 'work/staging-backup');
      if (existsSync(directory))
        throw new Error('Refusing to overwrite backup');
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      stop(env);
      const versionEvidence = versionInventory(env);
      compose(env, ['stop', 'minio']);
      // All application/storage writers are stopped: no writes between these snapshots.
      const fd = openSync(`${directory}/postgres.dump`, 'wx', 0o600);
      try {
        compose(
          env,
          [
            'exec',
            '-T',
            'db',
            'pg_dump',
            '-U',
            'gif_staging_admin',
            '-d',
            'gif_platform_staging',
            '-Fc',
          ],
          { stdio: ['ignore', fd, 'pipe'] },
        );
      } finally {
        closeSync(fd);
      }
      run('docker', [
        'run',
        '--rm',
        '--network',
        'none',
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--mount',
        `type=volume,src=${env.STAGING_PROJECT}_minio_data,dst=/snapshot,readonly`,
        '--mount',
        `type=bind,src=${directory},dst=/backup`,
        env.APP_IMAGE,
        'tar',
        '-cf',
        '/backup/minio-volume.tar',
        '-C',
        '/snapshot',
        '.',
      ]);
      const files = Object.fromEntries(
        ['postgres.dump', 'minio-volume.tar'].map((name) => [
          name,
          createHash('sha256')
            .update(readFileSync(`${directory}/${name}`))
            .digest('hex'),
        ]),
      );
      writeFileSync(
        `${directory}/manifest.json`,
        JSON.stringify(
          {
            sourceProject: env.STAGING_PROJECT,
            revision: env.APP_IMAGE.split(':')[1],
            files,
            versionEvidence,
          },
          null,
          2,
        ) + '\n',
        { mode: 0o600 },
      );
      console.log(
        'PASS: quiescent PostgreSQL dump and complete MinIO version/identity volume captured. Services remain stopped. Backup is PRIVATE.',
      );
    } else if (command === 'restore-drill') {
      const directory = resolve(process.argv[3] ?? 'work/staging-backup');
      const manifest = JSON.parse(
        readFileSync(`${directory}/manifest.json`, 'utf8'),
      );
      for (const [name, digest] of Object.entries(manifest.files))
        if (
          !['postgres.dump', 'minio-volume.tar'].includes(name) ||
          createHash('sha256')
            .update(readFileSync(`${directory}/${name}`))
            .digest('hex') !== digest
        )
          throw new Error('Backup integrity failure');
      if (Object.keys(manifest.files).length !== 2)
        throw new Error('Incomplete backup');
      const restored = {
        ...env,
        STAGING_PROJECT: `gif-b09-restore-${randomBytes(4).toString('hex')}`,
      };
      // New random project only: restore cannot target the source deployment.
      compose(restored, ['create', 'db', 'minio']);
      run('docker', [
        'run',
        '--rm',
        '--network',
        'none',
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--mount',
        `type=volume,src=${restored.STAGING_PROJECT}_minio_data,dst=/snapshot`,
        '--mount',
        `type=bind,src=${directory},dst=/backup,readonly`,
        env.APP_IMAGE,
        'tar',
        '-xf',
        '/backup/minio-volume.tar',
        '-C',
        '/snapshot',
      ]);
      compose(restored, [
        'up',
        '-d',
        '--no-build',
        '--pull',
        'never',
        '--wait',
        'db',
        'minio',
      ]);
      const fd = openSync(`${directory}/postgres.dump`, 'r');
      try {
        compose(
          restored,
          [
            'exec',
            '-T',
            'db',
            'pg_restore',
            '-U',
            'gif_staging_admin',
            '-d',
            'gif_platform_staging',
            '--exit-on-error',
            '--single-transaction',
            '--no-owner',
            '--no-acl',
          ],
          { stdio: [fd, 'inherit', 'pipe'] },
        );
      } finally {
        closeSync(fd);
      }
      admin({ ...restored, ALLOW_STAGING_PROVISION: 'true' }, 'provision');
      compose({ ...restored, ALLOW_STAGING_PROVISION: 'true' }, [
        'run',
        '--rm',
        '--no-deps',
        'storage-iam',
      ]);
      admin(restored, 'migrate'); // Must be a no-op against the restored checksum ledger.
      const restoredVersions = versionInventory(restored);
      if (
        JSON.stringify(restoredVersions) !==
        JSON.stringify(manifest.versionEvidence)
      )
        throw new Error('Restored version inventory mismatch');
      start(restored);
      await verify(restored);
      run(process.execPath, ['scripts/staging-recovery-check.mjs'], {
        env: {
          ...process.env,
          ...restored,
          NODE_EXTRA_CA_CERTS: `${env.STAGING_CERTS_DIR}/ca.crt`,
        },
      });
      writeFileSync(
        'work/b09-restore-evidence.json',
        JSON.stringify(
          {
            status: 'passed',
            project: restored.STAGING_PROJECT,
            checks: [
              'backup-sha256',
              'all-source-and-derivative-pins',
              'complete-version-and-delete-marker-inventory-fingerprint',
              'postgres-single-transaction',
              'full-versioned-minio-volume',
              'migration-idempotence',
              'https-and-worker-readiness',
              'pinned-private-derivatives',
              'retained-audit',
              'post-removal-denial',
            ],
          },
          null,
          2,
        ) + '\n',
      );
      compose(restored, ['down', '--remove-orphans']);
      console.log(
        'PASS: disposable restore drill; restored volumes retained under recorded project for inspection',
      );
    } else throw new Error('Unknown staging command');
  }
} catch (error) {
  console.error(
    error instanceof Error &&
      /^(Command failed:|PASS:|Refusing|Explicit|Distinct|Dedicated|Full source|Image source|Local staging|Invalid staging|Staging env|Staging HTTPS|Commit staging|Backup integrity|Incomplete backup)/.test(
        error.message,
      )
      ? error.message
      : 'Staging operation failed; stop deployment and inspect safe evidence.',
  );
  process.exitCode = 1;
}
