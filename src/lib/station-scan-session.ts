import type { Pool } from 'pg';

export type StationScanSessionKind = 'ORDER' | 'EXCEPTION' | 'FNSKU' | 'REPAIR';

export type CreateStationScanSessionParams = {
  staffId: number;
  sessionKind: StationScanSessionKind;
  shipmentId?: number | null;
  ordersExceptionId?: number | null;
  repairServiceId?: number | null;
  trackingKey18?: string | null;
  trackingRaw?: string | null;
  scanRef?: string | null;
  fnsku?: string | null;
};

export type StationScanSessionRow = {
  id: string;
  staff_id: number;
  session_kind: string;
  shipment_id: string | null;
  orders_exception_id: number | null;
  repair_service_id: number | null;
  tracking_key18: string | null;
  tracking_raw: string | null;
  scan_ref: string | null;
  fnsku: string | null;
};

export async function createStationScanSession(
  db: Pick<Pool, 'query'>,
  params: CreateStationScanSessionParams,
): Promise<string> {
  const r = await db.query(
    `INSERT INTO station_scan_sessions (
       staff_id, session_kind, shipment_id, orders_exception_id, repair_service_id,
       tracking_key18, tracking_raw, scan_ref, fnsku
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id::text`,
    [
      params.staffId,
      params.sessionKind,
      params.shipmentId ?? null,
      params.ordersExceptionId ?? null,
      params.repairServiceId ?? null,
      params.trackingKey18 ?? null,
      params.trackingRaw ?? null,
      params.scanRef ?? null,
      params.fnsku ?? null,
    ],
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error('createStationScanSession: no id returned');
  return String(id);
}

export async function getValidStationScanSession(
  db: Pick<Pool, 'query'>,
  sessionId: string,
  staffId: number,
): Promise<StationScanSessionRow | null> {
  const r = await db.query(
    `SELECT id::text, staff_id, session_kind, shipment_id::text, orders_exception_id,
            repair_service_id, tracking_key18, tracking_raw, scan_ref, fnsku
     FROM station_scan_sessions
     WHERE id = $1::uuid
       AND staff_id = $2
       AND expires_at > NOW()`,
    [sessionId, staffId],
  );
  return (r.rows[0] as StationScanSessionRow) ?? null;
}

/** True if client tracking string matches the anchored session (key18 or raw). */
export function trackingMatchesSession(
  session: StationScanSessionRow,
  clientTracking: string,
  clientKey18: string,
): boolean {
  const raw = String(clientTracking || '').trim();
  if (!raw) return true;
  const sRaw = String(session.tracking_raw || '').trim();
  if (sRaw && raw.toUpperCase() === sRaw.toUpperCase()) return true;
  const sk = String(session.tracking_key18 || '').trim();
  if (sk && clientKey18 && sk === clientKey18) return true;
  return false;
}
