import { NextResponse } from 'next/server';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';
import { parseScannedUrl } from '@/lib/scan-resolver';
import { transition } from '@/lib/inventory/state-machine';

/**
 * POST /api/pick/unscan — clean inverse of /api/pick/scan.
 *
 * Reverses ONE mis-picked unit: serial_units PICKED → ALLOCATED (via the
 * declared state-machine back-edge) and the order_unit_allocations row
 * PICKED → ALLOCATED — so the unit stays reserved to the same order, just
 * un-picked. No information is lost (the allocation row is state-flipped, not
 * released), unlike whole-order release which frees the unit to STOCKED.
 *
 * Body (one of): { scan } | { serial_unit_id }, optional { order_id, client_event_id }.
 * Guarded: the allocation must be in state PICKED (not PACKED/SHIPPED/RELEASED)
 * and the unit must currently be PICKED — else 409. Permission: orders.view.
 */
export const POST = withAuth(async (request, ctx) => {
  const body = await request.json().catch(() => ({}));
  const scan = String(body?.scan ?? '').trim();
  const serialUnitIdRaw = Number(body?.serial_unit_id);
  const serialUnitIdInput =
    Number.isFinite(serialUnitIdRaw) && serialUnitIdRaw > 0 ? Math.floor(serialUnitIdRaw) : null;
  const orderIdRaw = Number(body?.order_id);
  const orderIdInput = Number.isFinite(orderIdRaw) && orderIdRaw > 0 ? Math.floor(orderIdRaw) : null;
  const clientEventId = String(body?.client_event_id || '').trim() || null;

  if (!scan && !serialUnitIdInput) {
    return NextResponse.json({ ok: false, error: 'scan or serial_unit_id is required' }, { status: 400 });
  }

  let resolvedSerial: string | null = null;
  if (scan) {
    const url = parseScannedUrl(scan);
    resolvedSerial = url && url.type === 'unit' ? url.unitSerial.toUpperCase() : scan.toUpperCase();
  }
  const actorStaffId: number | null =
    typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;
  const orgId = ctx.organizationId;

  try {
    const result = await withTenantTransaction(orgId, async (client) => {
      // 1. Resolve + lock the unit. serial_units is tenant-owned — scope to
      //    this org so a cross-tenant id/serial reads as not-found (and the
      //    normalized_serial string key can't collide across tenants).
      const unitQ = serialUnitIdInput
        ? await client.query<{ id: number; current_status: string }>(
            `SELECT id, current_status::text AS current_status FROM serial_units WHERE id = $1 AND organization_id = $2 LIMIT 1 FOR UPDATE`,
            [serialUnitIdInput, orgId],
          )
        : await client.query<{ id: number; current_status: string }>(
            `SELECT id, current_status::text AS current_status FROM serial_units WHERE normalized_serial = $1 AND organization_id = $2 LIMIT 1 FOR UPDATE`,
            [resolvedSerial, orgId],
          );
      const unit = unitQ.rows[0];
      if (!unit) return { ok: false as const, status: 404, error: 'serial_units row not found' };

      // 2. Find the PICKED allocation for this unit (optionally scoped to order).
      //    order_unit_allocations is tenant-owned — scope to this org.
      const allocParams: Array<number | string> = [unit.id, orgId];
      if (orderIdInput) allocParams.push(orderIdInput);
      const allocQ = await client.query<{ id: number; order_id: number; state: string }>(
        `SELECT id, order_id, state::text AS state
           FROM order_unit_allocations
          WHERE serial_unit_id = $1 AND organization_id = $2 AND state <> 'RELEASED'
            ${orderIdInput ? 'AND order_id = $3' : ''}
          ORDER BY allocated_at DESC LIMIT 1 FOR UPDATE`,
        allocParams,
      );
      const allocation = allocQ.rows[0];
      if (!allocation) {
        return { ok: false as const, status: 409, error: 'no open allocation for this unit' };
      }
      if (allocation.state !== 'PICKED') {
        return {
          ok: false as const,
          status: 409,
          error: `allocation is ${allocation.state}, not PICKED — cannot un-pick`,
        };
      }

      // 3. serial_units PICKED → ALLOCATED via the state machine (shares this tx,
      //    guards + emits the inventory_event). A non-PICKED unit fails the guard.
      const t = await transition(
        {
          unitId: unit.id,
          to: 'ALLOCATED',
          eventType: 'ALLOCATED',
          actorStaffId,
          station: 'PACK',
          clientEventId: clientEventId ? `${clientEventId}:unpick` : null,
          payload: { source: 'pick.unscan', allocation_id: allocation.id, order_id: allocation.order_id },
        },
        client,
        orgId,
      );
      if (!t.ok) return { ok: false as const, status: t.status, error: t.error };

      // 4. Roll the allocation back PICKED → ALLOCATED (stays reserved, not released).
      await client.query(`UPDATE order_unit_allocations SET state = 'ALLOCATED' WHERE id = $1 AND organization_id = $2`, [allocation.id, orgId]);

      return {
        ok: true as const,
        unitId: unit.id,
        prevStatus: 'PICKED',
        nextStatus: 'ALLOCATED',
        allocationId: allocation.id,
        orderId: allocation.order_id,
        inventoryEventId: t.eventId,
      };
    });

    if (!result.ok) return NextResponse.json(result, { status: result.status });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'pick unscan failed';
    console.error('[POST /api/pick/unscan] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'orders.view' });
