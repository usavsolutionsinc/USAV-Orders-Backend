/**
 * Liveness endpoint — always 200 when the process can serve a request.
 *
 * Use this for orchestrator/load-balancer liveness probes that should restart
 * the process if it doesn't respond, NOT for readiness (DB/Redis). That's
 * /api/ready.
 *
 * Public (allowlisted in proxy.ts). Never returns sensitive info — the
 * version is read from APP_VERSION or VERCEL_GIT_COMMIT_SHA so an unauthed
 * curl reveals only the deploy SHA.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(): NextResponse {
  const version =
    process.env.APP_VERSION ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    'unknown';
  return NextResponse.json(
    {
      status: 'ok',
      version,
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
