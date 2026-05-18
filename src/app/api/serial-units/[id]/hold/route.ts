import { NextResponse } from 'next/server';
import { transaction } from '@/lib/neon-client';
import { withAuth } from '@/lib/auth/withAuth';
import { isInventoryV2Returns } from '@/lib/feature-flags';

/**
 * POST /api/serial-units/[id]/hold
 *
 * Phase 7 quarantine workflow. Moves a unit into ON_HOLD while remembering
 * its previous lifecycle state in the inventory_events payload so the
 * companion /api/serial-units/[id]/release endpoint can restore it.
 *
 * Body:
 *   { reason: string, client_event_id?: string }
 *
 * Returns 409 if the unit is already ON_HOLD (no double-hold).
 *
 * Gated by INVENTORY_V2_RETURNS; off-flag returns 503.
 * Permission: sku_stock.adjust (closest existing permission for an
 * inventory hold action).
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
  const reason = String(body?.reason || '').trim();
  if (!reason) {
    return NextResponse.json({ ok: false, error: 'reason is required' }, { status: 400 });
  }
  const clientEventId = String(body?.client_event_id || '').trim() || null;

  const actorStaffId: number | null =
    typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;

  try {
    const result = await transaction(async (client) => {
      const unitQ = await client.query<{ id: number; sku: string | null; current_status: string }>(
        `SELECT id, sku, current_status::text AS current_status
           FROM serial_units WHERE id = $1 LIMIT 1 FOR UPDATE`,
        [serialUnitId],
      );
      const unit = unitQ.rows[0];
      if (!unit) return { ok: false as const, status: 404, error: 'serial_units row not found' };
      if (unit.current_status === 'ON_HOLD') {
        return { ok: false as const, status: 409, error: 'unit is already ON_HOLD' };
      }

      await client.query(
        `UPDATE serial_units
            SET current_status = 'ON_HOLD'::serial_status_enum,
                updated_at = NOW()
          WHERE id = $1`,
        [unit.id],
      );

      const ev = await client.query<{ id: number }>(
        `INSERT INTO inventory_events (
           event_type, actor_staff_id, station,
           serial_unit_id, sku,
           prev_status, next_status,
           client_event_id, notes, payload
         )
         VALUES ('HELD', $1, 'SYSTEM',
                 $2, $3,
                 $4, 'ON_HOLD',
                 $5, $6, $7::jsonb)
         ON CONFLICT (client_event_id) DO NOTHING
         RETURNING id`,
        [
          actorStaffId, unit.id, unit.sku, unit.current_status, clientEventId, reason,
          JSON.stringify({
            source: 'serial-units.hold',
            restore_status: unit.current_status,
          }),
        ],
      );

      return {
        ok: true as const,
        serialUnitId: unit.id,
        prevStatus: unit.current_status,
        nextStatus: 'ON_HOLD',
        restoreStatus: unit.current_status,
        inventoryEventId: ev.rows[0]?.id ?? null,
      };
    });

    if (!result.ok) return NextResponse.json(result, { status: result.status });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'hold failed';
    console.error('[POST /api/serial-units/[id]/hold] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'sku_stock.adjust' });
