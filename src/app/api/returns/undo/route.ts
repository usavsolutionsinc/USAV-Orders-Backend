import { NextResponse } from 'next/server';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';
import { parseScannedUrl } from '@/lib/scan-resolver';

/**
 * POST /api/returns/undo — reverse a returns-intake mistake.
 *
 * When a unit was scanned into returns by mistake (it's not a return after all),
 * this walks it back, undoing every effect of processReturnsIntake:
 *   - restores the EXACT pre-return status, read from the RETURNED
 *     inventory_event's prev_status (the intake records it there);
 *   - reopens the SHIPPED allocation the intake flipped to RETURNED (clears
 *     returned_at/returned_reason) — the row was state-flipped, not deleted, so
 *     the original shipped linkage is fully recoverable;
 *   - posts a compensating -1 sku_stock_ledger row so the +1 RETURN_CUSTOMER
 *     delta is reversed (the ledger trigger projects it back off sku_stock);
 *   - emits an ADJUSTED inventory_event documenting the undo.
 *
 * Guard: the unit must currently be RETURNED — a unit already dispositioned or
 * moved on cannot be undone here.
 * Permission: receiving.mark_received.
 *
 * Body (one of): { serial_unit_id } | { serial_number } | { scan };
 * optional { client_event_id, reason }.
 */
export const POST = withAuth(async (request, ctx) => {
  const body = await request.json().catch(() => ({}));
  const scan = String(body?.scan ?? '').trim();
  const serialUnitIdRaw = Number(body?.serial_unit_id);
  const serialUnitId = Number.isFinite(serialUnitIdRaw) && serialUnitIdRaw > 0 ? Math.floor(serialUnitIdRaw) : null;
  let resolvedSerial = String(body?.serial_number || '').trim() || null;
  if (scan && !resolvedSerial) {
    const url = parseScannedUrl(scan);
    resolvedSerial = url && url.type === 'unit' ? url.unitSerial.toUpperCase() : scan.toUpperCase();
  }
  const clientEventId = String(body?.client_event_id || '').trim() || null;
  const reason = String(body?.reason || '').trim() || 'returns intake undo (not a return)';
  const actorStaffId: number | null = typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;
  const orgId = ctx.organizationId;

  if (!serialUnitId && !resolvedSerial) {
    return NextResponse.json({ ok: false, error: 'serial_unit_id, serial_number, or scan is required' }, { status: 400 });
  }

  try {
    const result = await withTenantTransaction(orgId, async (client) => {
      const uq = serialUnitId
        ? await client.query<{ id: number; sku: string | null; current_status: string }>(
            `SELECT id, sku, current_status::text AS current_status FROM serial_units WHERE id = $1 AND organization_id = $2 LIMIT 1 FOR UPDATE`,
            [serialUnitId, orgId],
          )
        : await client.query<{ id: number; sku: string | null; current_status: string }>(
            `SELECT id, sku, current_status::text AS current_status FROM serial_units WHERE normalized_serial = UPPER(TRIM($1)) AND organization_id = $2 LIMIT 1 FOR UPDATE`,
            [resolvedSerial, orgId],
          );
      const unit = uq.rows[0];
      if (!unit) return { ok: false as const, status: 404, error: 'serial_units row not found' };
      if (unit.current_status !== 'RETURNED') {
        return { ok: false as const, status: 409, error: `unit is ${unit.current_status}, not RETURNED — nothing to undo` };
      }

      // Pre-return status is recorded on the most recent RETURNED event.
      const evQ = await client.query<{ prev_status: string | null }>(
        `SELECT prev_status::text AS prev_status FROM inventory_events
          WHERE serial_unit_id = $1 AND event_type = 'RETURNED' AND organization_id = $2
          ORDER BY occurred_at DESC, id DESC LIMIT 1`,
        [unit.id, orgId],
      );
      const priorStatus = evQ.rows[0]?.prev_status ?? 'SHIPPED';

      // Reopen the allocation the intake flipped to RETURNED.
      const reopen = await client.query(
        `UPDATE order_unit_allocations
            SET state = 'SHIPPED', returned_at = NULL, returned_reason = NULL
          WHERE serial_unit_id = $1 AND state = 'RETURNED' AND organization_id = $2`,
        [unit.id, orgId],
      );
      const allocationReopened = (reopen.rowCount ?? 0) > 0;

      // Compensating -1 ledger to undo the +1 RETURN_CUSTOMER (trigger reprojects).
      let ledgerId: number | null = null;
      if (unit.sku) {
        const lq = await client.query<{ id: number }>(
          `INSERT INTO sku_stock_ledger (sku, delta, reason, dimension, staff_id, ref_serial_unit_id, notes, organization_id)
           VALUES ($1, -1, 'ADJUSTMENT', 'WAREHOUSE', $2, $3, $4, $5) RETURNING id`,
          [unit.sku, actorStaffId, unit.id, reason, orgId],
        );
        ledgerId = lq.rows[0]?.id ?? null;
      }

      // Restore the unit's pre-return status (raw — returns.ts also raw-UPDATEs;
      // the target is dynamic, recovered from the event).
      await client.query(
        `UPDATE serial_units SET current_status = $2::serial_status_enum, updated_at = NOW() WHERE id = $1 AND organization_id = $3`,
        [unit.id, priorStatus, orgId],
      );

      const ev = await client.query<{ id: number }>(
        `INSERT INTO inventory_events (
           event_type, actor_staff_id, station, serial_unit_id, sku,
           prev_status, next_status, stock_ledger_id, client_event_id, notes, payload,
           organization_id
         )
         VALUES ('ADJUSTED', $1, 'RECEIVING', $2, $3, 'RETURNED', $4, $5, $6, $7, $8::jsonb, $9)
         ON CONFLICT (client_event_id) DO NOTHING RETURNING id`,
        [
          actorStaffId, unit.id, unit.sku, priorStatus, ledgerId,
          clientEventId ? `${clientEventId}:return-undo` : null, reason,
          JSON.stringify({ source: 'returns.undo', restored_to: priorStatus, allocation_reopened: allocationReopened }),
          orgId,
        ],
      );

      return {
        ok: true as const,
        unitId: unit.id,
        restoredTo: priorStatus,
        allocationReopened,
        ledgerId,
        inventoryEventId: ev.rows[0]?.id ?? null,
      };
    });

    if (!result.ok) return NextResponse.json(result, { status: result.status });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'returns undo failed';
    console.error('[POST /api/returns/undo] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'receiving.mark_received' });
