import { z } from 'zod';

export const readinessSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({
    database: z.enum(['up', 'down']),
    storage: z.enum(['up', 'down']),
  }),
});

export type Readiness = z.infer<typeof readinessSchema>;

export const roleSchema = z.enum(['UPLOADER', 'REVIEWER', 'ADMIN']);
export const authUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  roles: z.array(roleSchema),
});
export const loginRequestSchema = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  password: z.string().min(1).max(1024),
});
export const loginResponseSchema = z.object({
  user: authUserSchema,
  csrfToken: z.string(),
});
export const sessionResponseSchema = z.discriminatedUnion('authenticated', [
  z.object({ authenticated: z.literal(false) }),
  z.object({
    authenticated: z.literal(true),
    user: authUserSchema,
    csrfToken: z.string(),
  }),
]);
export type AuthUser = z.infer<typeof authUserSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

// Generated OpenAPI stays limited to the implemented B00/B02 HTTP surface.
export function createOpenApiDocument() {
  const json = (schema: z.ZodType) => ({
    'application/json': { schema: z.toJSONSchema(schema, { io: 'input' }) },
  });
  const response = (description: string, schema?: z.ZodType) => ({
    description,
    ...(schema ? { content: json(schema) } : {}),
  });
  const error = z.object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      requestId: z.string(),
    }),
  });
  const errors = Object.fromEntries(
    [400, 401, 403, 415, 429, 500].map((code) => [
      code,
      response('Request rejected', error),
    ]),
  );
  return {
    openapi: '3.1.0',
    info: { title: 'GIF Platform implemented API', version: '0.2.0' },
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'gif_session',
          description:
            'Default cookie name; deployment configuration may override it. HttpOnly, SameSite=Lax, Secure on HTTPS.',
        },
      },
    },
    paths: {
      '/api/v1/health/live': {
        get: {
          responses: {
            200: response(
              'Process is live',
              z.object({ status: z.literal('ok') }),
            ),
          },
        },
      },
      '/api/v1/health/ready': {
        get: {
          responses: {
            200: response('Dependencies ready', readinessSchema),
            503: response('Dependencies unavailable', readinessSchema),
          },
        },
      },
      '/api/v1/auth/login': {
        post: {
          description:
            'Exact configured Origin and application/json required. Fetch Metadata, when present, must be same-origin or none. Rate limited per account and peer IP. Replaces prior session on success.',
          parameters: [
            {
              in: 'header',
              name: 'Origin',
              required: true,
              schema: { type: 'string' },
            },
          ],
          requestBody: { required: true, content: json(loginRequestSchema) },
          responses: {
            ...errors,
            200: {
              ...response(
                'Authenticated; CSRF token is bound to the session',
                loginResponseSchema,
              ),
              headers: {
                'Set-Cookie': {
                  schema: { type: 'string' },
                  description: 'Opaque session cookie with absolute expiry',
                },
              },
            },
          },
        },
      },
      '/api/v1/auth/session': {
        get: {
          description:
            'Optional cookie. Invalid, expired, revoked or disabled-user sessions return authenticated:false. Responses are never cached.',
          responses: {
            200: response('Current session', sessionResponseSchema),
            500: response('Unavailable', error),
          },
        },
      },
      '/api/v1/auth/logout': {
        post: {
          security: [{ sessionCookie: [] }],
          parameters: ['Origin', 'X-CSRF-Token'].map((name) => ({
            in: 'header',
            name,
            required: true,
            schema: { type: 'string' },
          })),
          description:
            'No body or an empty JSON object. Revokes server-side session and expires cookie.',
          responses: { ...errors, 204: response('Revoked and cookie cleared') },
        },
      },
      '/api/v1/review': {
        get: {
          security: [{ sessionCookie: [] }],
          description:
            'B02 reviewer authorization stub only; requires explicit REVIEWER grant.',
          responses: {
            200: response(
              'Reviewer access verified',
              z.object({ message: z.string() }),
            ),
            401: errors[401],
            403: errors[403],
            500: errors[500],
          },
        },
      },
    },
  };
}
