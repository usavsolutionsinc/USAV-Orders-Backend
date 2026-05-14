import { NextResponse, type NextRequest } from 'next/server';

/**
 * Legacy /m/* QR-code landing routes → canonical paths.
 * Printed labels keep working; the request rewrites server-side (no extra round-trip).
 *
 * Device-specific routes stay at /m/* (pair, pair-needed, scan, and /m/r/* camera capture).
 */
const REWRITES: Array<{ prefix: string; target: string }> = [
  { prefix: '/m/b/', target: '/bin/' },
  { prefix: '/m/l/', target: '/receiving/lines/' },
  { prefix: '/m/u/', target: '/serial/' },
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  for (const { prefix, target } of REWRITES) {
    if (pathname.startsWith(prefix)) {
      const url = request.nextUrl.clone();
      url.pathname = target + pathname.slice(prefix.length);
      return NextResponse.rewrite(url);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/m/b/:path*', '/m/l/:path*', '/m/u/:path*'],
};
