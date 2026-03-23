import type { Pool } from 'pg';
import { formatPSTTimestamp } from '@/utils/date';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishOrderTested, publishTechLogChanged } from '@/lib/realtime/publish';
import { resolveShipmentId } from '@/lib/shipping/resolve';
import { createStationActivityLog } from '@/lib/station-activity';
import { mergeSerialsFromTsnRows } from '@/lib/tech/serialFields';

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
 * Single-serial insert for tech station: duplicate checks (CSV-aware), TSN row, SERIAL_ADDED SAL, order status_history.
 * Mirrors POST /api/tech/add-serial behavior.
 */
export async function insertTechSerialForTracking(
  db: TechSerialInsertDb,
  params: {
    tracking: string;
    serial: string;
    techId: string | number;
    allowFbaDuplicates?: boolean;
    /** When batching (e.g. SKU inject), reuse one resolveShipmentId result per tracking. */
    resolvedScan?: { shipmentId: number | null; scanRef: string | null };
  },
  options?: InsertTechSerialOptions,
): Promise<InsertTechSerialResult> {
  const { tracking, serial, techId, allowFbaDuplicates, resolvedScan: resolvedScanParam } = params;
  const scannedTracking = String(tracking || '').trim();
  const key18 = normalizeTrackingKey18(scannedTracking);
  if (!key18 || key18.length < 8) {
    return { ok: false, error: 'Invalid tracking number', status: 400 };
  }

  const resolvedScan = resolvedScanParam ?? (await resolveShipmentId(scannedTracking));
  const isFbaLikeTracking = /^(X0|B0|FBA)/i.test(scannedTracking);
  const normalizedFnsku = isFbaLikeTracking
    ? scannedTracking.toUpperCase().replace(/[^A-Z0-9]/g, '')
    : null;
  let fnskuCatalogExists = false;
  if (normalizedFnsku) {
    const fnskuLookup = await db.query(
      `SELECT 1
       FROM fba_fnskus
       WHERE fnsku = $1
       LIMIT 1`,
      [normalizedFnsku],
    );
    fnskuCatalogExists = fnskuLookup.rows.length > 0;
  }

  let orderResult = resolvedScan.shipmentId
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
        [resolvedScan.shipmentId],
      )
    : { rows: [] as any[] };

  if (orderResult.rows.length === 0) {
    orderResult = await db.query(
      `
                SELECT o.id, stn.tracking_number_raw AS shipping_tracking_number, o.account_source
                FROM orders o
                JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
                WHERE RIGHT(regexp_replace(UPPER(stn.tracking_number_normalized), '[^A-Z0-9]', '', 'g'), 18) = $1
                ORDER BY o.id DESC
                LIMIT 1
            `,
      [key18],
    );
  }
  const order = orderResult.rows[0] || null;
  let ordersExceptionId: number | null = null;

  if (!order && !fnskuCatalogExists) {
    const exceptionResult = await db.query(
      `SELECT id
                 FROM orders_exceptions
                 WHERE status = 'open'
                   AND RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
                 ORDER BY id DESC
                 LIMIT 1`,
      [key18],
    );
    if (exceptionResult.rows.length === 0) {
      return { ok: false, error: 'Tracking not found in orders or orders_exceptions', status: 404 };
    }
    ordersExceptionId = Number(exceptionResult.rows[0].id);
  }

  let serialType = 'SERIAL';
  if (/^X0|^B0/i.test(serial)) {
    serialType = 'FNSKU';
  } else if (order?.account_source === 'fba') {
    serialType = 'FNSKU';
  }

  const techIdNum = parseInt(String(techId), 10);
  let staffResult = { rows: [] as Array<{ id: number; name: string }> };
  if (!Number.isNaN(techIdNum) && techIdNum > 0) {
    const byId = await db.query('SELECT id, name FROM staff WHERE id = $1 LIMIT 1', [techIdNum]);
    if (byId.rows.length > 0) {
      staffResult = byId;
    }
  }

  if (staffResult.rows.length === 0) {
    const techEmployeeIds: { [key: string]: string } = {
      '1': 'TECH001',
      '2': 'TECH002',
      '3': 'TECH003',
      '4': 'TECH004',
    };
    const employeeId = techEmployeeIds[String(techId)] || String(techId);
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

  let unmatchedFnskuLog: null | {
    id: number;
    fba_shipment_id: number | null;
    fba_shipment_item_id: number | null;
  } = null;

  if (normalizedFnsku) {
    const unmatchedFnskuLogResult = await db.query(
      `SELECT l.id, l.fba_shipment_id, l.fba_shipment_item_id
                 FROM fba_fnsku_logs l
                 WHERE l.fnsku = $1
                   AND l.staff_id = $2
                   AND l.source_stage = 'TECH'
                   AND l.event_type = 'SCANNED'
                   AND NOT EXISTS (
                     SELECT 1
                     FROM tech_serial_numbers tsn
                     WHERE tsn.fnsku_log_id = l.id
                       AND tsn.serial_number IS NOT NULL
                       AND BTRIM(tsn.serial_number) <> ''
                   )
                 ORDER BY l.created_at ASC, l.id ASC
                 LIMIT 1`,
      [normalizedFnsku, staffId],
    );
    unmatchedFnskuLog = unmatchedFnskuLogResult.rows[0] ?? null;
  }

  const allTsnResult = await db.query(
    `SELECT serial_number
             FROM tech_serial_numbers
             WHERE ($1::bigint IS NOT NULL AND shipment_id = $1)
                OR ($2::int    IS NOT NULL AND shipment_id IS NULL AND orders_exception_id = $2)
                OR (
                    $1::bigint IS NULL AND $2::int IS NULL
                    AND scan_ref IS NOT NULL
                    AND RIGHT(regexp_replace(UPPER(scan_ref), '[^A-Z0-9]', '', 'g'), 18) = $3
                )
             ORDER BY id ASC`,
    [resolvedScan.shipmentId ?? null, ordersExceptionId, key18],
  );

  const allExistingSerials = mergeSerialsFromTsnRows(allTsnResult.rows);

  const shouldAllowDuplicateSerial =
    Boolean(allowFbaDuplicates) || isFbaLikeTracking || order?.account_source === 'fba';

  if (allExistingSerials.includes(upperSerial) && !shouldAllowDuplicateSerial) {
    return {
      ok: false,
      error: `Serial ${upperSerial} already scanned for this order`,
      status: 400,
    };
  }

  if (!resolvedScan.shipmentId && ordersExceptionId == null && !fnskuCatalogExists) {
    return {
      ok: false,
      error: 'Tracking did not resolve to a shipment or open exception',
      status: 400,
    };
  }

  const insertResult = await db.query(
    `INSERT INTO tech_serial_numbers
             (shipment_id, orders_exception_id, scan_ref, serial_number, serial_type,
              tested_by, fnsku, fnsku_log_id, fba_shipment_id, fba_shipment_item_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING id`,
    [
      resolvedScan.shipmentId ?? null,
      ordersExceptionId,
      resolvedScan.scanRef ?? (resolvedScan.shipmentId ? null : scannedTracking),
      upperSerial,
      serialType,
      staffId,
      normalizedFnsku,
      unmatchedFnskuLog?.id ?? null,
      unmatchedFnskuLog?.fba_shipment_id ?? null,
      unmatchedFnskuLog?.fba_shipment_item_id ?? null,
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
    shipmentId: resolvedScan.shipmentId ?? null,
    scanRef: resolvedScan.scanRef ?? scannedTracking,
    fnsku: normalizedFnsku,
    fbaShipmentId: unmatchedFnskuLog?.fba_shipment_id ?? null,
    fbaShipmentItemId: unmatchedFnskuLog?.fba_shipment_item_id ?? null,
    techSerialNumberId: targetTechSerialId,
    notes: `Serial added: ${upperSerial}`,
    metadata: {
      serial: upperSerial,
      serial_type: serialType,
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
      action: 'update',
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
