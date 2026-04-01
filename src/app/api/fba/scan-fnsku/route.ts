import { NextRequest, NextResponse } from 'next/server';
import { POST as unifiedScan } from '@/app/api/tech/scan/route';

/**
 * GET /api/fba/scan-fnsku — FBA workspace wrapper around the unified scan route.
 * Keeps FBA-origin FNSKU scans classified as FBA instead of TECH.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fnsku = searchParams.get('fnsku');
  const staffId = searchParams.get('staffId') || searchParams.get('techId');

  if (!fnsku) return NextResponse.json({ error: 'FNSKU is required' }, { status: 400 });
  if (!staffId) return NextResponse.json({ error: 'Staff ID is required' }, { status: 400 });

  const syntheticReq = new NextRequest(req.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'FNSKU',
      value: fnsku.trim(),
      techId: Number(staffId),
      sourceStation: 'FBA',
    }),
  });

  return unifiedScan(syntheticReq);
}
