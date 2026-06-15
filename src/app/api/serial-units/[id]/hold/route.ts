import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';
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
 * /admin/inventory/holds admin page too).
 *
 * Permission: sku_stock.adjust.
 */
export const POST = withAuth(async (request, ctx) => {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const idStr = segments[segments.length - 2];
  const serialUnitId = Number(idStr);
  if (!Number.isFinite(serialUnitId) || serialUnitId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const actorStaffId: number | null =
    typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;

  const orgId = ctx.organizationId;

  try {
    // Org-ownership 404 gate (never 403). holdUnit() runs on the bypass owner
    // pool with no organization_id predicate (serial_units WHERE id=$1), so
    // without this pre-check a user in org A could move another org's unit to
    // ON_HOLD and write a HELD inventory_events row. serial_units is
    // tenant-owned, so a cross-tenant id matches zero rows here → 404, and the
    // backbone call never runs.
    const owns = await tenantQuery<{ id: number }>(
      orgId,
      `SELECT id FROM serial_units WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [serialUnitId, orgId],
    );
    if (owns.rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'serial_units row not found' }, { status: 404 });
    }

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
