import type { Pool } from 'pg';
import { formatPSTTimestamp } from '@/utils/date';
import { createStationActivityLog } from '@/lib/station-activity';
import { mergeSerialsFromTsnRows } from '@/lib/tech/serialFields';

type Queryable = Pick<Pool, 'query'>;

export type TechSerialSalContext = {
  salId: number;
  staffId: number | null;
  shipmentId: number | null;
  scanRef: string | null;
  fnsku: string | null;
  ordersExceptionId: number | null;
  fbaShipmentId: number | null;
  fbaShipmentItemId: number | null;
  fnskuLogId: number | null;
  isFbaLike: boolean;
};

type ResolveTechSerialSalContextResult =
  | { ok: true; ctx: TechSerialSalContext }
  | { ok: false; error: string; status: number };

type InsertTechSerialForSalContextResult =
  | {
      ok: true;
      techSerialId: number;
      serial: string;
      serialType: string;
    }
  | {
      ok: false;
      error: string;
      status: number;
    };

export function normalizeTechSerial(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

export function detectTechSerialType(serial: string, fnsku: string | null): string {
  if (/^(X0|B0)/i.test(serial)) return 'FNSKU';
  if (fnsku) return 'FNSKU';
  return 'SERIAL';
}

export async function getTechSerialsBySalId(db: Queryable, salId: number): Promise<string[]> {
  const r = await db.query(
    `SELECT serial_number
     FROM tech_serial_numbers
     WHERE context_station_activity_log_id = $1
     ORDER BY id`,
    [salId],
  );
  return mergeSerialsFromTsnRows(r.rows);
}

export async function resolveTechSerialSalContext(
  db: Queryable,
  salId: number,
): Promise<ResolveTechSerialSalContextResult> {
  const salResult = await db.query(
    `SELECT id, staff_id, shipment_id, scan_ref, fnsku, orders_exception_id,
            fba_shipment_id, fba_shipment_item_id
     FROM station_activity_logs
     WHERE id = $1
     LIMIT 1`,
    [salId],
  );

  if (salResult.rows.length === 0) {
    return { ok: false, error: 'Scan session not found', status: 404 };
  }

  const row = salResult.rows[0] as {
    id: number;
    staff_id: number | null;
    shipment_id: number | null;
    scan_ref: string | null;
    fnsku: string | null;
    orders_exception_id: number | null;
    fba_shipment_id: number | null;
    fba_shipment_item_id: number | null;
  };

  const fnskuLogResult = await db.query(
    `SELECT id
     FROM fba_fnsku_logs
     WHERE station_activity_log_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [salId],
  );

  const fnskuLogId = fnskuLogResult.rows[0]?.id != null
    ? Number(fnskuLogResult.rows[0].id)
    : null;

  const fnsku = row.fnsku ? String(row.fnsku).trim().toUpperCase() : null;

  return {
    ok: true,
    ctx: {
      salId: Number(row.id),
      staffId: row.staff_id != null ? Number(row.staff_id) : null,
      shipmentId: row.shipment_id != null ? Number(row.shipment_id) : null,
      scanRef: row.scan_ref ? String(row.scan_ref) : null,
      fnsku,
      ordersExceptionId: row.orders_exception_id != null ? Number(row.orders_exception_id) : null,
      fbaShipmentId: row.fba_shipment_id != null ? Number(row.fba_shipment_id) : null,
      fbaShipmentItemId: row.fba_shipment_item_id != null ? Number(row.fba_shipment_item_id) : null,
      fnskuLogId,
      isFbaLike: Boolean(fnsku || row.fba_shipment_id != null || row.fba_shipment_item_id != null || fnskuLogId),
    },
  };
}

export async function insertTechSerialForSalContext(
  db: Queryable,
  params: {
    salContext: TechSerialSalContext;
    staffId: number;
    serial: string;
    allowDuplicates?: boolean;
    source?: string;
    sourceMethod?: 'SCAN' | 'SKU_PULL';
    sourceSkuId?: number | null;
    sourceSkuCode?: string | null;
  },
): Promise<InsertTechSerialForSalContextResult> {
  const serial = normalizeTechSerial(params.serial);
  if (!serial) {
    return { ok: false, error: 'serial is required', status: 400 };
  }

  const serialType = detectTechSerialType(serial, params.salContext.fnsku);
  const allowDuplicates = Boolean(params.allowDuplicates) || params.salContext.isFbaLike;

  if (!allowDuplicates) {
    const dup = await db.query(
      `SELECT 1
       FROM tech_serial_numbers
       WHERE context_station_activity_log_id = $1
         AND UPPER(TRIM(serial_number)) = $2
       LIMIT 1`,
      [params.salContext.salId, serial],
    );
    if (dup.rows.length > 0) {
      return {
        ok: false,
        error: `Serial ${serial} already scanned for this order`,
        status: 400,
      };
    }
  }

  const insertResult = await db.query(
    `INSERT INTO tech_serial_numbers
       (shipment_id, source_sku_id, orders_exception_id, scan_ref, serial_number, serial_type,
        tested_by, fnsku, fnsku_log_id, fba_shipment_id, fba_shipment_item_id,
        context_station_activity_log_id)
     VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      params.salContext.shipmentId,
      params.sourceSkuId ?? null,
      params.salContext.ordersExceptionId,
      serial,
      serialType,
      params.staffId,
      params.salContext.fnsku,
      params.salContext.fnskuLogId,
      params.salContext.fbaShipmentId,
      params.salContext.fbaShipmentItemId,
      params.salContext.salId,
    ],
  );

  const techSerialId = Number(insertResult.rows[0]?.id);
  if (!Number.isFinite(techSerialId) || techSerialId <= 0) {
    return { ok: false, error: 'Failed to insert tech serial', status: 500 };
  }

  await createStationActivityLog(db, {
    station: 'TECH',
    activityType: 'SERIAL_ADDED',
    staffId: params.staffId,
    shipmentId: params.salContext.shipmentId,
    scanRef: null,
    fnsku: params.salContext.fnsku,
    ordersExceptionId: params.salContext.ordersExceptionId,
    fbaShipmentId: params.salContext.fbaShipmentId,
    fbaShipmentItemId: params.salContext.fbaShipmentItemId,
    techSerialNumberId: techSerialId,
    notes: `Serial added: ${serial}`,
    metadata: {
      source: params.source || 'tech.serial',
      source_method: params.sourceMethod || 'SCAN',
      source_sku_id: params.sourceSkuId ?? null,
      source_sku_code: params.sourceSkuCode ?? null,
      serial,
      serial_type: serialType,
      context_station_activity_log_id: params.salContext.salId,
    },
    createdAt: formatPSTTimestamp(),
  });

  return {
    ok: true,
    techSerialId,
    serial,
    serialType,
  };
}
