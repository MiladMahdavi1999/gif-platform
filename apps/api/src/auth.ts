import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { loginRequestSchema } from '@gif/contracts';
import {
  createDummyPasswordHash,
  verifyPassword,
  type AuthRepository,
  type StoredSession,
  type Role,
} from '@gif/db';

export interface AuthOptions {
  repository: AuthRepository;
  origin: string;
  cookieName: string;
  ttlSeconds: number;
  secure: boolean;
  limiter?: LoginLimiter;
}
declare module 'fastify' {
  interface FastifyRequest {
    authSession: StoredSession | null;
    sessionToken: string | null;
  }
}
export const digest = (value: string) =>
  createHash('sha256').update(value).digest();
export const csrfFor = (token: string) =>
  createHmac('sha256', token)
    .update('gif-platform:csrf:v1')
    .digest('base64url');
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
function cookieToken(header: string | undefined, name: string) {
  const values = (header ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const value = values[0]!.slice(name.length + 1);
  return tokenPattern.test(value) ? value : null;
}
export function fail(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
) {
  return reply
    .code(status)
    .send({ error: { code, message, requestId: request.id } });
}
export async function requireAuthentication(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!request.authSession)
    return fail(request, reply, 401, 'UNAUTHENTICATED', 'Sign in required');
}
export function requireRole(role: Role) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuthentication(request, reply);
    if (!reply.sent && !request.authSession!.user.roles.includes(role))
      return fail(request, reply, 403, 'FORBIDDEN', 'Access denied');
  };
}

// Bounded, process-local fixed windows. Never trust user-supplied forwarded IPs.
export class LoginLimiter {
  private entries = new Map<string, { count: number; until: number }>();
  constructor(
    private accountLimit = 10,
    private ipLimit = 50,
    private windowMs = 900000,
    private capacity = 10000,
    private now = Date.now,
  ) {}
  consume(ip: string, email: string): number {
    const now = this.now();
    for (const [key, value] of this.entries)
      if (value.until <= now) this.entries.delete(key);
    const keys = [
      [`ip:${ip}`, this.ipLimit],
      [`account:${digest(email).toString('hex')}`, this.accountLimit],
    ] as const;
    let wait = 0;
    for (const [key, limit] of keys) {
      const value = this.entries.get(key);
      if (!value && this.entries.size >= this.capacity)
        return Math.ceil(this.windowMs / 1000);
      if (value && value.count >= limit)
        wait = Math.max(wait, Math.ceil((value.until - now) / 1000));
    }
    if (wait) return wait;
    for (const [key] of keys) {
      const value = this.entries.get(key) ?? {
        count: 0,
        until: now + this.windowMs,
      };
      value.count++;
      this.entries.set(key, value);
    }
    return 0;
  }
}

export async function installAuth(app: FastifyInstance, options: AuthOptions) {
  const { repository, cookieName } = options;
  const dummyHash = await createDummyPasswordHash();
  const limiter = options.limiter ?? new LoginLimiter();
  const cookie = (value: string, expires: Date, maxAge: number) =>
    `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Expires=${expires.toUTCString()}${options.secure ? '; Secure' : ''}`;
  app.decorateRequest('authSession', null);
  app.decorateRequest('sessionToken', null);
  app.addHook('onRequest', async (request, reply) => {
    if (safeMethods.has(request.method)) return;
    const site = request.headers['sec-fetch-site'];
    if (
      request.headers.origin !== options.origin ||
      (site !== undefined && site !== 'same-origin' && site !== 'none')
    )
      return fail(
        request,
        reply,
        403,
        'ORIGIN_REJECTED',
        'Request origin rejected',
      );
    if (
      request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !==
        'application/json' &&
      ((request.headers['content-length'] !== undefined &&
        request.headers['content-length'] !== '0') ||
        request.headers['transfer-encoding'] !== undefined ||
        request.url.split('?')[0] === '/api/v1/auth/login')
    )
      return fail(
        request,
        reply,
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'Use application/json',
      );
  });
  app.addHook('preHandler', async (request, reply) => {
    // Health probes remain independent from authentication dependencies.
    if (request.routeOptions.url?.startsWith('/api/v1/health/')) return;
    const token = cookieToken(request.headers.cookie, cookieName);
    if (token) {
      const session = await repository.findSession(digest(token));
      if (
        session &&
        timingSafeEqual(digest(csrfFor(token)), session.csrfTokenHash)
      ) {
        request.authSession = session;
        request.sessionToken = token;
      } else reply.header('Set-Cookie', cookie('', new Date(0), 0));
    }
    if (
      !safeMethods.has(request.method) &&
      request.routeOptions.url !== '/api/v1/auth/login' &&
      request.authSession
    ) {
      const csrf = request.headers['x-csrf-token'];
      if (
        typeof csrf !== 'string' ||
        !tokenPattern.test(csrf) ||
        !timingSafeEqual(digest(csrf), request.authSession.csrfTokenHash)
      )
        return fail(
          request,
          reply,
          403,
          'CSRF_REJECTED',
          'Request verification failed',
        );
    }
  });
  app.post('/api/v1/auth/login', async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    // Invalid input still consumes the IP budget; never retain password input.
    const email = parsed.success ? parsed.data.email : '';
    const retry = limiter.consume(request.ip, email);
    if (retry) {
      reply.header('Retry-After', retry);
      return fail(
        request,
        reply,
        429,
        'RATE_LIMITED',
        'Too many login attempts. Try again later.',
      );
    }
    if (!parsed.success)
      return fail(
        request,
        reply,
        400,
        'VALIDATION_ERROR',
        'Enter a valid email and password',
      );
    const user = await repository.findUser(email);
    const valid = await verifyPassword(
      user?.passwordHash ?? dummyHash,
      parsed.data.password,
    );
    if (!user || !valid || user.status !== 'ACTIVE')
      return fail(
        request,
        reply,
        401,
        'INVALID_CREDENTIALS',
        'Invalid email or password',
      );
    const token = randomBytes(32).toString('base64url');
    const csrfToken = csrfFor(token);
    const expires = new Date(Date.now() + options.ttlSeconds * 1000);
    const previous = cookieToken(request.headers.cookie, cookieName);
    await repository.createSession(
      user.id,
      digest(token),
      digest(csrfToken),
      expires,
      previous ? digest(previous) : undefined,
    );
    reply.header('Set-Cookie', cookie(token, expires, options.ttlSeconds));
    return {
      user: { id: user.id, email: user.email, roles: user.roles },
      csrfToken,
    };
  });
  app.get('/api/v1/auth/session', async (request) =>
    request.authSession
      ? {
          authenticated: true,
          user: request.authSession.user,
          csrfToken: csrfFor(request.sessionToken!),
        }
      : { authenticated: false },
  );
  app.post(
    '/api/v1/auth/logout',
    { preHandler: requireAuthentication },
    async (request, reply) => {
      if (
        request.body !== undefined &&
        (typeof request.body !== 'object' ||
          request.body === null ||
          Array.isArray(request.body) ||
          Object.keys(request.body).length)
      )
        return fail(
          request,
          reply,
          400,
          'VALIDATION_ERROR',
          'Logout takes no fields',
        );
      await repository.revokeSession(digest(request.sessionToken!));
      return reply
        .header('Set-Cookie', cookie('', new Date(0), 0))
        .code(204)
        .send();
    },
  );
  app.get(
    '/api/v1/review',
    { preHandler: requireRole('REVIEWER') },
    async () => ({
      message:
        'Reviewer access verified. Moderation workflow is not implemented.',
    }),
  );
}
