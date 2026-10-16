// No DB access in web: the API performs the authoritative authentication/role check.
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  let status = 503;
  try {
    const response = await fetch(
      `${process.env.API_INTERNAL_URL ?? 'http://api:4000'}/api/v1/review`,
      {
        headers: { cookie: request.headers.get('cookie') ?? '' },
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      },
    );
    status = [200, 401, 403].includes(response.status) ? response.status : 503;
  } catch {
    /* Show an honest dependency failure without internal details. */
  }
  const message =
    status === 200
      ? 'Reviewer access verified. Moderation workflow is not implemented.'
      : status === 401
        ? 'Sign in required'
        : status === 403
          ? 'Access denied'
          : 'Review access check unavailable';
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Review access — GIF Platform</title><body><main><h1>Review access</h1><p>${message}</p><p><a href="/login">Sign in or sign out</a></p><p><a href="/">Public home</a></p></main></body></html>`,
    {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy':
          "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      },
    },
  );
}
