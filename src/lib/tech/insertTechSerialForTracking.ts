import type { Pool } from 'pg';
import { formatPSTTimestamp } from '@/utils/date';
import { TECH_EMPLOYEE_IDS } from '@/utils/staff';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishOrderTested, publishTechLogChanged } from '@/lib/realtime/publish';
import { createStationActivityLog } from '@/lib/station-activity';
import { mergeSerialsFromTsnRows } from '@/lib/tech/serialFields';
import { resolveTechSerialInsertContextFromSal } from '@/lib/tech/resolveTechSerialInsertContextFromSal';

export type TechSerialInsertDb = Pick<Pool, 'query'>;

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

  const insertResult = await db.query(
    `INSERT INTO tech_serial_numbers
       (shipment_id, orders_exception_id, scan_ref, serial_number, serial_type,
        tested_by, fnsku, fnsku_log_id, fba_shipment_id, fba_shipment_item_id,
        context_station_activity_log_id)
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
    [
      ctx.shipmentId ?? null,
      ctx.ordersExceptionId ?? null,
      upperSerial,
      serialType,
      staffId,
      ctx.normalizedFnsku,
      ctx.matchedFnskuLog?.id ?? null,
      ctx.matchedFnskuLog?.fba_shipment_id ?? null,
      ctx.matchedFnskuLog?.fba_shipment_item_id ?? null,
      ctxAnchor,
    ],
  );

  const targetTechSerialId: number | null = insertResult.rows[0]?.id
    ? Number(insertResult.rows[0].id)
    : null;

  const updatedSerialList = [...allExistingSerials, upperSerial];

  await createStationActivityLog(db, {
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
      techId: staffId,
      action: 'insert',
      source: 'tech.add-serial',
    });
    if (order?.id) {
      await publishOrderTested({
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
