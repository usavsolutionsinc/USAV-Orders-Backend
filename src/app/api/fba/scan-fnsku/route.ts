import { NextRequest, NextResponse } from 'next/server';
import { POST as unifiedScan } from '@/app/api/tech/scan/route';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * GET /api/fba/scan-fnsku — FBA workspace wrapper around the unified scan route.
 * Keeps FBA-origin FNSKU scans classified as FBA instead of TECH.
 *
 * Identity is server-derived from the session cookie. Legacy `?staffId=` /
 * `?techId=` query params are ignored.
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  const { searchParams } = new URL(req.url);
  const fnsku = searchParams.get('fnsku');

  if (!fnsku) return NextResponse.json({ error: 'FNSKU is required' }, { status: 400 });

  const headers = new Headers(req.headers);
  headers.set('Content-Type', 'application/json');
  const syntheticReq = new NextRequest(req.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 'FNSKU',
      value: fnsku.trim(),
      techId: ctx.staffId,
      sourceStation: 'FBA',
    }),
  });

  return unifiedScan(syntheticReq, { params: Promise.resolve({}) });
}, { permission: 'fba.stage_shipments' });
