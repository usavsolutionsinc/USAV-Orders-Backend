import { NextResponse } from 'next/server';
import { transaction } from '@/lib/neon-client';
import { withAuth } from '@/lib/auth/withAuth';
import { isInventoryV2Returns } from '@/lib/feature-flags';

/**
 * POST /api/serial-units/[id]/release
 *
 * Companion to /api/serial-units/[id]/hold. Restores a unit from ON_HOLD
 * to its previous lifecycle state. The restore target is read from the
 * most recent HELD inventory_event's payload.restore_status; if that
 * row is missing or the value is unknown, defaults to STOCKED so the
 * unit re-enters general inventory rather than getting stuck.
 *
 * Body:
 *   { reason?: string, force_status?: string, client_event_id?: string }
 *
 * `force_status` overrides the auto-recovered target — handy when an
 * operator knows the unit shouldn't go straight back to STOCKED (e.g.
 * 'TRIAGED' so it re-enters the refurb flow).
 *
 * Returns 409 if the unit isn't currently ON_HOLD.
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
  const reason = String(body?.reason || '').trim() || null;
  const forceStatus = String(body?.force_status || '').trim().toUpperCase() || null;
  const clientEventId = String(body?.client_event_id || '').trim() || null;

  const validStatuses = new Set([
    'STOCKED', 'TRIAGED', 'IN_REPAIR', 'REPAIR_DONE', 'IN_TEST',
    'GRADED', 'ALLOCATED', 'PICKED', 'PACKED', 'LABELED', 'STAGED',
  ]);
  if (forceStatus && !validStatuses.has(forceStatus)) {
    return NextResponse.json(
      { ok: false, error: `force_status invalid: ${forceStatus}` },
      { status: 400 },
    );
  }

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
      if (unit.current_status !== 'ON_HOLD') {
        return {
          ok: false as const,
          status: 409,
          error: 'unit is not ON_HOLD',
          currentStatus: unit.current_status,
        };
      }

      // Recover the pre-hold status from the most recent HELD event.
      let restoreStatus = forceStatus ?? 'STOCKED';
      if (!forceStatus) {
        const heldQ = await client.query<{ restore_status: string | null }>(
          `SELECT payload->>'restore_status' AS restore_status
             FROM inventory_events
            WHERE serial_unit_id = $1
              AND event_type = 'HELD'
            ORDER BY occurred_at DESC, id DESC
            LIMIT 1`,
          [unit.id],
        );
        const candidate = heldQ.rows[0]?.restore_status?.toUpperCase() ?? null;
        if (candidate && validStatuses.has(candidate)) restoreStatus = candidate;
      }

      await client.query(
        `UPDATE serial_units
            SET current_status = $1::serial_status_enum,
                updated_at = NOW()
          WHERE id = $2`,
        [restoreStatus, unit.id],
      );

      const ev = await client.query<{ id: number }>(
        `INSERT INTO inventory_events (
           event_type, actor_staff_id, station,
           serial_unit_id, sku,
           prev_status, next_status,
           client_event_id, notes, payload
         )
         VALUES ('RELEASED_HOLD', $1, 'SYSTEM',
                 $2, $3,
                 'ON_HOLD', $4,
                 $5, $6, $7::jsonb)
         ON CONFLICT (client_event_id) DO NOTHING
         RETURNING id`,
        [
          actorStaffId, unit.id, unit.sku, restoreStatus, clientEventId, reason,
          JSON.stringify({
            source: 'serial-units.release',
            forced: !!forceStatus,
          }),
        ],
      );

      return {
        ok: true as const,
        serialUnitId: unit.id,
        prevStatus: 'ON_HOLD',
        nextStatus: restoreStatus,
        forced: !!forceStatus,
        inventoryEventId: ev.rows[0]?.id ?? null,
      };
    });

    if (!result.ok) return NextResponse.json(result, { status: result.status });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'release-hold failed';
    console.error('[POST /api/serial-units/[id]/release] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'sku_stock.adjust' });
