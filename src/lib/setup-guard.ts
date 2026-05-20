/**
 * Break-glass guard for schema-bootstrap endpoints.
 *
 * The /api/setup-db, /api/drizzle-setup, /api/setup-source-db, and
 * /api/migrate-process routes can recreate or mutate the entire schema.
 * They predate the editable-roles work and used to be reachable by any
 * authenticated staff — which means a packer with a leaked cookie could
 * call them.
 *
 * Three independent gates, ALL required to proceed:
 *   1. The caller has `admin.manage_features` (enforced by withAuth).
 *   2. The request carries the `x-setup-token` header matching SETUP_TOKEN.
 *   3. In production (NODE_ENV=production), SETUP_ALLOW_PROD=1 is set.
 *
 * Helper returns a NextResponse to short-circuit when a check fails; the
 * handler returns null when the request is allowed to proceed.
 */

import { NextRequest, NextResponse } from 'next/server';

export function guardSetupRequest(req: NextRequest): NextResponse | null {
  // Production must be explicitly opted in. Stops a developer from running
  // the schema bootstrap against the live DB by accident.
  if (process.env.NODE_ENV === 'production' && process.env.SETUP_ALLOW_PROD !== '1') {
    return NextResponse.json(
      {
        error: 'SETUP_DISABLED_IN_PRODUCTION',
        message: 'Set SETUP_ALLOW_PROD=1 and redeploy if you really need this.',
      },
      { status: 403 },
    );
  }

  const expected = process.env.SETUP_TOKEN || '';
  if (!expected) {
    return NextResponse.json(
      {
        error: 'SETUP_TOKEN_NOT_CONFIGURED',
        message: 'SETUP_TOKEN env var must be set before any setup route can be called.',
      },
      { status: 403 },
    );
  }

  const provided = req.headers.get('x-setup-token') || '';
  if (provided !== expected) {
    return NextResponse.json(
      { error: 'INVALID_SETUP_TOKEN' },
      { status: 403 },
    );
  }

  return null;
}
