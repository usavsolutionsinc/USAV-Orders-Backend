type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
};

export interface CreateAuditLogParams {
  actorStaffId?: number | null;
  actorRole?: string | null;
  source: string;
  action: string;
  entityType: string;
  entityId: string | number;
  stationActivityLogId?: number | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

export async function createAuditLog(
  db: Queryable,
  params: CreateAuditLogParams,
): Promise<number | null> {
  const result = await db.query(
    `INSERT INTO audit_logs (
      actor_staff_id,
      actor_role,
      source,
      action,
      entity_type,
      entity_id,
      station_activity_log_id,
      request_id,
      ip_address,
      user_agent,
      before_data,
      after_data,
      metadata
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb
    )
    RETURNING id`,
    [
      params.actorStaffId ?? null,
      params.actorRole ?? null,
      params.source,
      params.action,
      params.entityType,
      String(params.entityId),
      params.stationActivityLogId ?? null,
      params.requestId ?? null,
      params.ipAddress ?? null,
      params.userAgent ?? null,
      params.beforeData ? JSON.stringify(params.beforeData) : null,
      params.afterData ? JSON.stringify(params.afterData) : null,
      JSON.stringify(params.metadata ?? {}),
    ],
  );

  return result.rows[0]?.id ? Number(result.rows[0].id) : null;
}
