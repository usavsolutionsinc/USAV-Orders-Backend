import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { transition } from '@/lib/inventory/state-machine';
import { recordInventoryEvent } from '@/lib/inventory/events';

/**
 * POST /api/orders/[id]/release
 *
 * Close all open (non-RELEASED) allocations for an order, returning each
 * unit to STOCKED. Used when an order is cancelled before pick or when an
 * allocation needs to be unwound.
 *
 * Body:
 *   {
 *     reason?: string,            // free-form, stored on each released row
 *     client_event_id?: string    // UUID, idempotent retries (per-unit suffixed)
 *   }
 *
 * Per allocation:
 *   1. UPDATE order_unit_allocations SET state='RELEASED', released_at, released_reason.
 *   2. UPDATE serial_units SET current_status='STOCKED' (if unit was ALLOCATED).
 *   3. INSERT inventory_events RELEASED row.
 *
 * Idempotent: re-running after a successful release is a no-op (no open
 * allocations remaining).
 *
 * Permission: orders.view.
 */
export const POST = withAuth(async (request, ctx) => {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const idStr = segments[segments.length - 2];
  const orderId = Number(idStr);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid order id' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const reason = String(body?.reason || '').trim() || 'manual release';
  const clientEventId = String(body?.client_event_id || '').trim() || null;

  const actorStaffId: number | null =
    typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;

  try {
    // Run the whole release GUC-wrapped under the caller's org. order_unit_allocations
    // and serial_units are both tenant-owned, so every read/UPDATE/INSERT below
    // carries an explicit organization_id predicate (defence-in-depth alongside
    // the SET LOCAL app.current_org GUC). A cross-tenant order id reads back zero
    // open allocations → the idempotent no-op (same shape as a genuine re-run).
    const result = await withTenantTransaction(ctx.organizationId, async (client) => {
      // 1. Snapshot open allocations + their current units.
      //    su.id = a.serial_unit_id is an integer surrogate-PK join (safe bare);
      //    the org gate lives on the allocation row (a.organization_id).
      const openQ = await client.query<{ id: number; serial_unit_id: number; state: string; unit_status: string; sku: string | null }>(
        `SELECT a.id, a.serial_unit_id, a.state::text AS state,
                su.current_status::text AS unit_status, su.sku
           FROM order_unit_allocations a
           JOIN serial_units su ON su.id = a.serial_unit_id
          WHERE a.order_id = $1
            AND a.organization_id = $2
            AND a.state <> 'RELEASED'
          ORDER BY a.id ASC
          FOR UPDATE`,
        [orderId, ctx.organizationId],
      );
      if (openQ.rows.length === 0) {
        return { ok: true as const, orderId, released: 0, units: [] };
      }

      const released: Array<{ unitId: number; allocationId: number; prevAllocState: string; prevUnitStatus: string; eventId: number | null }> = [];

      for (let i = 0; i < openQ.rows.length; i++) {
        const row = openQ.rows[i];

        // Close the allocation.
        await client.query(
          `UPDATE order_unit_allocations
              SET state = 'RELEASED',
                  released_at = NOW(),
                  released_reason = $2
            WHERE id = $1
              AND organization_id = $3`,
          [row.id, reason, ctx.organizationId],
        );

        // Return the unit to STOCKED ONLY if it's still in an outbound
        // state (ALLOCATED/PICKED/PACKED/LABELED/STAGED). Don't touch
        // units already SHIPPED — those shouldn't have an open allocation,
        // but defending against the edge case here.
        const outboundStates = ['ALLOCATED', 'PICKED', 'PACKED', 'LABELED', 'STAGED'];
        const stockedReturn = outboundStates.includes(row.unit_status);
        const perUnitClientEventId = clientEventId ? `${clientEventId}:${row.serial_unit_id}` : null;
        const releasePayload = {
          source: 'orders.release',
          order_id: orderId,
          allocation_id: row.id,
          prev_alloc_state: row.state,
          ordinal: i + 1,
        };

        // The status return + RELEASED event go through the guarded chokepoint
        // (SoT rule: never hand-write current_status). The outbound→STOCKED
        // release-rewind edges are modeled, so the guard never rejects here.
        // The allocation close (above) and ledger stay outside transition. The
        // non-outbound defensive case has no status change → log the event only.
        let eventId: number | null;
        if (stockedReturn) {
          const moved = await transition(
            {
              unitId: row.serial_unit_id,
              to: 'STOCKED',
              eventType: 'RELEASED',
              actorStaffId,
              station: 'SYSTEM',
              clientEventId: perUnitClientEventId,
              notes: reason,
              payload: releasePayload,
            },
            client,
            ctx.organizationId,
          );
          if (!moved.ok) {
            // Unreachable in practice (every outbound state has a →STOCKED edge);
            // surface rather than silently force-write, rolling back the release.
            throw new Error(
              `release: cannot return unit ${row.serial_unit_id} (${row.unit_status}) to STOCKED: ${moved.error}`,
            );
          }
          eventId = moved.eventId;
        } else {
          const ev = await recordInventoryEvent(
            {
              event_type: 'RELEASED',
              actor_staff_id: actorStaffId,
              station: 'SYSTEM',
              serial_unit_id: row.serial_unit_id,
              sku: row.sku,
              prev_status: row.unit_status,
              next_status: row.unit_status,
              client_event_id: perUnitClientEventId,
              notes: reason,
              payload: releasePayload,
            },
            client,
            ctx.organizationId,
          );
          eventId = ev.id;
        }

        released.push({
          unitId: row.serial_unit_id,
          allocationId: row.id,
          prevAllocState: row.state,
          prevUnitStatus: row.unit_status,
          eventId,
        });
      }

      return { ok: true as const, orderId, released: released.length, units: released };
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'release failed';
    console.error('[POST /api/orders/[id]/release] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'orders.view' });
