import { NextRequest } from 'next/server';
import { POST as unifiedScan } from '@/app/api/tech/scan/route';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * Legacy POST /api/tech/scan-tracking — thin wrapper around POST /api/tech/scan.
 * Converts { tracking, ... } to the unified { type, value, ... } format.
 * Actor is server-derived; body.techId is ignored.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => ({}));

  // Forward the original headers (incl. Cookie) so the unified handler's
  // withAuth gate sees the same session.
  const headers = new Headers(req.headers);
  headers.set('Content-Type', 'application/json');

  const syntheticReq = new NextRequest(req.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 'TRACKING',
      value: body.tracking || '',
      techId: ctx.staffId,
      idempotencyKey: body.idempotencyKey,
    }),
  });

  return unifiedScan(syntheticReq, { params: Promise.resolve({}) });
}, { permission: 'tech.scan_serial' });
