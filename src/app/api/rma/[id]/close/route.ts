import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { isInventoryV2Rma } from '@/lib/feature-flags';
import { closeAuthorization } from '@/lib/rma/authorizations';

/**
 * POST /api/rma/[id]/close
 *
 * RECEIVED / DISPOSITIONED → CLOSED. Returns 409 if the RMA is still
 * AUTHORIZED (nothing was received) or already CLOSED/EXPIRED/CANCELED.
 *
 * Gated by INVENTORY_V2_RMA.
 */
export const POST = withAuth(async (request, ctx) => {
  if (!isInventoryV2Rma()) {
    return NextResponse.json(
      { ok: false, error: 'INVENTORY_V2_RMA flag is OFF', flag: 'INVENTORY_V2_RMA' },
      { status: 503 },
    );
  }
  if (typeof ctx.staffId !== 'number' || ctx.staffId <= 0) {
    return NextResponse.json({ ok: false, error: 'authenticated staff required' }, { status: 401 });
  }

  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const idStr = segments[segments.length - 2];
  const rmaId = Number(idStr);
  if (!Number.isFinite(rmaId) || rmaId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid rma id' }, { status: 400 });
  }

  try {
    const result = await closeAuthorization({ rmaId });
    if (!result.ok) return NextResponse.json(result, { status: result.status });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'close failed';
    console.error('[POST /api/rma/[id]/close] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'orders.view' });
