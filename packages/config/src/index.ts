import { z } from 'zod';

const httpUrl = z.url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  );
}, 'Expected an HTTP(S) URL without embedded credentials');

const common = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
});

export const apiConfigSchema = common.extend({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  PUBLIC_BASE_URL: httpUrl,
  SESSION_COOKIE_NAME: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)
    .default('gif_session'),
  SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(604800)
    .default(86400),
  CSRF_ORIGIN: httpUrl.optional(),
  DATABASE_URL: z.url().refine((value) => {
    return (
      URL.canParse(value) &&
      ['postgres:', 'postgresql:'].includes(new URL(value).protocol)
    );
  }, 'Expected a PostgreSQL URL'),
  S3_INTERNAL_ENDPOINT: httpUrl,
  S3_PUBLIC_ENDPOINT: httpUrl,
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(3),
  S3_SECRET_ACCESS_KEY: z.string().min(8),
});

export type ApiConfig = z.infer<typeof apiConfigSchema>;

// Only field names leave this boundary; validation input can contain secrets.
export function readApiConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const result = apiConfigSchema.safeParse(env);
  if (!result.success) {
    const fields = [
      ...new Set(result.error.issues.map((issue) => issue.path.join('.'))),
    ];
    throw new Error(`Invalid configuration fields: ${fields.join(', ')}`);
  }
  const config = result.data;
  const base = new URL(config.PUBLIC_BASE_URL);
  if (
    base.origin !== config.PUBLIC_BASE_URL ||
    (config.CSRF_ORIGIN && config.CSRF_ORIGIN !== base.origin) ||
    (config.NODE_ENV !== 'development' && base.protocol !== 'https:')
  )
    throw new Error(
      'Invalid configuration fields: PUBLIC_BASE_URL, CSRF_ORIGIN',
    );
  return config;
}

export function readWorkerConfig(env: NodeJS.ProcessEnv) {
  const result = common.safeParse(env);
  if (!result.success)
    throw new Error('Invalid configuration fields: NODE_ENV');
  return result.data;
}
