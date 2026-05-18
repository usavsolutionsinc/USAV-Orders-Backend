import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { isInventoryV2Returns } from '@/lib/feature-flags';
import { holdUnit } from '@/lib/inventory/hold';

/**
 * POST /api/serial-units/[id]/hold
 *
 * Phase 7 quarantine workflow. Moves a unit into ON_HOLD; the previous
 * lifecycle state is stashed in inventory_events.payload.restore_status
 * so /api/serial-units/[id]/release can roll it back.
 *
 * Body: { reason: string, client_event_id?: string }
 * Returns 409 if the unit is already ON_HOLD.
 *
 * Shared logic lives in src/lib/inventory/hold.ts (used by the
 * /admin/inventory-v2/holds admin page too).
 *
 * Gated by INVENTORY_V2_RETURNS; off-flag returns 503.
 * Permission: sku_stock.adjust.
 */
export const POST = withAuth(async (request, ctx) => {
  if (!isInventoryV2Returns()) {
    return NextResponse.json(
      { ok: false, error: 'INVENTORY_V2_RETURNS flag is OFF', flag: 'INVENTORY_V2_RETURNS' },
      { status: 503 },
    );
  }

  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const idStr = segments[segments.length - 2];
  const serialUnitId = Number(idStr);
  if (!Number.isFinite(serialUnitId) || serialUnitId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const actorStaffId: number | null =
    typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;

  try {
    const result = await holdUnit({
      serialUnitId,
      reason: String(body?.reason || '').trim(),
      clientEventId: String(body?.client_event_id || '').trim() || null,
      actorStaffId,
    });
    if (!result.ok) return NextResponse.json(result, { status: result.status });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'hold failed';
    console.error('[POST /api/serial-units/[id]/hold] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'sku_stock.adjust' });
