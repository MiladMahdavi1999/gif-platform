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
  return result.data;
}

export function readWorkerConfig(env: NodeJS.ProcessEnv) {
  const result = common.safeParse(env);
  if (!result.success)
    throw new Error('Invalid configuration fields: NODE_ENV');
  return result.data;
}
