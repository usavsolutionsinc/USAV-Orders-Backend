import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { isInventoryV2Returns } from '@/lib/feature-flags';
import { releaseUnit } from '@/lib/inventory/hold';

/**
 * POST /api/serial-units/[id]/release
 *
 * Companion to /hold. Restores a unit from ON_HOLD to its previous
 * lifecycle state. The restore target is read from the most recent
 * HELD event's payload.restore_status; falls back to STOCKED.
 *
 * Body:
 *   { reason?: string, force_status?: string, client_event_id?: string }
 *
 * `force_status` overrides the auto-recovered target (e.g. 'TRIAGED' to
 * route a held unit back into the refurb flow).
 *
 * Returns 409 if the unit isn't currently ON_HOLD.
 *
 * Shared logic in src/lib/inventory/hold.ts.
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
    const result = await releaseUnit({
      serialUnitId,
      reason: String(body?.reason || '').trim() || null,
      forceStatus: String(body?.force_status || '').trim() || null,
      clientEventId: String(body?.client_event_id || '').trim() || null,
      actorStaffId,
    });
    if (!result.ok) return NextResponse.json(result, { status: result.status });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'release-hold failed';
    console.error('[POST /api/serial-units/[id]/release] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'sku_stock.adjust' });
