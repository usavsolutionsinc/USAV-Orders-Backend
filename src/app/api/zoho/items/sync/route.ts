import { NextRequest, NextResponse } from 'next/server';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';
import { enqueueQStashJson, getQStashResultIdentifier } from '@/lib/qstash';
import { InventorySyncService } from '@/services/InventorySyncService';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function getRequestedMode(request: NextRequest, body: Record<string, unknown>) {
  const fromQuery = request.nextUrl.searchParams.get('type');
  const raw = String(body.type ?? fromQuery ?? 'incremental').trim().toLowerCase();
  return raw === 'full' ? 'full' : 'incremental';
}

async function runItemSync(mode: 'full' | 'incremental') {
  const service = new InventorySyncService();
  const result = mode === 'full' ? await service.fullSync() : await service.incrementalSync();
  return {
    success: true,
    mode,
    queue: 'qstash',
    ...result,
  };
}

export async function POST(request: NextRequest) {
  if (!isAllowedAdminOrigin(request)) {
    return NextResponse.json({ success: false, error: 'Origin not allowed' }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const mode = getRequestedMode(request, body);
    const shouldEnqueue = body.enqueue === true || request.nextUrl.searchParams.get('enqueue') === 'true';

    if (shouldEnqueue) {
      const result = await enqueueQStashJson({
        path: '/api/qstash/zoho/items/sync',
        body: { type: mode },
        retries: 3,
        timeout: 300,
        label: mode === 'full' ? 'zoho-items-full-sync' : 'zoho-items-incremental-sync',
      });
      return NextResponse.json({
        success: true,
        queued: true,
        mode,
        messageId: getQStashResultIdentifier(result),
      });
    }

    return NextResponse.json(await runItemSync(mode));
  } catch (error: any) {
    console.error('[zoho/items/sync]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to sync Zoho items' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  if (!isAllowedAdminOrigin(request)) {
    return NextResponse.json({ success: false, error: 'Origin not allowed' }, { status: 403 });
  }

  return NextResponse.json({
    success: true,
    queue: 'qstash',
    job: 'zoho-items-sync',
  });
}
