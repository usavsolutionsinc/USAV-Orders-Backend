import { NextRequest, NextResponse } from 'next/server';
import { POST as unifiedScan } from '@/app/api/tech/scan/route';

/**
 * Legacy GET /api/tech/scan-fnsku — thin wrapper around POST /api/tech/scan.
 * Converts query params to the unified body format.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fnsku = searchParams.get('fnsku');
  const techId = searchParams.get('techId');

  if (!fnsku) return NextResponse.json({ error: 'FNSKU is required' }, { status: 400 });
  if (!techId) return NextResponse.json({ error: 'Tech ID is required' }, { status: 400 });

  const syntheticReq = new NextRequest(req.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'FNSKU', value: fnsku.trim(), techId: Number(techId) }),
  });

  return unifiedScan(syntheticReq);
}
