import { NextRequest, NextResponse } from 'next/server';
import { POST as unifiedScan } from '@/app/api/tech/scan/route';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * Legacy GET /api/tech/scan-fnsku — thin wrapper around POST /api/tech/scan.
 * Converts query params to the unified body format.
 * Actor is server-derived from the verified session.
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
    body: JSON.stringify({ type: 'FNSKU', value: fnsku.trim(), techId: ctx.staffId }),
  });

  return unifiedScan(syntheticReq, { params: Promise.resolve({}) });
}, { permission: 'tech.scan_serial' });
