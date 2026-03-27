import { NextRequest } from 'next/server';
import { POST as unifiedScan } from '@/app/api/tech/scan/route';

/**
 * Legacy POST /api/tech/scan-tracking — thin wrapper around POST /api/tech/scan.
 * Converts { tracking, techId, ... } to the unified { type, value, techId, ... } format.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  const syntheticReq = new NextRequest(req.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'TRACKING',
      value: body.tracking || '',
      techId: body.techId,
      idempotencyKey: body.idempotencyKey,
    }),
  });

  return unifiedScan(syntheticReq);
}
