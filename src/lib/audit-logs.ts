import type { NextRequest } from 'next/server';
import type { AnonymousAuthContext, AuthContext } from '@/lib/auth/auth-context';

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
  PART_LINK: 'part_link',
  // Fulfillment substitution / order-line amendment (ordered vs fulfilled unit)
  ORDER_AMENDMENT: 'order_amendment',
  SKU_STOCK: 'sku_stock',
  BIN: 'bin',
  SHIPMENT: 'shipment',
  ORDER: 'order',
  PACKER_LOG: 'PACKER_LOG',
  STAFF: 'staff',
  PHOTO: 'photo',
  PHOTO_FOLDER: 'photo_folder',
  PHOTO_IMAGE_TYPE: 'photo_image_type',
  PHOTO_LABEL: 'photo_label',
  LISTING_PHOTO: 'listing_photo',
  // External platform connection (organization_integrations vault row).
  INTEGRATION: 'integration',
  STAFF_TODO: 'staff_todo',
  STAFF_MESSAGE: 'staff_message',
  STAFF_PREFERENCE: 'staff_preference',
  // Settings Registry — per-page org/staff configurable behavior (docs/settings-registry.md)
  SETTINGS: 'settings',
  REASON_CODE: 'reason_code',
  RMA: 'rma',
  REPAIR_SERVICE: 'repair_service',
  QC_CHECK_TEMPLATE: 'qc_check_template',
  CHECKLIST_TEMPLATE: 'checklist_template',
  KIT_PART_TEMPLATE: 'kit_part_template',
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
  // Operations ▸ History — server-backed Master Journey saved views
  OPERATIONS_SAVED_VIEW: 'operations_saved_view',
  // Media library (/ops/photos) — server-backed filter/view presets
  MEDIA_SAVED_VIEW: 'media_saved_view',
  // Voice (Nextiva) — Support ▸ Voicemail / Calls
  VOICEMAIL: 'voicemail',
  CALL_EVENT: 'call_event',
  // Tenant / identity (Phase F signup → org provisioning)
  ORGANIZATION: 'organization',
} as const;

export const AUDIT_ACTION = {
  // PO / receiving
  PO_RECEIVE:                'po.receive',
  PO_RECEIVE_REVERSE:        'po.receive.reverse',
  RECEIVING_UNBOX:           'receiving.unbox',
  RECEIVING_DISPOSITION_SET: 'receiving.disposition.set',
  RECEIVING_LINE_QTY_UPDATE: 'receiving_line.qty.update',
  RECEIVING_HEADER_UPDATE:   'receiving.header.update',
  /**
   * Operator-driven PO relink — make the website authoritative over Zoho. Writes
   * the chosen PO (and optional SKU correction) onto the line + carton, even when
   * Zoho already had a different (wrong) link. Distinct from RECEIVING_MATCH
   * (adopt expected lines) and the upgrade-only header update.
   */
  RECEIVING_RELINK:          'receiving.relink',
  /** A marketplace purchase (eBay buyer account, …) was imported onto the Incoming
   *  spine via the bridge/sync (Universal Incoming Phase 2). */
  RECEIVING_INBOUND_IMPORT:  'receiving.inbound.import',
  /** Manual n8n-style lifecycle advance through transitionReceivingLine(). */
  RECEIVING_LINE_ADVANCE:    'receiving_line.advance',
  /** Real "Save for unbox" transition — stamps receiving.triage_complete. */
  RECEIVING_TRIAGE_COMPLETE: 'receiving.triage.complete',
  /**
   * A scanned serial was auto-resolved to a previously-shipped order during
   * receiving (the shipped↔returned loop), flipping the carton to a return and
   * its open allocation SHIPPED→RETURNED. Distinct from a manual returns-dock
   * intake — this fires on the normal unbox serial scan.
   */
  RETURN_LINK:               'return.link',
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
  // Per-unit listing on a sales channel (engine Phase 1.4 'listed' fact)
  SERIAL_LIST:   'serial.list',
  // Handling units (LPN) — license-plated boxes/trays
  HANDLING_UNIT_CREATE:   'handling_unit.create',
  HANDLING_UNIT_ASSIGN:   'handling_unit.assign',
  HANDLING_UNIT_UNASSIGN: 'handling_unit.unassign',
  // Tech / QC verdicts (per-unit testing outcomes)
  TECH_QC_PASS:   'tech.qc.pass',
  TECH_QC_RETEST: 'tech.qc.retest',
  TECH_QC_FAIL:   'tech.qc.fail',
  TECH_DATA_WIPE: 'tech.data_wipe',   // secure erase / factory reset (electronics)
  // QC checklist templates (authoring CRUD) + per-unit results (execution)
  QC_CHECK_CREATE:  'qc_check.create',
  QC_CHECK_UPDATE:  'qc_check.update',
  QC_CHECK_DELETE:  'qc_check.delete',
  QC_CHECK_PUBLISH: 'qc_check.publish',
  CHECKLIST_CREATE:  'checklist.create',
  CHECKLIST_UPDATE:  'checklist.update',
  CHECKLIST_DELETE:  'checklist.delete',
  CHECKLIST_PUBLISH: 'checklist.publish',
  QC_RESULT_RECORD: 'qc_result.record',
  // Kit-parts / BOM templates ("what's in the box" authoring CRUD)
  KIT_PART_CREATE: 'kit_part.create',
  KIT_PART_UPDATE: 'kit_part.update',
  KIT_PART_DELETE: 'kit_part.delete',
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
  // Photo library — minted N temporary signed share links for selected photos
  PHOTO_SHARE_LINK:        'photo.share_link',
  // Photo library master folders (operator-created, persistent) + assignments
  PHOTO_FOLDER_CREATE:     'photo_folder.create',
  PHOTO_FOLDER_RENAME:     'photo_folder.rename',
  PHOTO_FOLDER_MOVE:       'photo_folder.move',
  PHOTO_FOLDER_DELETE:     'photo_folder.delete',
  PHOTO_FOLDER_ASSIGN:     'photo_folder.assign',
  PHOTO_FOLDER_UNASSIGN:   'photo_folder.unassign',
  PHOTO_IMAGE_TYPE_CREATE: 'photo_image_type.create',
  // Photo labels — org vocabulary CRUD + per-photo / bulk assignment
  PHOTO_LABEL_CREATE:      'photo_label.create',
  PHOTO_LABEL_UPDATE:      'photo_label.update',
  PHOTO_LABEL_DELETE:      'photo_label.delete',
  PHOTO_LABELS_SET:        'photo_label.set',
  PHOTO_LABELS_BULK_APPLY: 'photo_label.bulk_apply',
  // Listing gallery composition (marketplace photo set)
  LISTING_PHOTO_ADD:       'listing_photo.add',
  LISTING_PHOTO_REORDER:   'listing_photo.reorder',
  LISTING_PHOTO_SET_COVER: 'listing_photo.set_cover',
  LISTING_PHOTO_REMOVE:    'listing_photo.remove',
  // Photo backup — copied photo originals into a tenant's connected Google Drive
  PHOTO_DRIVE_EXPORT:      'photo.drive_export',
  // External integration connection lifecycle (OAuth connect / disconnect)
  INTEGRATION_CONNECT:     'integration.connect',
  INTEGRATION_DISCONNECT:  'integration.disconnect',
  // Personal UI preferences (e.g. configurable focus-scan hotkey)
  STAFF_PREFERENCE_UPDATE: 'staff_preference.update',
  // Settings Registry — org/staff per-page setting change (docs/settings-registry.md)
  SETTINGS_UPDATE: 'settings.update',
  // Per-unit repair records
  REPAIR_OPEN:     'unit_repair.open',
  REPAIR_UPDATE:   'unit_repair.update',
  REPAIR_COMPLETE: 'unit_repair.complete',
  // Receiving (scanner-driven matching)
  PO_LOOKUP:        'po.lookup',
  RECEIVING_MATCH:  'receiving.match',
  /** Manual "Retry pair" from the Unfound strip — re-runs the same tracking search reconcileUnmatchedReceiving does on its cron sweep. */
  RECEIVING_RETRY_PAIR: 'receiving.retry_pair',
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
  // OCR local-pickup: item read off a label that isn't in the system yet was
  // flagged into the pending_skus "needs creating in Zoho" queue (P2-AI-01).
  SKU_CATALOG_FLAG_MISSING: 'sku_catalog.flag_missing',
  // SKU relationship graph (parent→child edges)
  SKU_RELATIONSHIP_CREATE: 'sku_relationship.create',
  SKU_RELATIONSHIP_UPDATE: 'sku_relationship.update',
  SKU_RELATIONSHIP_DELETE: 'sku_relationship.delete',
  PART_LINK_CREATE: 'part_link.create',
  PART_LINK_DELETE: 'part_link.delete',
  PART_LINK_MARK_NOT_PART: 'part_link.mark_not_a_part',
  // Reason codes (CRUD)
  REASON_CODE_CREATE: 'reason_code.create',
  REASON_CODE_UPDATE: 'reason_code.update',
  REASON_CODE_DELETE: 'reason_code.delete',
  // RMA (record-level CRUD; lifecycle transitions live in verb routes)
  RMA_UPDATE: 'rma.update',
  RMA_CANCEL: 'rma.cancel',
  RMA_DISPOSITION: 'rma.disposition',
  // Order record edit (delete uses the legacy 'orders.delete' literal)
  ORDER_UPDATE: 'orders.update',
  // Fulfillment substitution — the unit that ships deviates from what was
  // ordered/listed. Re-allocation event recorded in order_unit_amendments;
  // approve/reject gate the block_until_approved enforcement path.
  ORDER_SUBSTITUTE_UNIT:   'order.substitute_unit',
  ORDER_AMENDMENT_APPROVE: 'order.amendment.approve',
  ORDER_AMENDMENT_REJECT:  'order.amendment.reject',
  // Unshipped governing events — first time a carrier tracking number is added to
  // an order, and when its shipping label is printed/attached. Feed the order
  // timeline (EventTimeline) on the dashboard details panel.
  TRACKING_ADDED: 'orders.tracking.added',
  LABEL_PRINTED: 'orders.label.printed',
  // Carrier-API label lifecycle (ShipStation outbound station): buying a
  // rate-shopped label and voiding/refunding it. LABEL_PRINTED still fires on
  // the first stored label for the order timeline.
  LABEL_PURCHASED: 'orders.label.purchased',
  LABEL_VOIDED: 'orders.label.voided',
  // Outbound documents (docs/outbound-documents-plan.md) — packing slips +
  // shipping labels stored on `documents` + linked via `document_entity_links`.
  // LABEL_PRINTED (above) is preserved for the timeline on an order's FIRST
  // label attach; these cover the general CRUD lifecycle for both doc types.
  ORDER_DOCUMENT_ATTACH: 'order.document.attach',
  ORDER_DOCUMENT_FETCH:  'order.document.fetch',
  ORDER_DOCUMENT_DELETE: 'order.document.delete',
  // Orders-exceptions reconciliation sweep (writes orders + orders_exceptions)
  ORDERS_EXCEPTIONS_SYNC: 'orders_exceptions.sync',
  // Repair service soft-cancel + its reverse (reopen → restore prior status)
  REPAIR_CANCEL: 'repair_service.cancel',
  REPAIR_REOPEN: 'repair_service.reopen',
  // Repair service ticket CRUD + linkage (manual entry / manual pairing)
  REPAIR_SERVICE_CREATE: 'repair_service.create',
  REPAIR_SERVICE_UPDATE: 'repair_service.update',
  REPAIR_SERVICE_LINK:   'repair_service.link',
  REPAIR_SERVICE_UNLINK: 'repair_service.unlink',
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
  // Cloning a system template into the org's definitions as a draft (Phase E4).
  WORKFLOW_TEMPLATE_IMPORT: 'workflow.template.import',
  // Operations ▸ History — Master Journey saved views (personal/shared presets)
  OPERATIONS_SAVED_VIEW_CREATE: 'operations.saved_view.create',
  OPERATIONS_SAVED_VIEW_UPDATE: 'operations.saved_view.update',
  OPERATIONS_SAVED_VIEW_DELETE: 'operations.saved_view.delete',
  // Media library (/ops/photos) — saved filter/view presets (personal/shared)
  MEDIA_SAVED_VIEW_CREATE: 'media.saved_view.create',
  MEDIA_SAVED_VIEW_UPDATE: 'media.saved_view.update',
  MEDIA_SAVED_VIEW_DELETE: 'media.saved_view.delete',
  // Voice (Nextiva) — Support ▸ Voicemail / Calls
  VOICEMAIL_FOLLOWUP_RESOLVED: 'voicemail.followup.resolved',
  VOICEMAIL_LINKED:            'voicemail.linked',
  VOICE_CALL_ORIGINATED:       'voice.call.originated',
  // Tenant lifecycle — self-service signup provisions a new org (Phase F).
  ORG_CREATE: 'organization.create',
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
  // A substitution deviates from the order — it must justify itself.
  AUDIT_ACTION.ORDER_SUBSTITUTE_UNIT,
  // Voiding a purchased label reverses a paid carrier action — require a reason.
  AUDIT_ACTION.LABEL_VOIDED,
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
