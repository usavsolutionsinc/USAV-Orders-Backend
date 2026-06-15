import { NextResponse } from 'next/server';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';
import { parseScannedUrl } from '@/lib/scan-resolver';
import { transition } from '@/lib/inventory/state-machine';

/**
 * POST /api/pick/scan
 *
 * Phase 4. Validates a scanned serial against an open ALLOCATED row and
 * advances it to PICKED. Used by the mobile pick app.
 *
 * Body shape (one of):
 *   { scan: "ABC1234..."                   }  // raw serial text
 *   { scan: "https://.../01/{gtin}/21/..." }  // GS1 Digital Link
 *   { serial_unit_id: 42                   }  // explicit id
 *
 * Optional:
 *   { order_id?: number,                // bind to this order; required when
 *                                       // the same SKU has multiple open
 *                                       // allocations across orders
 *     bin_id?:   number,                // destination tote / pick cart bin
 *     client_event_id?: string,
 *     override_mismatch?: boolean }     // record manual_override on mismatch
 *
 * Transitions:
 *   allocation.state ALLOCATED → PICKED
 *   serial_units.current_status ALLOCATED → PICKED
 *   inventory_events PICKED row (payload.allocation_id, payload.order_id,
 *                                payload.mismatch=true if override path)
 *
 * Permission: orders.view (pick action belongs to the order lifecycle).
 */
export const POST = withAuth(async (request, ctx) => {
  const body = await request.json().catch(() => ({}));
  const scan = String(body?.scan ?? '').trim();
  const serialUnitIdRaw = Number(body?.serial_unit_id);
  const serialUnitIdInput =
    Number.isFinite(serialUnitIdRaw) && serialUnitIdRaw > 0 ? Math.floor(serialUnitIdRaw) : null;
  const orderIdRaw = Number(body?.order_id);
  const orderIdInput =
    Number.isFinite(orderIdRaw) && orderIdRaw > 0 ? Math.floor(orderIdRaw) : null;
  const binIdRaw = Number(body?.bin_id);
  const binIdInput = Number.isFinite(binIdRaw) && binIdRaw > 0 ? Math.floor(binIdRaw) : null;
  const clientEventId = String(body?.client_event_id || '').trim() || null;
  const overrideMismatch = body?.override_mismatch === true;

  if (!scan && !serialUnitIdInput) {
    return NextResponse.json(
      { ok: false, error: 'scan or serial_unit_id is required' },
      { status: 400 },
    );
  }

  // Resolve the scan input → normalized serial. Accepts GS1 Digital Link
  // URLs via the Phase 1 parser.
  let resolvedSerial: string | null = null;
  if (scan) {
    const url = parseScannedUrl(scan);
    if (url && url.type === 'unit') {
      resolvedSerial = url.unitSerial.toUpperCase();
    } else {
      resolvedSerial = scan.toUpperCase();
    }
  }

  const actorStaffId: number | null =
    typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;
  const orgId = ctx.organizationId;

  try {
    const result = await withTenantTransaction(orgId, async (client) => {
      // 1. Resolve the unit by id or normalized serial. serial_units is
      //    tenant-owned — scope to this org so a cross-tenant id/serial reads
      //    as not-found (and the normalized_serial string key can't collide
      //    across tenants).
      const unitQ = serialUnitIdInput
        ? await client.query<{ id: number; sku: string | null; current_status: string }>(
            `SELECT id, sku, current_status::text AS current_status
              FROM serial_units WHERE id = $1 AND organization_id = $2 LIMIT 1
              FOR UPDATE`,
            [serialUnitIdInput, orgId],
          )
        : await client.query<{ id: number; sku: string | null; current_status: string }>(
            `SELECT id, sku, current_status::text AS current_status
              FROM serial_units WHERE normalized_serial = $1 AND organization_id = $2 LIMIT 1
              FOR UPDATE`,
            [resolvedSerial, orgId],
          );
      const unit = unitQ.rows[0];
      if (!unit) {
        return { ok: false as const, status: 404, error: 'serial_units row not found' };
      }

      // 2. Find an open ALLOCATED row for this unit. If order_id specified,
      //    require the allocation to belong to that order.
      //    order_unit_allocations is tenant-owned — scope to this org.
      const allocationParams: Array<number | string> = [unit.id, orgId];
      if (orderIdInput) allocationParams.push(orderIdInput);
      const allocationQ = await client.query<{ id: number; order_id: number; state: string }>(
        `SELECT id, order_id, state::text AS state
           FROM order_unit_allocations
          WHERE serial_unit_id = $1
            AND organization_id = $2
            AND state <> 'RELEASED'
            ${orderIdInput ? 'AND order_id = $3' : ''}
          ORDER BY allocated_at DESC
          LIMIT 1
          FOR UPDATE`,
        allocationParams,
      );
      const allocation = allocationQ.rows[0];

      let mismatch = false;
      if (!allocation) {
        if (!overrideMismatch) {
          return {
            ok: false as const,
            status: 409,
            error: 'no open ALLOCATED row for this unit',
            mismatch: true,
            unitId: unit.id,
            unitStatus: unit.current_status,
          };
        }
        mismatch = true;
      } else if (allocation.state !== 'ALLOCATED') {
        if (!overrideMismatch) {
          return {
            ok: false as const,
            status: 409,
            error: `allocation already advanced to ${allocation.state}`,
            mismatch: true,
            allocationId: allocation.id,
            currentState: allocation.state,
          };
        }
        mismatch = true;
      }

      // 3. Advance the UNIT first (guarded), THEN the allocation. Ordering
      //    matters: transaction() commits on a normal return, so a guard
      //    rejection must happen BEFORE the allocation is advanced, or we'd
      //    commit a half-advanced allocation against an unchanged unit.
      let prevStatus = unit.current_status;
      let eventId: number | null = null;
      if (!mismatch) {
        // Normal pick: a matched open ALLOCATED row exists → guarded
        // ALLOCATED→PICKED. transition() writes status + emits the PICKED event
        // atomically; it writes status only, so current_location is applied
        // separately below. binId is always passed (null when unscanned) so the
        // event's bin_id matches the old behavior instead of falling back to
        // the unit's current_location.
        const tr = await transition({
          unitId: unit.id,
          to: 'PICKED',
          eventType: 'PICKED',
          actorStaffId,
          station: 'PACK',
          clientEventId,
          expectedFrom: 'ALLOCATED',
          scanToken: resolvedSerial,
          binId: binIdInput,
          payload: {
            source: 'pick.scan',
            order_id: allocation?.order_id ?? orderIdInput ?? null,
            allocation_id: allocation?.id ?? null,
            mismatch: false,
            override: false,
          },
        }, client, orgId);
        if (!tr.ok) {
          return { ok: false as const, status: tr.status, error: tr.error };
        }
        prevStatus = tr.from;
        eventId = tr.eventId;
        if (binIdInput != null) {
          await client.query(
            `UPDATE serial_units SET current_location = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3`,
            [String(binIdInput), unit.id, orgId],
          );
        }
      } else {
        // Override force-pick: the unit may be in any state (mismatch), so
        // bypass the guard with a raw status write + raw event, as before.
        await client.query(
          `UPDATE serial_units
              SET current_status = 'PICKED'::serial_status_enum,
                  current_location = COALESCE($2::text, current_location),
                  updated_at = NOW()
            WHERE id = $1
              AND organization_id = $3`,
          [unit.id, binIdInput != null ? String(binIdInput) : null, orgId],
        );
        const ev = await client.query<{ id: number }>(
          `INSERT INTO inventory_events (
            organization_id,
            event_type, actor_staff_id, station,
            serial_unit_id, sku,
            bin_id, prev_status, next_status,
            scan_token, client_event_id, payload
          )
          VALUES ($9, 'PICKED', $1, 'PACK',
                  $2, $3,
                  $4, $5, 'PICKED',
                  $6, $7, $8::jsonb)
          ON CONFLICT (client_event_id) DO NOTHING
          RETURNING id`,
          [
            actorStaffId,
            unit.id,
            unit.sku,
            binIdInput,
            unit.current_status,
            resolvedSerial,
            clientEventId,
            JSON.stringify({
              source: 'pick.scan',
              order_id: allocation?.order_id ?? orderIdInput ?? null,
              allocation_id: allocation?.id ?? null,
              mismatch,
              override: overrideMismatch && mismatch,
            }),
            orgId,
          ],
        );
        eventId = ev.rows[0]?.id ?? null;
      }

      // 4. Advance the allocation only AFTER the unit pick succeeded.
      if (allocation) {
        await client.query(
          `UPDATE order_unit_allocations
              SET state = 'PICKED'
            WHERE id = $1
              AND organization_id = $2`,
          [allocation.id, orgId],
        );
      }

      return {
        ok: true as const,
        unitId: unit.id,
        prevStatus,
        nextStatus: 'PICKED',
        allocationId: allocation?.id ?? null,
        orderId: allocation?.order_id ?? orderIdInput ?? null,
        mismatch,
        inventoryEventId: eventId,
      };
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'pick scan failed';
    console.error('[POST /api/pick/scan] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'orders.view' });
