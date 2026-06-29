type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
};

export type StationName = 'TECH' | 'PACK' | 'FBA' | 'RECEIVING' | 'ADMIN' | 'OUTBOUND';
export type StationActivityType =
  | 'TRACKING_SCANNED'
  | 'FNSKU_SCANNED'
  | 'SERIAL_ADDED'
  | 'PACK_COMPLETED'
  | 'PACK_SCAN'
  | 'FBA_READY'
  // Dock / handoff scan: the package physically left the building. Distinct from
  // PACK_* (in the box) and from carrier-reported custody on shipping_tracking_numbers.
  // `station_activity_logs.activity_type`/`station` are free-text VARCHAR, so this
  // needs no migration — only this union edit.
  | 'SHIP_CONFIRM'
  // Dock staging: packed package placed in the outbound staging lane, awaiting scan-out.
  | 'DOCK_STAGED'
  | 'WS_ORDER_TESTED'
  | 'WS_REPAIR_CHANGED'
  | 'WS_RECEIVING_CHANGED'
  | 'WS_FBA_SCAN';

// ─── Activity-type vocabularies (SoT for the SQL lifecycle filters) ─────────────
// These named groupings replace the literal `activity_type IN (...)` lists that
// were duplicated across the orders / operations / staff-goals routes. Each set
// is a deliberate membership — do NOT merge two that happen to overlap (e.g. the
// orders board's TECH-tested signal is `= 'TRACKING_SCANNED'` only and stays a
// single literal; it is intentionally NOT the 2-type TECH_TEST set below).

/** A packer completed/scanned the box (the "packed" signal). */
export const PACK_ACTIVITY_TYPES = ['PACK_COMPLETED', 'PACK_SCAN'] as const;

/** A tech bench "tested today" signal (tracking or FNSKU scan at TECH). */
export const TECH_TEST_ACTIVITY_TYPES = ['TRACKING_SCANNED', 'FNSKU_SCANNED'] as const;

/** Every scan that counts toward daily throughput / staff-velocity rollups. */
export const VELOCITY_ACTIVITY_TYPES = [
  'TRACKING_SCANNED',
  'FNSKU_SCANNED',
  'PACK_SCAN',
  'PACK_COMPLETED',
  'FBA_READY',
] as const;

/**
 * Render a string vocabulary as the body of a SQL `IN (...)` clause, producing
 * exactly `'A', 'B'` (single-quoted, comma+space) — byte-identical to the
 * literals these constants replace. Values are compile-time constants (never
 * user input), so interpolation is safe.
 */
export function sqlInList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(', ');
}

export async function createStationActivityLog(
  db: Queryable,
  params: {
    /**
     * Phase 3a: tenant scope. Required because station_activity_logs has a
     * NOT NULL organization_id column. Without this, every scan-time INSERT
     * fails (manifested as the tech-station scan bar appearing to silently
     * drop scans).
     */
    organizationId: string;
    station: StationName;
    activityType: StationActivityType;
    staffId: number | null;
    shipmentId?: number | null;
    scanRef?: string | null;
    fnsku?: string | null;
    ordersExceptionId?: number | null;
    fbaShipmentId?: number | null;
    fbaShipmentItemId?: number | null;
    techSerialNumberId?: number | null;
    packerLogId?: number | null;
    notes?: string | null;
    metadata?: Record<string, unknown>;
    createdAt?: string | null;
  },
): Promise<number | null> {
  const result = await db.query(
    `INSERT INTO station_activity_logs (
       organization_id, station, activity_type, staff_id, shipment_id, scan_ref, fnsku,
       orders_exception_id, fba_shipment_id, fba_shipment_item_id,
       tech_serial_number_id, packer_log_id, notes, metadata, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, COALESCE($15::timestamptz, NOW()))
     RETURNING id`,
    [
      params.organizationId,
      params.station,
      params.activityType,
      params.staffId,
      params.shipmentId ?? null,
      params.scanRef ?? null,
      params.fnsku ?? null,
      params.ordersExceptionId ?? null,
      params.fbaShipmentId ?? null,
      params.fbaShipmentItemId ?? null,
      params.techSerialNumberId ?? null,
      params.packerLogId ?? null,
      params.notes ?? null,
      JSON.stringify(params.metadata ?? {}),
      params.createdAt ?? null,
    ],
  );

  return result.rows[0]?.id ? Number(result.rows[0].id) : null;
}
