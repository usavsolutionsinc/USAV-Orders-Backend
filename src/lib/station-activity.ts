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
