import type { Pool } from 'pg';
import { formatPSTTimestamp } from '@/utils/date';
import { TECH_EMPLOYEE_IDS } from '@/utils/staff';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishOrderTested, publishTechLogChanged } from '@/lib/realtime/publish';
import { createStationActivityLog } from '@/lib/station-activity';
import { mergeSerialsFromTsnRows } from '@/lib/tech/serialFields';
import { resolveTechSerialInsertContextFromSal } from '@/lib/tech/resolveTechSerialInsertContextFromSal';
import { isInventoryV2TechLifecycle } from '@/lib/feature-flags';
import { attachTechSerial } from '@/lib/inventory/tech-serial';

export type TechSerialInsertDb = Pick<Pool, 'query'>;

/**
 * Phase 3 helper: tie the just-inserted tech_serial_numbers row to a
 * serial_units master record and emit an inventory_events row so the
 * unit's lifecycle timeline reflects the tech scan.
 *
 * Reuses the same `db` connection passed to insertTechSerialForTracking
 * (which may be a Pool or a PoolClient mid-transaction). Best-effort —
 * any failure is logged and swallowed so the legacy write path remains
 * authoritative for production behavior until the flag flips on.
 */
async function linkTechSerialToInventoryV2(
  db: TechSerialInsertDb,
  args: {
    techSerialNumberId: number | null;
    upperSerial: string;
    sku: string | null;
    staffId: number;
    shipmentId: number | null;
    ordersExceptionId: number | null;
    fbaShipmentId: number | null;
    fbaShipmentItemId: number | null;
    serialType: string;
  },
): Promise<{ serialUnitId: number | null; inventoryEventId: number | null } | null> {
  try {
    // 1. Upsert serial_units by normalized_serial. Fill-in only: never
    //    downgrade an existing unit's lifecycle state (a unit STOCKED
    //    from receiving stays STOCKED when tech scans it; the dedicated
    //    /api/tech/test-result endpoint is what moves IN_TEST/GRADED).
    const upsert = await db.query(
      `INSERT INTO serial_units (
        serial_number, normalized_serial, sku,
        current_status, origin_source, origin_tsn_id
      )
      VALUES ($1, UPPER(TRIM($1)), $2,
              'UNKNOWN'::serial_status_enum, 'tech.add-serial', $3)
      ON CONFLICT (normalized_serial) DO UPDATE SET
        sku = COALESCE(serial_units.sku, EXCLUDED.sku),
        origin_tsn_id = COALESCE(serial_units.origin_tsn_id, EXCLUDED.origin_tsn_id),
        updated_at = NOW()
      RETURNING id`,
      [args.upperSerial, args.sku, args.techSerialNumberId],
    );
    const serialUnitId: number | null = upsert.rows[0]?.id
      ? Number(upsert.rows[0].id)
      : null;

    // 2. Stamp the new FK on tech_serial_numbers so historical joins work.
    if (serialUnitId != null && args.techSerialNumberId != null) {
      await db.query(
        `UPDATE tech_serial_numbers
           SET serial_unit_id = $1
         WHERE id = $2 AND serial_unit_id IS NULL`,
        [serialUnitId, args.techSerialNumberId],
      );
    }

    // 3. Emit an inventory_events row. 'NOTE' rather than TEST_START so
    //    we don't imply a state change here — a tech-station add-serial
    //    can happen for outbound order association without any testing
    //    intent. Explicit test results go through /api/tech/test-result.
    const eventInsert = await db.query(
      `INSERT INTO inventory_events (
        event_type, actor_staff_id, station,
        serial_unit_id, sku, scan_token, notes, payload
      )
      VALUES ('NOTE', $1, 'TECH', $2, $3, $4, $5, $6::jsonb)
      RETURNING id`,
      [
        args.staffId > 0 ? args.staffId : null,
        serialUnitId,
        args.sku,
        args.upperSerial,
        `tech.add-serial`,
        JSON.stringify({
          source: 'tech.add-serial',
          serial_type: args.serialType,
          tech_serial_number_id: args.techSerialNumberId,
          shipment_id: args.shipmentId,
          orders_exception_id: args.ordersExceptionId,
          fba_shipment_id: args.fbaShipmentId,
          fba_shipment_item_id: args.fbaShipmentItemId,
        }),
      ],
    );
    const inventoryEventId: number | null = eventInsert.rows[0]?.id
      ? Number(eventInsert.rows[0].id)
      : null;

    return { serialUnitId, inventoryEventId };
  } catch (err) {
    console.warn('linkTechSerialToInventoryV2 failed (legacy path unaffected):', err);
    return null;
  }
}

export type InsertTechSerialOptions = {
  /** When true, skip invalidate + realtime (caller batches one flush after a transaction). */
  skipInvalidateAndPublish?: boolean;
};

export type InsertTechSerialSuccess = {
  ok: true;
  serialNumbers: string[];
  serialType: string;
  techSerialId: number | null;
  staffId: number;
};

export type InsertTechSerialFailure = {
  ok: false;
  error: string;
  status: number;
};

export type InsertTechSerialResult = InsertTechSerialSuccess | InsertTechSerialFailure;

/**
 * Inserts one tech_serial_numbers row + SERIAL_ADDED SAL. Context comes only from the latest
 * TECH `station_activity_logs` row for this staff (`updated_at`), not from client tracking
 * or `scan_ref` matching. Sets `context_station_activity_log_id` when the anchor SAL is known.
 */
export async function insertTechSerialForTracking(
  db: TechSerialInsertDb,
  params: {
    /** Phase 3a: tenant scope, required for both INSERTs in this function. */
    organizationId: string;
    serial: string;
    techId: string | number;
    allowFbaDuplicates?: boolean;
  },
  options?: InsertTechSerialOptions,
): Promise<InsertTechSerialResult> {
  const { serial, techId, allowFbaDuplicates } = params;

  const techIdNum = parseInt(String(techId), 10);
  let staffResult = { rows: [] as Array<{ id: number; name: string }> };
  if (!Number.isNaN(techIdNum) && techIdNum > 0) {
    const byId = await db.query('SELECT id, name FROM staff WHERE id = $1 LIMIT 1', [techIdNum]);
    if (byId.rows.length > 0) {
      staffResult = byId;
    }
  }

  if (staffResult.rows.length === 0) {
    const employeeId = TECH_EMPLOYEE_IDS[String(techId)] || String(techId);
    const byEmployeeId = await db.query('SELECT id, name FROM staff WHERE employee_id = $1 LIMIT 1', [employeeId]);
    staffResult = byEmployeeId;
  }

  if (staffResult.rows.length === 0) {
    return { ok: false, error: 'Staff not found', status: 404 };
  }

  const staffId = staffResult.rows[0].id;
  const staffName = staffResult.rows[0].name;
  const upperSerial = String(serial).trim().toUpperCase();
  if (!upperSerial) {
    return { ok: false, error: 'Serial is required', status: 400 };
  }

  const salCtx = await resolveTechSerialInsertContextFromSal(db, staffId);
  if (!salCtx.ok) {
    return { ok: false, error: salCtx.error, status: salCtx.status };
  }

  const ctx = salCtx.ctx;
  const isFbaLikeContext =
    Boolean(ctx.normalizedFnsku && /^(X0|B0|FBA)/i.test(ctx.normalizedFnsku))
    || Boolean(ctx.displayTracking && /^(X0|B0|FBA)/i.test(ctx.displayTracking));

  let orderResult =
    ctx.shipmentId != null
      ? await db.query(
          `
                SELECT o.id, o.account_source,
                       stn.tracking_number_raw AS shipping_tracking_number
                FROM orders o
                LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
                WHERE o.shipment_id = $1
                ORDER BY o.id DESC
                LIMIT 1
            `,
          [ctx.shipmentId],
        )
      : { rows: [] as any[] };

  const order = orderResult.rows[0] || null;

  let serialType = 'SERIAL';
  if (/^X0|^B0/i.test(upperSerial)) {
    serialType = 'FNSKU';
  } else if (order?.account_source === 'fba') {
    serialType = 'FNSKU';
  }

  const fnskuLogIdForAgg =
    ctx.matchedFnskuLog?.id != null &&
    Number.isFinite(Number(ctx.matchedFnskuLog.id)) &&
    Number(ctx.matchedFnskuLog.id) > 0
      ? Number(ctx.matchedFnskuLog.id)
      : null;

  const ctxAnchor = ctx.anchorStationActivityLogId;

  const allTsnResult = await db.query(
    `SELECT serial_number
       FROM tech_serial_numbers
       WHERE ($4::int IS NOT NULL AND context_station_activity_log_id = $4)
          OR (
            $4::int IS NULL
            AND (
              ($1::bigint IS NOT NULL AND shipment_id = $1)
              OR ($2::int IS NOT NULL AND shipment_id IS NULL AND orders_exception_id = $2)
              OR ($3::bigint IS NOT NULL AND fnsku_log_id = $3)
            )
          )
       ORDER BY id ASC`,
    [ctx.shipmentId ?? null, ctx.ordersExceptionId ?? null, fnskuLogIdForAgg, ctxAnchor],
  );

  const allExistingSerials = mergeSerialsFromTsnRows(allTsnResult.rows);

  const shouldAllowDuplicateSerial =
    Boolean(allowFbaDuplicates) || isFbaLikeContext || order?.account_source === 'fba';

  if (allExistingSerials.includes(upperSerial) && !shouldAllowDuplicateSerial) {
    return {
      ok: false,
      error: `Serial ${upperSerial} already scanned for this order`,
      status: 400,
    };
  }

  if (!ctx.shipmentId && ctx.ordersExceptionId == null && !ctx.fnskuCatalogExists) {
    return {
      ok: false,
      error: 'Scan context did not resolve to a shipment, open exception, or catalog FNSKU',
      status: 400,
    };
  }

  // Canonical TSN writer (relational-reuse plan, Phase 2). receiving_line_id is
  // unset here, so the partial unique index doesn't apply and ON CONFLICT DO
  // NOTHING behaves like the prior plain INSERT (duplicates are pre-checked
  // above via allExistingSerials). serial_unit_id is stamped later by
  // linkTechSerialToInventoryV2.
  const insertResult = await attachTechSerial(
    {
      serialNumber: upperSerial,
      organizationId: params.organizationId,
      shipmentId: ctx.shipmentId ?? null,
      ordersExceptionId: ctx.ordersExceptionId ?? null,
      serialType,
      testedBy: staffId,
      fnsku: ctx.normalizedFnsku,
      fnskuLogId: ctx.matchedFnskuLog?.id ?? null,
      fbaShipmentId: ctx.matchedFnskuLog?.fba_shipment_id ?? null,
      fbaShipmentItemId: ctx.matchedFnskuLog?.fba_shipment_item_id ?? null,
      contextStationActivityLogId: ctxAnchor,
    },
    db,
  );

  const targetTechSerialId: number | null = insertResult.id;

  // Phase 3 (INVENTORY_V2_TECH_LIFECYCLE): link the just-inserted TSN row
  // to its serial_units master and emit an inventory_events NOTE so the
  // unit timeline reflects the tech scan. Best-effort — failures don't
  // affect the legacy write path. Off-flag is a no-op.
  if (isInventoryV2TechLifecycle()) {
    // Note: orderResult doesn't select orders.sku to keep the legacy
    // shape unchanged. The serial_units upsert COALESCEs sku so an
    // already-known SKU on the master row is preserved.
    await linkTechSerialToInventoryV2(db, {
      techSerialNumberId: targetTechSerialId,
      upperSerial,
      sku: null,
      staffId,
      shipmentId: ctx.shipmentId ?? null,
      ordersExceptionId: ctx.ordersExceptionId ?? null,
      fbaShipmentId: ctx.matchedFnskuLog?.fba_shipment_id ?? null,
      fbaShipmentItemId: ctx.matchedFnskuLog?.fba_shipment_item_id ?? null,
      serialType,
    });
  }

  const updatedSerialList = [...allExistingSerials, upperSerial];

  await createStationActivityLog(db, {
    organizationId: params.organizationId,
    station: 'TECH',
    activityType: 'SERIAL_ADDED',
    staffId,
    shipmentId: ctx.shipmentId ?? null,
    scanRef: null,
    fnsku: ctx.normalizedFnsku,
    ordersExceptionId: ctx.ordersExceptionId ?? null,
    fbaShipmentId: ctx.matchedFnskuLog?.fba_shipment_id ?? null,
    fbaShipmentItemId: ctx.matchedFnskuLog?.fba_shipment_item_id ?? null,
    techSerialNumberId: targetTechSerialId,
    notes: `Serial added: ${upperSerial}`,
    metadata: {
      source: 'tech.add-serial',
      serial: upperSerial,
      serial_type: serialType,
      context_station_activity_log_id: ctxAnchor,
    },
    createdAt: formatPSTTimestamp(),
  });

  if (order?.id) {
    try {
      const isoTimestamp = formatPSTTimestamp();
      await db.query(
        `
                    UPDATE orders
                    SET status_history = COALESCE(status_history, '[]'::jsonb) || 
                        jsonb_build_object(
                            'status', 'serial_added',
                            'timestamp', $1,
                            'user', $2,
                            'serial', $3,
                            'serial_type', $4,
                            'previous_status', (
                                SELECT COALESCE(
                                    (status_history->-1->>'status')::text,
                                    null
                                )
                                FROM orders 
                                WHERE id = $5
                            )
                        )::jsonb
                    WHERE id = $5
                `,
        [isoTimestamp, staffName, upperSerial, serialType, order.id],
      );
    } catch (statusError) {
      console.warn('Status history update failed (serial was still saved):', statusError);
    }
  }

  if (!options?.skipInvalidateAndPublish) {
    await invalidateCacheTags(['tech-logs', 'orders-next']);
    await publishTechLogChanged({
      organizationId: params.organizationId,
      techId: staffId,
      action: 'insert',
      source: 'tech.add-serial',
    });
    if (order?.id) {
      await publishOrderTested({
        organizationId: params.organizationId,
        orderId: Number(order.id),
        testedBy: staffId,
        source: 'tech.add-serial',
      });
    }
  }

  return {
    ok: true,
    serialNumbers: updatedSerialList,
    serialType,
    techSerialId: targetTechSerialId,
    staffId,
  };
}
