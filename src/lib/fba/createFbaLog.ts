type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
};

export type FbaLogSourceStage = 'TECH' | 'PACK' | 'SHIP' | 'ADMIN';

export type FbaLogEventType =
  | 'SCANNED'
  | 'READY'
  | 'VERIFIED'
  | 'BOXED'
  | 'ASSIGNED'
  | 'SHIPPED'
  | 'UNASSIGNED'
  | 'VOID'
  | 'LABEL_ASSIGNED'
  | 'PACKER_VERIFIED';

export interface CreateFbaLogParams {
  fnsku: string;
  sourceStage: FbaLogSourceStage;
  eventType: FbaLogEventType | string;
  staffId: number | null;
  stationActivityLogId?: number | null;
  fbaShipmentId?: number | null;
  fbaShipmentItemId?: number | null;
  quantity?: number;
  station?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Single entry point for all fba_fnsku_logs inserts.
 * Sets the station_activity_log_id FK when a SAL row exists for the action.
 */
export async function createFbaLog(
  db: Queryable,
  params: CreateFbaLogParams,
): Promise<number | null> {
  const result = await db.query(
    `INSERT INTO fba_fnsku_logs
     (fnsku, source_stage, event_type, staff_id, station_activity_log_id,
      fba_shipment_id, fba_shipment_item_id, quantity, station, notes, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     RETURNING id`,
    [
      params.fnsku,
      params.sourceStage,
      params.eventType,
      params.staffId,
      params.stationActivityLogId ?? null,
      params.fbaShipmentId ?? null,
      params.fbaShipmentItemId ?? null,
      params.quantity ?? 1,
      params.station ?? null,
      params.notes ?? null,
      JSON.stringify(params.metadata ?? {}),
    ],
  );

  return result.rows[0]?.id ? Number(result.rows[0].id) : null;
}
