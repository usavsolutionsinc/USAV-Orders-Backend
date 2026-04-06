import type { Pool } from 'pg';
import { normalizeTrackingKey18, normalizeTrackingCanonical } from '@/lib/tracking-format';

export type TechSerialInsertDb = Pick<Pool, 'query'>;

export type TechSerialSalInsertContext = {
  /** TRACKING_SCANNED / FNSKU_SCANNED row id; null when continuing a legacy SERIAL_ADDED chain without backfill. */
  anchorStationActivityLogId: number | null;
  shipmentId: number | null;
  ordersExceptionId: number | null;
  normalizedFnsku: string | null;
  matchedFnskuLog: {
    id: number;
    fba_shipment_id: number | null;
    fba_shipment_item_id: number | null;
  } | null;
  fnskuCatalogExists: boolean;
  /** Carrier raw or FNSKU — for key18 / messaging only; not used as TSN.scan_ref. */
  displayTracking: string;
};

type ResolveFailure = { ok: false; error: string; status: number };
type ResolveSuccess = { ok: true; ctx: TechSerialSalInsertContext };
export type ResolveTechSerialInsertContextResult = ResolveFailure | ResolveSuccess;

/**
 * Single source of truth for tech serial inserts: latest TECH station_activity_logs row
 * for this staff by `updated_at`, then shipment_id / orders_exception_id / fba_fnsku_logs
 * from that row (and joins). Does not use `tech_serial_numbers.scan_ref` or SAL.scan_ref for routing.
 */
export async function resolveTechSerialInsertContextFromSal(
  db: TechSerialInsertDb,
  staffId: number,
): Promise<ResolveTechSerialInsertContextResult> {
  const lastSalResult = await db.query(
    `SELECT sal.id,
            sal.activity_type,
            sal.shipment_id,
            sal.scan_ref,
            sal.fnsku,
            sal.orders_exception_id,
            sal.tech_serial_number_id,
            (NULLIF(TRIM(sal.metadata->>'fnsku_log_id'), ''))::bigint AS metadata_fnsku_log_id,
            stn.tracking_number_raw,
            stn.tracking_number_normalized
     FROM station_activity_logs sal
     LEFT JOIN shipping_tracking_numbers stn ON stn.id = sal.shipment_id
     WHERE sal.station = 'TECH'
       AND sal.staff_id = $1
       AND sal.activity_type IN ('TRACKING_SCANNED', 'FNSKU_SCANNED', 'SERIAL_ADDED')
     ORDER BY sal.updated_at DESC NULLS LAST, sal.created_at DESC, sal.id DESC
     LIMIT 1`,
    [staffId],
  );

  if (lastSalResult.rows.length === 0) {
    return {
      ok: false,
      error: 'No recent tech activity — scan a tracking number or FNSKU first.',
      status: 404,
    };
  }

  const row = lastSalResult.rows[0] as {
    id: number;
    activity_type: string;
    shipment_id: number | null;
    scan_ref: string | null;
    fnsku: string | null;
    orders_exception_id: number | null;
    tech_serial_number_id: number | null;
    metadata_fnsku_log_id: number | null;
    tracking_number_raw: string | null;
    tracking_number_normalized: string | null;
  };

  if (row.activity_type === 'SERIAL_ADDED') {
    const tsnId = Number(row.tech_serial_number_id);
    if (!Number.isFinite(tsnId) || tsnId <= 0) {
      return {
        ok: false,
        error: 'Last activity is incomplete — scan tracking or FNSKU again.',
        status: 400,
      };
    }

    const tsnRes = await db.query(
      `SELECT tsn.shipment_id,
              tsn.orders_exception_id,
              tsn.fnsku,
              tsn.fnsku_log_id,
              tsn.context_station_activity_log_id,
              stn.tracking_number_raw,
              stn.tracking_number_normalized
       FROM tech_serial_numbers tsn
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = tsn.shipment_id
       WHERE tsn.id = $1
       LIMIT 1`,
      [tsnId],
    );

    const tsn = tsnRes.rows[0] as
      | {
          shipment_id: number | null;
          orders_exception_id: number | null;
          fnsku: string | null;
          fnsku_log_id: number | null;
          context_station_activity_log_id: number | null;
          tracking_number_raw: string | null;
          tracking_number_normalized: string | null;
        }
      | undefined;

    if (!tsn) {
      return { ok: false, error: 'Could not resolve serial context — scan again.', status: 400 };
    }

    const anchorFromTsn = Number(tsn.context_station_activity_log_id);
    const anchorStationActivityLogId =
      Number.isFinite(anchorFromTsn) && anchorFromTsn > 0 ? anchorFromTsn : null;

    const shipmentId = tsn.shipment_id != null ? Number(tsn.shipment_id) : null;
    const ordersExceptionId =
      tsn.orders_exception_id != null ? Number(tsn.orders_exception_id) : null;
    const normalizedFnsku = tsn.fnsku
      ? normalizeTrackingCanonical(String(tsn.fnsku))
      : null;

    let matchedFnskuLog: TechSerialSalInsertContext['matchedFnskuLog'] = null;
    const flId = Number(tsn.fnsku_log_id);
    if (Number.isFinite(flId) && flId > 0) {
      const logRes = await db.query(
        `SELECT l.id, l.fba_shipment_id, l.fba_shipment_item_id
         FROM fba_fnsku_logs l
         WHERE l.id = $1 AND l.staff_id = $2
         LIMIT 1`,
        [flId, staffId],
      );
      matchedFnskuLog = logRes.rows[0] ?? null;
    }

    let fnskuCatalogExists = false;
    if (normalizedFnsku) {
      const fnskuLookup = await db.query(
        `SELECT 1 FROM fba_fnskus WHERE fnsku = $1 LIMIT 1`,
        [normalizedFnsku],
      );
      fnskuCatalogExists = fnskuLookup.rows.length > 0;
    }

    const displayTracking = String(
      tsn.tracking_number_raw || tsn.fnsku || '',
    ).trim();

    return {
      ok: true,
      ctx: {
        anchorStationActivityLogId,
        shipmentId: Number.isFinite(Number(shipmentId)) ? shipmentId : null,
        ordersExceptionId: Number.isFinite(Number(ordersExceptionId)) ? ordersExceptionId : null,
        normalizedFnsku,
        matchedFnskuLog,
        fnskuCatalogExists,
        displayTracking,
      },
    };
  }

  if (row.activity_type === 'FNSKU_SCANNED') {
    const normalizedFnsku = String(row.fnsku || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (!normalizedFnsku) {
      return { ok: false, error: 'Last FNSKU scan has no FNSKU value.', status: 400 };
    }

    const fnskuLookup = await db.query(
      `SELECT 1 FROM fba_fnskus WHERE fnsku = $1 LIMIT 1`,
      [normalizedFnsku],
    );
    const fnskuCatalogExists = fnskuLookup.rows.length > 0;

    const metaFl = Number(row.metadata_fnsku_log_id);
    let matchedFnskuLog: TechSerialSalInsertContext['matchedFnskuLog'] = null;
    if (Number.isFinite(metaFl) && metaFl > 0) {
      const pinned = await db.query(
        `SELECT l.id, l.fba_shipment_id, l.fba_shipment_item_id
         FROM fba_fnsku_logs l
         WHERE l.id = $1
           AND l.staff_id = $2
           AND l.fnsku = $3
           AND l.source_stage = 'TECH'
           AND l.event_type = 'SCANNED'
         LIMIT 1`,
        [metaFl, staffId, normalizedFnsku],
      );
      matchedFnskuLog = pinned.rows[0] ?? null;
    }
    if (!matchedFnskuLog) {
      const latest = await db.query(
        `SELECT l.id, l.fba_shipment_id, l.fba_shipment_item_id
         FROM fba_fnsku_logs l
         WHERE l.fnsku = $1
           AND l.staff_id = $2
           AND l.source_stage = 'TECH'
           AND l.event_type = 'SCANNED'
         ORDER BY l.created_at DESC, l.id DESC
         LIMIT 1`,
        [normalizedFnsku, staffId],
      );
      matchedFnskuLog = latest.rows[0] ?? null;
    }

    const shipmentId = row.shipment_id != null ? Number(row.shipment_id) : null;

    return {
      ok: true,
      ctx: {
        anchorStationActivityLogId: row.id,
        shipmentId: Number.isFinite(shipmentId) ? shipmentId : null,
        ordersExceptionId: null,
        normalizedFnsku,
        matchedFnskuLog,
        fnskuCatalogExists,
        displayTracking: normalizedFnsku,
      },
    };
  }

  // TRACKING_SCANNED
  const shipmentId = row.shipment_id != null ? Number(row.shipment_id) : null;
  let ordersExceptionId =
    row.orders_exception_id != null ? Number(row.orders_exception_id) : null;

  const carrierRaw = String(row.tracking_number_raw || '').trim();
  const key18 = normalizeTrackingKey18(
    carrierRaw || String(row.fnsku || '').trim(),
  );

  if (!ordersExceptionId && !shipmentId && key18.length >= 8) {
    const exceptionResult = await db.query(
      `SELECT id
       FROM orders_exceptions
       WHERE status = 'open'
         AND RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
       ORDER BY id DESC
       LIMIT 1`,
      [key18],
    );
    if (exceptionResult.rows[0]?.id != null) {
      ordersExceptionId = Number(exceptionResult.rows[0].id);
    }
  }

  let displayTracking = carrierRaw || String(row.fnsku || '').trim();
  if (!displayTracking && ordersExceptionId) {
    const ex = await db.query(
      `SELECT shipping_tracking_number FROM orders_exceptions WHERE id = $1 LIMIT 1`,
      [ordersExceptionId],
    );
    displayTracking = String(ex.rows[0]?.shipping_tracking_number || '').trim();
  }
  if (!displayTracking || normalizeTrackingKey18(displayTracking).length < 8) {
    return {
      ok: false,
      error: 'Last tracking scan has no resolvable carrier tracking on file.',
      status: 400,
    };
  }

  return {
    ok: true,
    ctx: {
      anchorStationActivityLogId: row.id,
      shipmentId: Number.isFinite(shipmentId) ? shipmentId : null,
      ordersExceptionId: Number.isFinite(ordersExceptionId) ? ordersExceptionId : null,
      normalizedFnsku: null,
      matchedFnskuLog: null,
      fnskuCatalogExists: false,
      displayTracking,
    },
  };
}
