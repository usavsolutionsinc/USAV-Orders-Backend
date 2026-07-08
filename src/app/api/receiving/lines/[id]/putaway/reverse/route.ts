import { NextRequest, NextResponse, after } from 'next/server';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { transition, type SerialState } from '@/lib/inventory/state-machine';
import { withTenantTransaction } from '@/lib/tenancy/db';

/** States a unit can be STOCKED from — un-putaway restores it to whichever it came from. */
const PRE_STOCK_STATES = new Set<SerialState>(['RECEIVED', 'TESTED', 'GRADED']);

/**
 * POST /api/receiving/lines/[id]/putaway/reverse — undo a putaway.
 *
 * Reverse of the putaway: walks a wrongly-stocked serial unit STOCKED → TESTED
 * (the pre-stock state) via the state machine and clears its bin location, so
 * an operator who binned the wrong unit / wrong bin can pull it back out. Goes
 * through `transition()` (the STOCKED→TESTED back-edge), which guards the move
 * and emits an inventory_event — so a unit that has since been ALLOCATED/PICKED
 * (no longer STOCKED) is refused with 409 rather than yanked from an order.
 *
 *   POST { serial_unit_id, staff_id?, client_event_id?, notes? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(request, 'receiving.bin_assign');
    if (gate.denied) return gate.denied;
    const orgId = gate.ctx.organizationId;
    const { id: idRaw } = await params;
    const lineId = Number(idRaw);
    if (!Number.isFinite(lineId) || lineId <= 0) {
      return NextResponse.json({ success: false, error: 'Valid line id is required' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const serialUnitIdRaw = Number(body?.serial_unit_id);
    const serialUnitId =
      Number.isFinite(serialUnitIdRaw) && serialUnitIdRaw > 0 ? Math.floor(serialUnitIdRaw) : null;
    if (serialUnitId == null) {
      return NextResponse.json({ success: false, error: 'serial_unit_id is required' }, { status: 400 });
    }
    const staffId =
      gate.ctx.staffId != null && Number.isFinite(gate.ctx.staffId) && gate.ctx.staffId > 0
        ? Math.floor(gate.ctx.staffId)
        : null;
    const clientEventId = String(body?.client_event_id || '').trim() || null;
    const notes = String(body?.notes || '').trim() || null;

    // Run the whole reverse inside one tenant transaction so the org GUC is set
    // (RLS backstop) and every statement is org-scoped. The transition() guard
    // failure is returned as a tagged value and mapped to its original status
    // below — withTenantTransaction owns COMMIT/ROLLBACK, so we don't ROLLBACK
    // here; returning normally COMMITs (the guard failure made no writes).
    type TransitionFail = { ok: false; status: number; error: string; from?: SerialState };
    const isFail = (v: unknown): v is TransitionFail =>
      typeof v === 'object' && v != null && (v as { ok?: boolean }).ok === false;

    const txResult = await withTenantTransaction(orgId, async (client) => {
      // Restore to whichever pre-stock state the unit ACTUALLY came from — a unit
      // can reach STOCKED straight from RECEIVED (mark-received auto-putaway) or
      // via TESTED/GRADED (testing). Read the last non-STOCKED state from history
      // so we never fabricate a TESTED/QC-passed state a never-tested unit didn't
      // earn. Default to RECEIVED (the most conservative pre-stock state).
      const priorRes = await client.query<{ next_status: string | null }>(
        `SELECT next_status FROM inventory_events
          WHERE serial_unit_id = $1 AND organization_id = $2 AND next_status IS NOT NULL AND next_status <> 'STOCKED'
          ORDER BY occurred_at DESC, id DESC
          LIMIT 1`,
        [serialUnitId, orgId],
      );
      const priorStatus = priorRes.rows[0]?.next_status as SerialState | undefined;
      const target: SerialState = priorStatus && PRE_STOCK_STATES.has(priorStatus) ? priorStatus : 'RECEIVED';

      // STOCKED → <pre-stock>, guarded + audited by the state machine (shares this
      // tx + org scope). A non-STOCKED unit (already allocated/picked/shipped)
      // fails the guard; a cross-tenant unit id reads as 404.
      const result = await transition(
        {
          unitId: serialUnitId,
          to: target,
          eventType: 'ADJUSTED',
          actorStaffId: staffId,
          station: 'RECEIVING',
          clientEventId: clientEventId ? `${clientEventId}:unput` : null,
          notes,
          payload: { source: 'putaway.reverse', reverse_of: 'PUTAWAY', receiving_line_id: lineId },
        },
        client,
        orgId,
      );
      if (!result.ok) {
        return { ok: false as const, status: result.status, error: result.error, from: result.from };
      }

      // Clear the bin location in the same transaction (transition only moves status).
      await client.query(
        `UPDATE serial_units SET current_location = NULL, updated_at = NOW() WHERE id = $1 AND organization_id = $2`,
        [serialUnitId, orgId],
      );

      return result;
    });

    if (isFail(txResult)) {
      const detail = txResult.from ? ` (unit is ${txResult.from})` : '';
      return NextResponse.json(
        { success: false, error: `Cannot un-putaway${detail}: ${txResult.error}` },
        { status: txResult.status },
      );
    }

    after(async () => {
      try {
        await invalidateCacheTags(['receiving-lines', 'sku-stock', 'serial-units']);
      } catch (err) {
        console.warn('receiving/lines/putaway/reverse: cache invalidate failed', err);
      }
    });

    return NextResponse.json({
      success: true,
      line_id: lineId,
      serial_unit_id: serialUnitId,
      from: txResult.from,
      to: txResult.to,
      event_id: txResult.eventId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to un-putaway';
    console.error('receiving/lines/putaway/reverse POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
