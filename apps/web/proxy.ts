import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
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
    /* Fail closed on authentication dependency failure. */
  }
  const headers = {
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  };
  if (status === 200) {
    const response = NextResponse.next();
    for (const [key, value] of Object.entries(headers))
      response.headers.set(key, value);
    return response;
  }
  return new Response(
    status === 401
      ? 'Sign in required'
      : status === 403
        ? 'Access denied'
        : 'Review access check unavailable',
    { status, headers },
  );
}
export const config = { matcher: ['/review/:path*'] };
