import { z } from 'zod';
import {
  publicQuerySchema,
  publicGifsSchema,
  publicDetailSchema,
} from './public.js';
import {
  uploadRequestSchema,
  completeRequestSchema,
  uploadIntentSchema,
  uploadCompletionSchema,
  ownerAssetSchema,
  ownerAssetsSchema,
} from './uploads.js';
export * from './uploads.js';
export * from './review.js';
import {
  decisionRequestSchema,
  removalRequestSchema,
  reviewQuerySchema,
  reviewResultSchema,
  reviewQueueSchema,
  reviewDetailSchema,
} from './review.js';

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

// Generated OpenAPI describes only implemented HTTP routes.
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
    [400, 401, 403, 404, 409, 410, 413, 415, 429, 500, 503].map((code) => [
      code,
      response('Request rejected', error),
    ]),
  );
  return {
    openapi: '3.1.0',
    info: { title: 'GIF Platform implemented API', version: '0.6.0' },
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
      '/api/v1/public/gifs': {
        get: {
          security: [],
          description:
            'Anonymous policy-filtered PostgreSQL FTS and exact normalized tag discovery. Blank q lists recent GIFs. Stable rank/createdAt/id descending signed query-bound keyset cursor; invalid/tampered/mismatched cursors return 400 INVALID_CURSOR. No storage identifiers. Creator displayName is a pseudonymous label, never an account email. Gallery and Picker share the configured per-peer read budget with detail; exhaustion returns 429 RATE_LIMITED and Retry-After. Dependency failure returns 503 with a safe retry message and correlated X-Request-ID.',
          parameters: Object.entries(publicQuerySchema.shape).map(
            ([name, schema]) => ({
              in: 'query',
              name,
              required: false,
              schema: z.toJSONSchema(schema, { io: 'input' }),
            }),
          ),
          responses: {
            ...errors,
            200: response('Eligible public GIFs', publicGifsSchema),
          },
        },
      },
      '/api/v1/public/gifs/{id}': {
        get: {
          security: [],
          parameters: [
            {
              in: 'path',
              name: 'id',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          description:
            'Anonymous eligible detail with description and pseudonymous creator attribution. Every authoritative state gate is checked; all private, rejected, removed and unknown IDs return identical 404 NOT_FOUND. Shares the search read budget; 429 RATE_LIMITED includes Retry-After.',
          responses: {
            ...errors,
            200: response('Eligible GIF detail', publicDetailSchema),
          },
        },
      },
      '/media/{assetId}/{variant}': {
        get: {
          security: [],
          parameters: [
            {
              in: 'path',
              name: 'assetId',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
            {
              in: 'path',
              name: 'variant',
              required: true,
              schema: { type: 'string', enum: ['display.gif', 'poster.png'] },
            },
          ],
          description:
            'Checks every publication, moderation, processing, search, API and technical delivery gate at request start and again after bounded exact-version SHA256 verification. Only sanitized derivatives; no raw storage URLs/keys or original media. Ineligible/unsupported returns 404. Missing/corrupt derivatives return 503 MEDIA_UNAVAILABLE and conditionally record technical DEGRADED with audit; temporary storage failures return 503 without changing business axes. No conditional 304 or range bypass. Client-cached/downloaded copies cannot be revoked. A separate configured per-peer media budget returns 429 RATE_LIMITED; bounded concurrent reads return 503 MEDIA_BUSY, both with Retry-After and no-store.',
          responses: {
            ...errors,
            200: {
              description: 'Verified sanitized derivative',
              headers: {
                'Cache-Control': {
                  schema: { type: 'string' },
                  description:
                    'public, max-age=<configured 0..30>, must-revalidate; errors no-store',
                },
                ETag: {
                  schema: { type: 'string' },
                  description: 'Quoted verified SHA256',
                },
                'Content-Length': { schema: { type: 'integer' } },
                'X-Content-Type-Options': { schema: { const: 'nosniff' } },
                'Cross-Origin-Resource-Policy': {
                  schema: { const: 'same-origin' },
                },
              },
              content: {
                'image/gif': { schema: { type: 'string', format: 'binary' } },
                'image/png': { schema: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
      },
      '/api/v1/review/queue': {
        get: {
          security: [{ sessionCookie: [] }],
          description:
            'REVIEWER only. SUCCEEDED/PENDING queue ordered by createdAt/id descending, bounded UUID keyset pagination.',
          parameters: Object.entries(reviewQuerySchema.shape).map(
            ([name, schema]) => ({
              in: 'query',
              name,
              required: false,
              schema: z.toJSONSchema(schema, { io: 'input' }),
            }),
          ),
          responses: {
            ...errors,
            200: response('Pending review queue', reviewQueueSchema),
          },
        },
      },
      '/api/v1/review/assets/{assetId}': {
        get: {
          security: [{ sessionCookie: [] }],
          parameters: [
            {
              in: 'path',
              name: 'assetId',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          description:
            'REVIEWER only. Metadata, independent states, private derivative preview paths and append-only decision/audit history. No object keys, versions or source URL.',
          responses: {
            ...errors,
            200: response('Private reviewer detail', reviewDetailSchema),
          },
        },
      },
      '/api/v1/review/assets/{assetId}/media/{variant}': {
        get: {
          security: [{ sessionCookie: [] }],
          parameters: [
            {
              in: 'path',
              name: 'assetId',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
            {
              in: 'path',
              name: 'variant',
              required: true,
              schema: { type: 'string', enum: ['DISPLAY_GIF', 'POSTER_PNG'] },
            },
          ],
          description:
            'REVIEWER only; exact private derivative version with SHA256 verification. Never quarantine. No redirects or signed GET URLs; no-store, nosniff, same-origin.',
          responses: {
            ...errors,
            200: {
              description: 'Private verified preview',
              content: {
                'image/gif': { schema: { type: 'string', format: 'binary' } },
                'image/png': { schema: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
      },
      ...Object.fromEntries(
        ['decision', 'remove'].map((operation) => [
          `/api/v1/review/assets/{assetId}/${operation}`,
          {
            post: {
              security: [{ sessionCookie: [] }],
              parameters: [
                {
                  in: 'path',
                  name: 'assetId',
                  required: true,
                  schema: { type: 'string', format: 'uuid' },
                },
                ...['Origin', 'X-CSRF-Token'].map((name) => ({
                  in: 'header',
                  name,
                  required: true,
                  schema: { type: 'string' },
                })),
              ],
              description:
                operation === 'decision'
                  ? 'REVIEWER and non-owner only. Locked version-guarded APPROVE/REJECT with decision, audit and search projection transaction. Approval verifies exact derivative HEAD, rights v1, technical readiness and PENDING. Exact replay by same actor/input version/semantics returns current state only while still current; other stale/conflicting inputs return 409.'
                  : 'REVIEWER and non-owner only. APPROVED to REMOVED, authorization restriction and projection deletion atomically. Reason required. Exact current replay is idempotent; conflicts return 409. Subsequent public API and media-origin requests are denied after commit.',
              requestBody: {
                required: true,
                content: json(
                  operation === 'decision'
                    ? decisionRequestSchema
                    : removalRequestSchema,
                ),
              },
              responses: {
                ...errors,
                200: response('Committed moderation state', reviewResultSchema),
              },
            },
          },
        ]),
      ),
      '/api/v1/uploads': {
        post: {
          security: [{ sessionCookie: [] }],
          description:
            'UPLOADER only. Private quarantine intent; same owner/key and normalized metadata reuse one asset until expiry. Conflicting metadata returns 409 IDEMPOTENCY_CONFLICT. No file decoding or publication.',
          parameters: ['Origin', 'X-CSRF-Token', 'Idempotency-Key'].map(
            (name) => ({
              in: 'header',
              name,
              required: true,
              schema: { type: 'string' },
            }),
          ),
          requestBody: { required: true, content: json(uploadRequestSchema) },
          responses: {
            ...errors,
            201: response(
              'Private upload intent (including replay)',
              uploadIntentSchema,
            ),
          },
        },
      },
      '/api/v1/uploads/{uploadId}/complete': {
        post: {
          security: [{ sessionCookie: [] }],
          description:
            'Owner with UPLOADER grant and CSRF. Real versioned S3 HEAD; atomically persists receipt, states, READY job and audit. Idempotent replay returns current receipt even after deadline. Unreceived expired session returns 410.',
          parameters: [
            {
              in: 'path',
              name: 'uploadId',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
            ...['Origin', 'X-CSRF-Token'].map((name) => ({
              in: 'header',
              name,
              required: true,
              schema: { type: 'string' },
            })),
          ],
          requestBody: { required: true, content: json(completeRequestSchema) },
          responses: {
            ...errors,
            202: response(
              'Received privately; processing queued, not processed or published',
              uploadCompletionSchema,
            ),
          },
        },
      },
      '/api/v1/me/assets': {
        get: {
          security: [{ sessionCookie: [] }],
          description:
            'Owner receipts only, newest first; UUID keyset cursor, 24 rows. No media URLs or quarantine metadata.',
          parameters: [
            {
              in: 'query',
              name: 'cursor',
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            ...errors,
            200: response('Private owner receipts', ownerAssetsSchema),
          },
        },
      },
      '/api/v1/me/assets/{assetId}': {
        get: {
          security: [{ sessionCookie: [] }],
          parameters: [
            {
              in: 'path',
              name: 'assetId',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            ...errors,
            200: response(
              'Private owner status; other owners receive 404',
              ownerAssetSchema,
            ),
          },
        },
      },
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
            'Reviewer authorization checkpoint; requires explicit REVIEWER grant. B05 workflow routes are under /review/queue and /review/assets.',
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
export * from './processing.js';
export * from './public.js';
export * from './picker.js';
