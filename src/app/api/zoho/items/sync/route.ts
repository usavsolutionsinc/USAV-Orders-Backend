import { NextRequest, NextResponse } from 'next/server';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';
import { InventorySyncService } from '@/services/InventorySyncService';
import { withAuth } from '@/lib/auth/withAuth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function getRequestedMode(request: NextRequest, body: Record<string, unknown>) {
  const fromQuery = request.nextUrl.searchParams.get('type');
  const raw = String(body.type ?? fromQuery ?? 'incremental').trim().toLowerCase();
  return raw === 'full' ? 'full' : 'incremental';
}

async function runItemSync(orgId: string, mode: 'full' | 'incremental') {
  const service = new InventorySyncService(orgId);
  const result = mode === 'full' ? await service.fullSync() : await service.incrementalSync();
  return {
    success: true,
    mode,
    ...result,
  };
}

export const POST = withAuth(async (request: NextRequest, ctx) => {
  if (!isAllowedAdminOrigin(request)) {
    return NextResponse.json({ success: false, error: 'Origin not allowed' }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const mode = getRequestedMode(request, body);
    return NextResponse.json(await runItemSync(ctx.organizationId, mode));
  } catch (error: any) {
    console.error('[zoho/items/sync]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to sync Zoho items' },
      { status: 500 }
    );
  }
}, { permission: 'integrations.zoho' });

export const GET = withAuth(async (request: NextRequest) => {
  if (!isAllowedAdminOrigin(request)) {
    return NextResponse.json({ success: false, error: 'Origin not allowed' }, { status: 403 });
  }

  return NextResponse.json({
    success: true,
    job: 'zoho-items-sync',
  });
}, { permission: 'integrations.zoho' });
