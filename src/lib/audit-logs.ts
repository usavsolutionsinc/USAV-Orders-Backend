import type { NextRequest } from 'next/server';
import type { AnonymousAuthContext, AuthContext } from '@/lib/auth/withAuth';

type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
};

export interface CreateAuditLogParams {
  actorStaffId?: number | null;
  actorRole?: string | null;
  /** Tenant owner of this audit row. Nullable: system/no-actor rows stay NULL. */
  organizationId?: string | null;
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
      organization_id,
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
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb
    )
    RETURNING id`,
    [
      params.actorStaffId ?? null,
      params.actorRole ?? null,
      params.organizationId ?? null,
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
  HANDLING_UNIT: 'handling_unit',
  TECH_SERIAL: 'tech_serial_number',
  SKU: 'sku',
  SKU_RELATIONSHIP: 'sku_relationship',
  SKU_STOCK: 'sku_stock',
  BIN: 'bin',
  SHIPMENT: 'shipment',
  ORDER: 'order',
  PACKER_LOG: 'PACKER_LOG',
  STAFF: 'staff',
  STAFF_TODO: 'staff_todo',
  STAFF_MESSAGE: 'staff_message',
  REASON_CODE: 'reason_code',
  RMA: 'rma',
  REPAIR_SERVICE: 'repair_service',
  QC_CHECK_TEMPLATE: 'qc_check_template',
  FAILURE_MODE: 'failure_mode',
  UNIT_FAILURE_TAG: 'unit_failure_tag',
  UNIT_REPAIR: 'unit_repair',
  // Bose Sourcing Engine
  BOSE_MODEL: 'bose_model',
  PART_COMPATIBILITY: 'part_compatibility',
  SUPPLIER: 'supplier',
  SOURCING_ALERT: 'sourcing_alert',
  SOURCING_CANDIDATE: 'sourcing_candidate',
  SOURCING_SAVED_SEARCH: 'sourcing_saved_search',
  PART_ACQUISITION: 'part_acquisition',
  // Station builder (Operations Studio layer 2)
  STATION_DEFINITION: 'station_definition',
  // Workflow graphs (Operations Studio layer 1)
  WORKFLOW_DEFINITION: 'workflow_definition',
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
  BIN_UPDATE: 'bin.update',
  BIN_RENAME: 'bin.rename',
  BIN_MOVE:   'bin.move',
  BIN_SWAP:   'bin.swap',
  BIN_DELETE: 'bin.delete',
  // Serial unit (scanner verbs)
  SERIAL_SCAN:   'serial.scan',
  SERIAL_CREATE: 'serial.create',
  SERIAL_DELETE: 'serial.delete',
  // Handling units (LPN) — license-plated boxes/trays
  HANDLING_UNIT_CREATE:   'handling_unit.create',
  HANDLING_UNIT_ASSIGN:   'handling_unit.assign',
  HANDLING_UNIT_UNASSIGN: 'handling_unit.unassign',
  // Tech / QC verdicts (per-unit testing outcomes)
  TECH_QC_PASS:   'tech.qc.pass',
  TECH_QC_RETEST: 'tech.qc.retest',
  TECH_QC_FAIL:   'tech.qc.fail',
  // QC checklist templates (authoring CRUD) + per-unit results (execution)
  QC_CHECK_CREATE:  'qc_check.create',
  QC_CHECK_UPDATE:  'qc_check.update',
  QC_CHECK_DELETE:  'qc_check.delete',
  QC_CHECK_PUBLISH: 'qc_check.publish',
  QC_RESULT_RECORD: 'qc_result.record',
  // Failure-mode taxonomy (CRUD) + per-unit failure tags
  FAILURE_MODE_CREATE: 'failure_mode.create',
  FAILURE_MODE_UPDATE: 'failure_mode.update',
  FAILURE_MODE_DELETE: 'failure_mode.delete',
  FAILURE_TAG_ADD:     'failure_tag.add',
  FAILURE_TAG_RESOLVE: 'failure_tag.resolve',
  // Personal header to-do lists (general + recurring)
  STAFF_TODO_CREATE:       'staff_todo.create',
  STAFF_TODO_SET_INTERVAL: 'staff_todo.set_interval',
  STAFF_TODO_ARCHIVE:      'staff_todo.archive',
  STAFF_TODO_UNARCHIVE:    'staff_todo.unarchive',
  // Staff-to-staff messages (clipboard "send to staff")
  STAFF_MESSAGE_SEND:      'staff_message.send',
  // Per-unit repair records
  REPAIR_OPEN:     'unit_repair.open',
  REPAIR_UPDATE:   'unit_repair.update',
  REPAIR_COMPLETE: 'unit_repair.complete',
  // Receiving (scanner-driven matching)
  PO_LOOKUP:        'po.lookup',
  RECEIVING_MATCH:  'receiving.match',
  // GS1 Digital Link resolver (single QR → contextual internal page)
  GS1_RESOLVE:      'gs1.resolve',
  // SKU stock
  SKU_STOCK_ADJUST:       'sku_stock.adjust',
  SKU_STOCK_BIN_ASSIGN:   'sku_stock.bin.assign',
  SKU_STOCK_BIN_UNASSIGN: 'sku_stock.bin.unassign',
  SKU_STOCK_LOCATION_SET: 'sku_stock.location.set',
  // SKU catalog (CRUD)
  SKU_CATALOG_CREATE: 'sku_catalog.create',
  SKU_CATALOG_UPDATE: 'sku_catalog.update',
  SKU_CATALOG_DELETE: 'sku_catalog.delete',
  // SKU relationship graph (parent→child edges)
  SKU_RELATIONSHIP_CREATE: 'sku_relationship.create',
  SKU_RELATIONSHIP_UPDATE: 'sku_relationship.update',
  SKU_RELATIONSHIP_DELETE: 'sku_relationship.delete',
  // Reason codes (CRUD)
  REASON_CODE_CREATE: 'reason_code.create',
  REASON_CODE_UPDATE: 'reason_code.update',
  REASON_CODE_DELETE: 'reason_code.delete',
  // RMA (record-level CRUD; lifecycle transitions live in verb routes)
  RMA_UPDATE: 'rma.update',
  RMA_CANCEL: 'rma.cancel',
  // Order record edit (delete uses the legacy 'orders.delete' literal)
  ORDER_UPDATE: 'orders.update',
  // Unshipped governing events — first time a carrier tracking number is added to
  // an order, and when its shipping label is printed/attached. Feed the order
  // timeline (EventTimeline) on the dashboard details panel.
  TRACKING_ADDED: 'orders.tracking.added',
  LABEL_PRINTED: 'orders.label.printed',
  // Orders-exceptions reconciliation sweep (writes orders + orders_exceptions)
  ORDERS_EXCEPTIONS_SYNC: 'orders_exceptions.sync',
  // Repair service soft-cancel + its reverse (reopen → restore prior status)
  REPAIR_CANCEL: 'repair_service.cancel',
  REPAIR_REOPEN: 'repair_service.reopen',
  // Pack / order (existing callers — keep their literals stable)
  PACK_COMPLETED: 'PACK_COMPLETED',
  // Dock scan-out: the package physically left the warehouse (SHIP_CONFIRM event)
  SHIP_CONFIRM_SCAN: 'shipment.scan_out',
  // Bose Sourcing Engine — compatibility DB + alternative sourcing
  BOSE_MODEL_CREATE: 'bose_model.create',
  BOSE_MODEL_UPDATE: 'bose_model.update',
  BOSE_MODEL_DELETE: 'bose_model.delete',
  PART_COMPATIBILITY_CREATE: 'part_compatibility.create',
  PART_COMPATIBILITY_UPDATE: 'part_compatibility.update',
  PART_COMPATIBILITY_DELETE: 'part_compatibility.delete',
  SUPPLIER_CREATE: 'supplier.create',
  SUPPLIER_UPDATE: 'supplier.update',
  SUPPLIER_DELETE: 'supplier.delete',
  SOURCING_ALERT_CREATE: 'sourcing.alert.create',
  SOURCING_ALERT_RESOLVE: 'sourcing.alert.resolve',
  SOURCING_SEARCH: 'sourcing.search',
  SOURCING_SAVED_SEARCH_CREATE: 'sourcing.saved_search.create',
  SOURCING_SAVED_SEARCH_UPDATE: 'sourcing.saved_search.update',
  SOURCING_SAVED_SEARCH_DELETE: 'sourcing.saved_search.delete',
  SOURCING_SAVED_SEARCH_RUN: 'sourcing.saved_search.run',
  SOURCING_CANDIDATE_SAVE: 'sourcing.candidate.save',
  SOURCING_CANDIDATE_UPDATE: 'sourcing.candidate.update',
  SOURCING_CANDIDATE_IMPORT: 'sourcing.candidate.import',
  // Station builder (Operations Studio layer 2) — draft/publish lifecycle
  STATION_DRAFT_SAVE: 'station.draft.save',
  STATION_PUBLISH:    'station.publish',
  // Workflow graphs (Operations Studio layer 1) — draft/publish lifecycle
  WORKFLOW_DRAFT_CREATE: 'workflow.draft.create',
  WORKFLOW_DRAFT_SAVE:   'workflow.draft.save',
  WORKFLOW_PUBLISH:      'workflow.publish',
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
  // Sourcing: resolving an alert and importing a candidate both need a "why".
  AUDIT_ACTION.SOURCING_ALERT_RESOLVE,
  AUDIT_ACTION.SOURCING_CANDIDATE_IMPORT,
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
  /** Org for cron/transitional callers that pass ctx=null (no request org). */
  organizationIdOverride?: string | null;
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
  // Stamp the tenant so audit reads are org-filterable (was always NULL before).
  // ctx.organizationId covers every request route automatically; cron/transitional
  // callers (ctx=null) pass organizationIdOverride. System rows stay NULL.
  const organizationId = ctx?.organizationId ?? args.organizationIdOverride ?? null;

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
      organizationId,
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
