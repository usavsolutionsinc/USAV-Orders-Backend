import { NextRequest, NextResponse } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { getAppBaseUrl } from '@/lib/qstash';
import { InventorySyncService } from '@/services/InventorySyncService';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handleZohoItemSync(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const mode = String(body.type ?? 'incremental').trim().toLowerCase() === 'full' ? 'full' : 'incremental';
  const service = new InventorySyncService();
  const result = mode === 'full' ? await service.fullSync() : await service.incrementalSync();
  return NextResponse.json({
    success: true,
    queue: 'qstash',
    job: 'zoho-items-sync',
    mode,
    ...result,
  });
}

export const POST = verifySignatureAppRouter(handleZohoItemSync, {
  url: `${getAppBaseUrl()}/api/qstash/zoho/items/sync`,
});

export async function GET() {
  return NextResponse.json({ ok: true, queue: 'qstash', job: 'zoho-items-sync' });
}
