import { pgTable, serial, text, varchar, boolean, timestamp, integer, date, primaryKey, json, jsonb, pgEnum, bigserial, bigint } from 'drizzle-orm/pg-core';

// eBay Accounts table
export const ebayAccounts = pgTable('ebay_accounts', {
  id: serial('id').primaryKey(),
  accountName: varchar('account_name', { length: 50 }).notNull().unique(),
  ebayUserId: varchar('ebay_user_id', { length: 100 }),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  tokenExpiresAt: timestamp('token_expires_at').notNull(),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at').notNull(),
  marketplaceId: varchar('marketplace_id', { length: 20 }).default('EBAY_US'),
  lastSyncDate: timestamp('last_sync_date'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Staff table
export const staff = pgTable('staff', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  role: varchar('role', { length: 50 }).notNull(),
  employeeId: varchar('employee_id', { length: 50 }).unique(),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

export const qaStatusEnum = pgEnum('qa_status_enum', [
  'PENDING',
  'PASSED',
  'FAILED_DAMAGED',
  'FAILED_INCOMPLETE',
  'FAILED_FUNCTIONAL',
  'HOLD',
]);

export const dispositionEnum = pgEnum('disposition_enum', [
  'ACCEPT',
  'HOLD',
  'RTV',
  'SCRAP',
  'REWORK',
]);

export const conditionGradeEnum = pgEnum('condition_grade_enum', [
  'BRAND_NEW',
  'USED_A',
  'USED_B',
  'USED_C',
  'PARTS',
]);

export const returnPlatformEnum = pgEnum('return_platform_enum', [
  'AMZ',
  'EBAY_DRAGONH',
  'EBAY_USAV',
  'EBAY_MK',
  'FBA',
  'WALMART',
  'ECWID',
]);

export const targetChannelEnum = pgEnum('target_channel_enum', [
  'ORDERS',
  'FBA',
]);

export const workEntityTypeEnum = pgEnum('work_entity_type_enum', [
  'ORDER',
  'REPAIR',
  'FBA_SHIPMENT',
  'RECEIVING',
  'SKU_STOCK',
]);

export const workTypeEnum = pgEnum('work_type_enum', [
  'TEST',
  'PACK',
  'REPAIR',
  'QA',
  'RECEIVE',
  'STOCK_REPLENISH',
]);

export const assignmentStatusEnum = pgEnum('assignment_status_enum', [
  'OPEN',
  'ASSIGNED',
  'IN_PROGRESS',
  'DONE',
  'CANCELED',
]);

export const inboundWorkflowStatusEnum = pgEnum('inbound_workflow_status_enum', [
  'EXPECTED',
  'ARRIVED',
  'MATCHED',
  'UNBOXED',
  'AWAITING_TEST',
  'IN_TEST',
  'PASSED',
  'FAILED',
  'RTV',
  'SCRAP',
  'DONE',
]);

// DAILY TASK LOGIC REMOVED

// NEW: Receiving tasks table
export const receivingTasks = pgTable('receiving_tasks', {
  id: serial('id').primaryKey(),
  trackingNumber: varchar('tracking_number', { length: 100 }).notNull(),
  orderNumber: varchar('order_number', { length: 100 }),
  status: varchar('status', { length: 20 }).default('pending'),
  receivedDate: timestamp('received_date'),
  processedDate: timestamp('processed_date'),
  notes: text('notes'),
  staffId: integer('staff_id').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
});

// Source of truth tables - generic columns for all
const genericColumns = {
  col1: serial('col_1').primaryKey(),
  col2: text('col_2'),
  col3: text('col_3'),
  col4: text('col_4'),
  col5: text('col_5'),
  col6: text('col_6'),
  col7: text('col_7'),
  col8: text('col_8'),
  col9: text('col_9'),
  col10: text('col_10'),
  col11: text('col_11'),
  col12: text('col_12'),
  col13: text('col_13'),
  col14: text('col_14'),
  col15: text('col_15'),
};

// Customer records used to pair imported orders by order_id, then link orders.customer_id -> customers.id
export const customers = pgTable('customers', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  orderId: text('order_id'),
  customerName: text('customer_name'),
  shippingAddress1: text('shipping_address_1'),
  shippingAddress2: text('shipping_address_2'),
  shippingCity: text('shipping_city'),
  shippingState: text('shipping_state'),
  shippingPostalCode: text('shipping_postal_code'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Orders table - Updated schema (serial tracking moved to tech_serial_numbers)
// Packing completion tracking moved to packer_logs table (packed_by, pack_date_time, packer_photos_url)
// Staff assignment (tester/packer) moved to work_assignments (entity_type='ORDER', entity_id=orders.id)
// BEFORE DELETE trigger trg_cancel_wa_on_order_delete auto-cancels related work_assignments
export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  orderId: text('order_id'),
  itemNumber: text('item_number'),
  productTitle: text('product_title'),
  sku: text('sku'),
  condition: text('condition'),
  /** FK to shipping_tracking_numbers — single source of truth for carrier tracking */
  shipmentId: bigint('shipment_id', { mode: 'number' }),
  outOfStock: text('out_of_stock'),
  notes: text('notes'),
  quantity: text('quantity').default('1'),
  customerId: integer('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  status: text('status'),
  statusHistory: jsonb('status_history').default([]),
  // is_shipped removed from schema — shipped state is derived from shipping_tracking_numbers
  accountSource: text('account_source'),
  orderDate: timestamp('order_date'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Packer logs - audit trail for all packer scans (orders, SKU, FNSKU, FBA, etc.)
// Photos are stored in the photos table (entity_type='PACKER_LOG', entity_id=packer_logs.id)
// shipment_id links ORDERS-type scans to shipping_tracking_numbers (carrier tracking)
// scan_ref stores non-carrier raw inputs (SKU, FNSKU, garbage scans)
export const packerLogs = pgTable('packer_logs', {
  id: serial('id').primaryKey(),
  /** FK to shipping_tracking_numbers for carrier-tracking ORDERS scans */
  shipmentId: bigint('shipment_id', { mode: 'number' }),
  /** Raw scan value for non-carrier scans (SKU codes, FNSKUs, garbage) */
  scanRef: text('scan_ref'),
  trackingType: varchar('tracking_type', { length: 20 }).notNull(),
  packDateTime: timestamp('pack_date_time'),
  packedBy: integer('packed_by').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
});

// Unified photos table — polymorphic: entity_type IN ('PACKER_LOG','RECEIVING')
// Cascade delete via DB triggers (trg_delete_photos_on_packer_log_delete / _receiving_delete)
export const photos = pgTable('photos', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  entityType: text('entity_type').notNull(),
  entityId: integer('entity_id').notNull(),
  url: text('url').notNull(),
  takenByStaffId: integer('taken_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  photoType: text('photo_type'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Receiving table - work_assignments linked via entity_type='RECEIVING', entity_id=receiving.id
// BEFORE DELETE trigger trg_cancel_wa_on_receiving_delete auto-cancels related work_assignments
export const receiving = pgTable('receiving', {
  id: serial('id').primaryKey(),
  dateTime: text('date_time'), // Legacy compatibility column
  receivingDateTime: timestamp('receiving_date_time').notNull(),
  receivingTrackingNumber: text('receiving_tracking_number'),
  carrier: text('carrier'),
  receivedAt: timestamp('received_at'),
  receivedBy: integer('received_by').references(() => staff.id, { onDelete: 'set null' }),
  unboxedAt: timestamp('unboxed_at'),
  unboxedBy: integer('unboxed_by').references(() => staff.id, { onDelete: 'set null' }),
  qaStatus: qaStatusEnum('qa_status').notNull().default('PENDING'),
  dispositionCode: dispositionEnum('disposition_code').notNull().default('HOLD'),
  conditionGrade: conditionGradeEnum('condition_grade').notNull().default('BRAND_NEW'),
  isReturn: boolean('is_return').notNull().default(false),
  returnPlatform: returnPlatformEnum('return_platform'),
  returnReason: text('return_reason'),
  needsTest: boolean('needs_test').notNull().default(false),
  assignedTechId: integer('assigned_tech_id').references(() => staff.id, { onDelete: 'set null' }),
  targetChannel: targetChannelEnum('target_channel'),
  zohoPurchaseReceiveId: text('zoho_purchase_receive_id'),
  zohoWarehouseId: text('zoho_warehouse_id'),
  quantity: text('quantity'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * receiving_lines — one row per expected inbound SKU/line item.
 *
 * Lifecycle model:
 *   EXPECTED   — Zoho PO sync created the row; receiving_id is NULL.
 *   ARRIVED    — Physical package scanned at dock (receiving row created, not yet linked).
 *   MATCHED    — receiving_id set; this line linked to its physical package.
 *   UNBOXED    — Item extracted from box; qty/condition captured.
 *   AWAITING_TEST → IN_TEST → PASSED | FAILED → RTV | SCRAP | DONE.
 *
 * The receiving table is the package/container event.
 * receiving_lines is the authoritative operational unit.
 * Every tech-facing action resolves to one or more receiving_lines rows.
 */
export const receivingLines = pgTable('receiving_lines', {
  id: serial('id').primaryKey(),
  /** NULL until a physical scan is matched (Zoho PO pre-staging rows start NULL) */
  receivingId: integer('receiving_id').references(() => receiving.id, { onDelete: 'cascade' }),

  // Zoho identifiers — at least one is required for Zoho-originated rows
  zohoItemId: text('zoho_item_id').notNull(),
  zohoLineItemId: text('zoho_line_item_id'),
  zohoPurchaseReceiveId: text('zoho_purchase_receive_id'),
  zohoPurchaseOrderId: text('zoho_purchaseorder_id'),

  // Item metadata
  itemName: text('item_name'),
  sku: text('sku'),

  // Quantities
  /** Legacy column; prefer quantity_received / quantity_expected */
  quantity: integer('quantity'),
  quantityReceived: integer('quantity_received').default(0),
  quantityExpected: integer('quantity_expected'),

  // Lifecycle state
  workflowStatus: inboundWorkflowStatusEnum('workflow_status').notNull().default('EXPECTED'),

  // QA / disposition
  qaStatus: qaStatusEnum('qa_status').notNull().default('PENDING'),
  dispositionCode: dispositionEnum('disposition_code').notNull().default('HOLD'),
  conditionGrade: conditionGradeEnum('condition_grade').notNull().default('BRAND_NEW'),
  dispositionAudit: jsonb('disposition_audit').notNull().default([]),

  // Line-level test assignment (separate from package-level receiving.needs_test)
  needsTest: boolean('needs_test').notNull().default(false),
  assignedTechId: integer('assigned_tech_id').references(() => staff.id, { onDelete: 'set null' }),

  // Final disposition label (PASS_TO_STOCK | PASS_TO_FBA | PASS_TO_ORDER_TEST | FAIL_DAMAGED | ...)
  dispositionFinal: text('disposition_final'),

  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * work_assignments — unified assignment queue for orders, receiving, repairs, FBA.
 *
 * Join integrity (entity_type + entity_id):
 *   PostgreSQL does not support polymorphic FKs, so integrity is enforced by:
 *   1. BEFORE DELETE triggers on orders and receiving that auto-CANCEL any
 *      active assignment whose entity_id matches the deleted row's id.
 *      (fn_cancel_work_assignments_on_entity_delete)
 *   2. Partial composite indexes for fast lateral joins:
 *        idx_wa_order_entity_active    — WHERE entity_type='ORDER'
 *        idx_wa_receiving_entity_active — WHERE entity_type='RECEIVING'
 *   3. ux_work_assignments_active_entity — unique constraint so only one
 *      ASSIGNED/IN_PROGRESS row exists per (entity_type, entity_id, work_type).
 */
export const workAssignments = pgTable('work_assignments', {
  id: serial('id').primaryKey(),
  entityType: workEntityTypeEnum('entity_type').notNull(),
  /** id of the referenced orders, receiving, repair_service, etc. row */
  entityId: integer('entity_id').notNull(),
  workType: workTypeEnum('work_type').notNull(),
  /** Tech assignee (TEST, QA, REPAIR, RECEIVE work types) */
  assignedTechId: integer('assigned_tech_id').references(() => staff.id, { onDelete: 'set null' }),
  /** Packer assignee (PACK work type) */
  assignedPackerId: integer('assigned_packer_id').references(() => staff.id, { onDelete: 'set null' }),
  /** Tech who actually completed the work, if different from the assignee. */
  completedByTechId: integer('completed_by_tech_id').references(() => staff.id, { onDelete: 'set null' }),
  status: assignmentStatusEnum('status').notNull().default('ASSIGNED'),
  priority: integer('priority').notNull().default(100),
  /** Operational deadline sourced from orders.ship_by_date during migration, then maintained here. */
  deadlineAt: timestamp('deadline_at', { withTimezone: true }),
  notes: text('notes'),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Shipped table - DEPRECATED: Now using orders table with is_shipped = true

// Sku Stock table
export const skuStock = pgTable('sku_stock', {
  id: serial('id').primaryKey(),
  stock: text('stock'),
  sku: text('sku'),
  productTitle: text('product_title'),
});
export const sku = pgTable('sku', {
  id: serial('id').primaryKey(),
  dateTime: timestamp('date_time'),
  staticSku: text('static_sku'),
  serialNumber: text('serial_number'),
  shippingTrackingNumber: text('shipping_tracking_number'),
  notes: text('notes'),
  location: text('location'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Repair Service table
export const repairService = pgTable('repair_service', {
  id: serial('id').primaryKey(),
  ticketNumber: text('ticket_number'),
  contactInfo: text('contact_info'), // "name, phone, email"
  productTitle: text('product_title'),
  price: text('price'),
  issue: text('issue'),
  serialNumber: text('serial_number'),
  notes: text('notes'),
  status: text('status').default('Pending Repair'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Packing data audit trail lives in packer_logs; photos in the unified photos table.

export const fbaFnskus = pgTable('fba_fnskus', {
  fnsku: text('fnsku').primaryKey(),
  productTitle: text('product_title'),
  asin: text('asin'),
  sku: text('sku'),
  isActive: boolean('is_active').notNull().default(true),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const fbaShipments = pgTable('fba_shipments', {
  id: serial('id').primaryKey(),
  shipmentRef: text('shipment_ref').notNull(),
  destinationFc: text('destination_fc'),
  dueDate: date('due_date'),
  status: text('status').notNull().default('PLANNED'),
  createdByStaffId: integer('created_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  assignedTechId: integer('assigned_tech_id').references(() => staff.id, { onDelete: 'set null' }),
  assignedPackerId: integer('assigned_packer_id').references(() => staff.id, { onDelete: 'set null' }),
  readyItemCount: integer('ready_item_count').notNull().default(0),
  packedItemCount: integer('packed_item_count').notNull().default(0),
  shippedItemCount: integer('shipped_item_count').notNull().default(0),
  shippedAt: timestamp('shipped_at', { withTimezone: true }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const fbaShipmentItems = pgTable('fba_shipment_items', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id').notNull().references(() => fbaShipments.id, { onDelete: 'cascade' }),
  fnsku: text('fnsku').notNull().references(() => fbaFnskus.fnsku, { onDelete: 'restrict' }),
  productTitle: text('product_title'),
  asin: text('asin'),
  sku: text('sku'),
  expectedQty: integer('expected_qty').notNull().default(0),
  actualQty: integer('actual_qty').notNull().default(0),
  status: text('status').notNull().default('PLANNED'),
  readyByStaffId: integer('ready_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  readyAt: timestamp('ready_at', { withTimezone: true }),
  verifiedByStaffId: integer('verified_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  labeledByStaffId: integer('labeled_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  labeledAt: timestamp('labeled_at', { withTimezone: true }),
  shippedByStaffId: integer('shipped_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  shippedAt: timestamp('shipped_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const fbaFnskuLogs = pgTable('fba_fnsku_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  fnsku: text('fnsku').notNull().references(() => fbaFnskus.fnsku, { onDelete: 'restrict' }),
  sourceStage: text('source_stage').notNull(),
  eventType: text('event_type').notNull(),
  staffId: integer('staff_id').references(() => staff.id, { onDelete: 'set null' }),
  techSerialNumberId: bigint('tech_serial_number_id', { mode: 'number' }),
  fbaShipmentId: integer('fba_shipment_id').references(() => fbaShipments.id, { onDelete: 'set null' }),
  fbaShipmentItemId: integer('fba_shipment_item_id').references(() => fbaShipmentItems.id, { onDelete: 'set null' }),
  quantity: integer('quantity').notNull().default(1),
  station: text('station'),
  notes: text('notes'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// NEW: Tech Serial Numbers table - Individual serial tracking with types
// shipment_id links carrier-tracking rows to shipping_tracking_numbers
// scan_ref stores non-carrier raw inputs (FNSKU X00..., etc.)
export const techSerialNumbers = pgTable('tech_serial_numbers', {
  id: serial('id').primaryKey(),
  /** FK to shipping_tracking_numbers for carrier-tracking rows */
  shipmentId: bigint('shipment_id', { mode: 'number' }),
  /** Raw scan value for non-carrier rows (FNSKU, etc.) */
  scanRef: text('scan_ref'),
  serialNumber: text('serial_number').notNull(),
  serialType: varchar('serial_type', { length: 20 }).notNull().default('SERIAL'),
  testDateTime: timestamp('test_date_time').defaultNow(),
  testedBy: integer('tested_by').references(() => staff.id, { onDelete: 'set null' }),
  fnsku: text('fnsku').references(() => fbaFnskus.fnsku, { onDelete: 'set null' }),
  notes: text('notes'),
  fnskuLogId: bigint('fnsku_log_id', { mode: 'number' }),
  fbaShipmentId: integer('fba_shipment_id').references(() => fbaShipments.id, { onDelete: 'set null' }),
  fbaShipmentItemId: integer('fba_shipment_item_id').references(() => fbaShipmentItems.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
});

// Orders exceptions table - unmatched tracking scans from tech/packer
export const ordersExceptions = pgTable('orders_exceptions', {
  id: serial('id').primaryKey(),
  shippingTrackingNumber: text('shipping_tracking_number').notNull(),
  sourceStation: varchar('source_station', { length: 20 }).notNull(),
  staffId: integer('staff_id').references(() => staff.id, { onDelete: 'set null' }),
  staffName: text('staff_name'),
  exceptionReason: varchar('exception_reason', { length: 50 }).notNull().default('not_found'),
  notes: text('notes'),
  status: varchar('status', { length: 20 }).notNull().default('open'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Type exports
export type EbayAccount = typeof ebayAccounts.$inferSelect;
export type NewEbayAccount = typeof ebayAccounts.$inferInsert;
export type Staff = typeof staff.$inferSelect;
export type NewStaff = typeof staff.$inferInsert;
export type ReceivingTask = typeof receivingTasks.$inferSelect;
export type NewReceivingTask = typeof receivingTasks.$inferInsert;
export type Receiving = typeof receiving.$inferSelect;
export type NewReceiving = typeof receiving.$inferInsert;
export type ReceivingLine = typeof receivingLines.$inferSelect;
export type NewReceivingLine = typeof receivingLines.$inferInsert;
export type InboundWorkflowStatus = typeof inboundWorkflowStatusEnum.enumValues[number];
export type WorkAssignment = typeof workAssignments.$inferSelect;
export type NewWorkAssignment = typeof workAssignments.$inferInsert;
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type PackerLog = typeof packerLogs.$inferSelect;
export type NewPackerLog = typeof packerLogs.$inferInsert;
export type Photo = typeof photos.$inferSelect;
export type NewPhoto = typeof photos.$inferInsert;
export type RepairService = typeof repairService.$inferSelect;
export type NewRepairService = typeof repairService.$inferInsert;
export type FbaFnsku = typeof fbaFnskus.$inferSelect;
export type NewFbaFnsku = typeof fbaFnskus.$inferInsert;
export type FbaShipment = typeof fbaShipments.$inferSelect;
export type NewFbaShipment = typeof fbaShipments.$inferInsert;
export type FbaShipmentItem = typeof fbaShipmentItems.$inferSelect;
export type NewFbaShipmentItem = typeof fbaShipmentItems.$inferInsert;
export type FbaFnskuLog = typeof fbaFnskuLogs.$inferSelect;
export type NewFbaFnskuLog = typeof fbaFnskuLogs.$inferInsert;
export type TechSerialNumber = typeof techSerialNumbers.$inferSelect;
export type NewTechSerialNumber = typeof techSerialNumbers.$inferInsert;
export type OrdersException = typeof ordersExceptions.$inferSelect;
export type NewOrdersException = typeof ordersExceptions.$inferInsert;
