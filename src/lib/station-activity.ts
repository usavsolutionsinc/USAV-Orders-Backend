type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
};

export type StationName = 'TECH' | 'PACK' | 'RECEIVING' | 'ADMIN';
export type StationActivityType =
  | 'TRACKING_SCANNED'
  | 'FNSKU_SCANNED'
  | 'SERIAL_ADDED'
  | 'PACK_COMPLETED'
  | 'PACK_SCAN'
  | 'FBA_READY';

export async function createStationActivityLog(
  db: Queryable,
  params: {
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
       station, activity_type, staff_id, shipment_id, scan_ref, fnsku,
       orders_exception_id, fba_shipment_id, fba_shipment_item_id,
       tech_serial_number_id, packer_log_id, notes, metadata, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, COALESCE($14::timestamptz, NOW()))
     RETURNING id`,
    [
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
