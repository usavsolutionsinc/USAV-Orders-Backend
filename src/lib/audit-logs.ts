import type { NextRequest } from 'next/server';
import type { AnonymousAuthContext, AuthContext } from '@/lib/auth/withAuth';

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

// ── Canonical vocabulary ───────────────────────────────────────────────────
//
// Industry-standard audit reads filter on `action` and `entity_type`. Both
// must be stable strings — never rename them. New verbs go here; downstream
// dashboards key off these constants.

export const AUDIT_ENTITY = {
  PO: 'purchase_order',
  RECEIVING: 'receiving',
  RECEIVING_LINE: 'receiving_line',
  SERIAL_UNIT: 'serial_unit',
  TECH_SERIAL: 'tech_serial_number',
  SKU: 'sku',
  SKU_STOCK: 'sku_stock',
  BIN: 'bin',
  SHIPMENT: 'shipment',
  ORDER: 'order',
  PACKER_LOG: 'PACKER_LOG',
  STAFF: 'staff',
} as const;

export const AUDIT_ACTION = {
  // PO / receiving
  PO_RECEIVE:                'po.receive',
  PO_RECEIVE_REVERSE:        'po.receive.reverse',
  RECEIVING_UNBOX:           'receiving.unbox',
  RECEIVING_DISPOSITION_SET: 'receiving.disposition.set',
  RECEIVING_LINE_QTY_UPDATE: 'receiving_line.qty.update',
  RECEIVING_HEADER_UPDATE:   'receiving.header.update',
  // Bin / location
  BIN_CREATE: 'bin.create',
  BIN_RENAME: 'bin.rename',
  BIN_MOVE:   'bin.move',
  BIN_SWAP:   'bin.swap',
  BIN_DELETE: 'bin.delete',
  // Serial unit (scanner verbs)
  SERIAL_SCAN:   'serial.scan',
  SERIAL_CREATE: 'serial.create',
  SERIAL_DELETE: 'serial.delete',
  // Receiving (scanner-driven matching)
  PO_LOOKUP:        'po.lookup',
  RECEIVING_MATCH:  'receiving.match',
  // SKU stock
  SKU_STOCK_ADJUST:       'sku_stock.adjust',
  SKU_STOCK_BIN_ASSIGN:   'sku_stock.bin.assign',
  SKU_STOCK_BIN_UNASSIGN: 'sku_stock.bin.unassign',
  SKU_STOCK_LOCATION_SET: 'sku_stock.location.set',
  // Pack / order (existing callers — keep their literals stable)
  PACK_COMPLETED: 'PACK_COMPLETED',
} as const;

export type AuditEntity = (typeof AUDIT_ENTITY)[keyof typeof AUDIT_ENTITY];
export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

/**
 * Reason codes — required on operations that break expected state (qty
 * adjust, scrap, override, cancel, manual receive reverse).
 */
export const AUDIT_REASON_REQUIRED: ReadonlySet<string> = new Set([
  AUDIT_ACTION.SKU_STOCK_ADJUST,
  AUDIT_ACTION.PO_RECEIVE_REVERSE,
  AUDIT_ACTION.BIN_DELETE,
]);

// ── Server-trusted wrapper ─────────────────────────────────────────────────
//
// Prefer this over calling createAuditLog directly. Pulls actor from the
// auth context and ip/ua/request-id from the request headers so call sites
// can't accidentally trust the request body for attribution.

export interface RecordAuditArgs {
  source: string;       // e.g. 'sku-stock-page', 'mobile-scanner', 'receiving-station'
  action: AuditAction | string;
  entityType: AuditEntity | string;
  entityId: string | number;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  stationActivityLogId?: number | null;
  /** Logical location for fast filter (e.g. 'A-12-03'). */
  binCode?: string | null;
  locationCode?: string | null;
  /** Raw barcode value if a scanner triggered this. */
  scanRef?: string | null;
  /** Why — required for AUDIT_REASON_REQUIRED actions. */
  reasonCode?: string | null;
  note?: string | null;
  method?: 'scan' | 'manual' | 'system';
  /** Allow legacy routes that still extract staff from body to override. */
  actorStaffIdOverride?: number | null;
  /** Free-form extension; merged into metadata. */
  extra?: Record<string, unknown>;
}

export async function recordAudit(
  db: Queryable,
  ctx: AuthContext | AnonymousAuthContext | null,
  req: Pick<NextRequest, 'headers'> | null,
  args: RecordAuditArgs,
): Promise<number | null> {
  const actorStaffId = ctx?.staffId ?? args.actorStaffIdOverride ?? null;
  const actorRole = ctx?.role ?? null;

  const headers = req?.headers;
  const requestId = headers?.get('x-request-id') ?? null;
  const xff = headers?.get('x-forwarded-for') ?? null;
  const ipAddress = xff ? xff.split(',')[0]?.trim() ?? null : headers?.get('x-real-ip') ?? null;
  const userAgent = headers?.get('user-agent') ?? null;

  if (
    AUDIT_REASON_REQUIRED.has(args.action) &&
    !(args.reasonCode && args.reasonCode.trim().length > 0)
  ) {
    // Don't throw — audit must never break the request. Surface in metadata
    // so the row still lands and ops can spot the gap.
    console.warn(`[audit] action=${args.action} missing required reason_code`);
  }

  const metadata: Record<string, unknown> = {
    method: args.method ?? 'manual',
    ...(args.binCode ? { bin_code: args.binCode } : {}),
    ...(args.locationCode ? { location_code: args.locationCode } : {}),
    ...(args.scanRef ? { scan_ref: args.scanRef } : {}),
    ...(args.reasonCode ? { reason_code: args.reasonCode } : {}),
    ...(args.note ? { note: args.note } : {}),
    ...(args.extra ?? {}),
  };

  try {
    return await createAuditLog(db, {
      actorStaffId,
      actorRole,
      source: args.source,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      stationActivityLogId: args.stationActivityLogId ?? null,
      requestId,
      ipAddress,
      userAgent,
      beforeData: args.before ?? null,
      afterData: args.after ?? null,
      metadata,
    });
  } catch (err) {
    // Audit must never break the request. Log + drop.
    console.warn('[audit_logs] write failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
