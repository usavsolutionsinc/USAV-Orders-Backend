import { NextRequest, NextResponse } from 'next/server';
import { isQStashOrigin } from '@/lib/qstash';
import { InventorySyncService } from '@/services/InventorySyncService';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (!isQStashOrigin(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const mode = String(body.type ?? 'incremental').trim().toLowerCase() === 'full' ? 'full' : 'incremental';
  try {
    const service = new InventorySyncService();
    const result = mode === 'full' ? await service.fullSync() : await service.incrementalSync();
    return NextResponse.json({
      success: true,
      queue: 'qstash',
      job: 'zoho-items-sync',
      mode,
      ...result,
    });
  } catch (error: any) {
    console.error('[qstash/zoho/items/sync]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal error' },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, queue: 'qstash', job: 'zoho-items-sync' });
}
