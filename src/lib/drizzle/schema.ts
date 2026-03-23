import { pgTable, serial, text, varchar, boolean, timestamp, integer, date, primaryKey, json, jsonb, pgEnum, bigserial, bigint, uuid, numeric, uniqueIndex, index } from 'drizzle-orm/pg-core';

// eBay Accounts table
export const ebayAccounts = pgTable('ebay_accounts', {
  id: serial('id').primaryKey(),
  accountName: varchar('account_name', { length: 50 }).notNull().unique(),
  ebayUserId: varchar('ebay_user_id', { length: 100 }),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }).notNull(),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }).notNull(),
  marketplaceId: varchar('marketplace_id', { length: 20 }).default('EBAY_US'),
  lastSyncDate: timestamp('last_sync_date', { withTimezone: true }),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// Staff table
export const staff = pgTable('staff', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  role: varchar('role', { length: 50 }).notNull(),
  employeeId: varchar('employee_id', { length: 50 }).unique(),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const staffWeeklySchedule = pgTable('staff_weekly_schedule', {
  staffId: integer('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  dayOfWeek: integer('day_of_week').notNull(),
  isScheduled: boolean('is_scheduled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.staffId, table.dayOfWeek] }),
}));

export const favoriteSkus = pgTable('favorite_skus', {
  id: serial('id').primaryKey(),
  ecwidProductId: varchar('ecwid_product_id', { length: 64 }),
  sku: varchar('sku', { length: 255 }).notNull(),
  skuNormalized: varchar('sku_normalized', { length: 255 }).notNull().unique(),
  label: text('label').notNull(),
  productTitle: text('product_title'),
  issueTemplate: text('issue_template'),
  defaultPrice: text('default_price'),
  notes: text('notes'),
  metadata: jsonb('metadata').notNull().default({}),
  createdByStaffId: integer('created_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  updatedByStaffId: integer('updated_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const favoriteSkuWorkspaces = pgTable('favorite_sku_workspaces', {
  favoriteId: integer('favorite_id').notNull().references(() => favoriteSkus.id, { onDelete: 'cascade' }),
  workspaceKey: varchar('workspace_key', { length: 32 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(100),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.favoriteId, table.workspaceKey] }),
}));

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

export const replenishmentStatusEnum = pgEnum('replenishment_status', [
  'detected',
  'pending_review',
  'planned_for_po',
  'po_created',
  'waiting_for_receipt',
  'fulfilled',
  'cancelled',
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
  receivedDate: timestamp('received_date', { withTimezone: true }),
  processedDate: timestamp('processed_date', { withTimezone: true }),
  notes: text('notes'),
  staffId: integer('staff_id').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
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

// Customer records used to pair imported orders by order_id, then link orders.customer_id -> customers.id.
// Preserves the existing integer PK while extending the table toward a Zoho-capable contact model.
export const customers = pgTable('customers', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  orderId: text('order_id'),
  zohoContactId: text('zoho_contact_id'),
  contactType: text('contact_type').default('customer'),
  displayName: text('display_name'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  customerName: text('customer_name'),
  email: text('email'),
  phone: text('phone'),
  mobile: text('mobile'),
  shippingAddress1: text('shipping_address_1'),
  shippingAddress2: text('shipping_address_2'),
  shippingCity: text('shipping_city'),
  shippingState: text('shipping_state'),
  shippingPostalCode: text('shipping_postal_code'),
  shippingCountry: text('shipping_country'),
  status: text('status').default('active'),
  billingAddress: jsonb('billing_address').default({}),
  shippingAddress: jsonb('shipping_address').default({}),
  currencyId: text('currency_id'),
  paymentTerms: integer('payment_terms'),
  customFields: jsonb('custom_fields').notNull().default({}),
  channelRefs: jsonb('channel_refs').notNull().default({}),
  internalNotes: text('internal_notes'),
  zohoLastModified: timestamp('zoho_last_modified', { withTimezone: true }),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const items = pgTable('items', {
  id: uuid('id').primaryKey().defaultRandom(),
  zohoItemId: text('zoho_item_id').notNull().unique(),
  zohoItemGroupId: text('zoho_item_group_id'),
  name: text('name').notNull(),
  sku: text('sku'),
  upc: text('upc'),
  ean: text('ean'),
  description: text('description'),
  itemType: text('item_type'),
  productType: text('product_type'),
  status: text('status').notNull(),
  rate: numeric('rate', { precision: 12, scale: 4 }),
  purchaseRate: numeric('purchase_rate', { precision: 12, scale: 4 }),
  unit: text('unit'),
  reorderLevel: integer('reorder_level'),
  initialStock: numeric('initial_stock', { precision: 12, scale: 4 }),
  taxId: text('tax_id'),
  taxName: text('tax_name'),
  taxPercentage: numeric('tax_percentage', { precision: 6, scale: 3 }),
  imageUrl: text('image_url'),
  quantityAvailable: numeric('quantity_available', { precision: 12, scale: 4 }),
  quantityOnHand: numeric('quantity_on_hand', { precision: 12, scale: 4 }),
  customFields: jsonb('custom_fields').notNull().default({}),
  internalNotes: text('internal_notes'),
  zohoLastModified: timestamp('zoho_last_modified', { withTimezone: true }),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  skuIdx: index('items_sku_idx').on(table.sku),
  upcIdx: index('items_upc_idx').on(table.upc),
  statusIdx: index('items_status_idx').on(table.status),
  zohoModifiedIdx: index('items_zoho_modified_idx').on(table.zohoLastModified),
}));

export const zohoLocations = pgTable('zoho_locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  zohoLocationId: text('zoho_location_id').notNull().unique(),
  name: text('name').notNull(),
  isPrimary: boolean('is_primary').default(false),
  address: jsonb('address').default({}),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
});

export const itemLocationStock = pgTable('item_location_stock', {
  id: uuid('id').primaryKey().defaultRandom(),
  itemId: uuid('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  locationId: uuid('location_id').notNull().references(() => zohoLocations.id, { onDelete: 'cascade' }),
  quantityAvailable: numeric('quantity_available', { precision: 12, scale: 4 }).notNull().default('0'),
  quantityOnHand: numeric('quantity_on_hand', { precision: 12, scale: 4 }).notNull().default('0'),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  itemLocationUnique: uniqueIndex('ux_item_location_stock_item_location').on(table.itemId, table.locationId),
}));

export const replenishmentRequests = pgTable('replenishment_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  itemId: uuid('item_id').notNull().references(() => items.id),
  zohoItemId: text('zoho_item_id').notNull(),
  sku: text('sku'),
  itemName: text('item_name').notNull(),
  quantityNeeded: numeric('quantity_needed', { precision: 12, scale: 2 }).notNull().default('0'),
  zohoQuantityAvailable: numeric('zoho_quantity_available', { precision: 12, scale: 2 }),
  zohoQuantityOnHand: numeric('zoho_quantity_on_hand', { precision: 12, scale: 2 }),
  zohoIncomingQuantity: numeric('zoho_incoming_quantity', { precision: 12, scale: 2 }).default('0'),
  quantityToOrder: numeric('quantity_to_order', { precision: 12, scale: 2 }),
  vendorZohoContactId: text('vendor_zoho_contact_id'),
  vendorName: text('vendor_name'),
  unitCost: numeric('unit_cost', { precision: 12, scale: 4 }),
  status: replenishmentStatusEnum('status').notNull().default('detected'),
  statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull().defaultNow(),
  zohoPoId: text('zoho_po_id'),
  zohoPoNumber: text('zoho_po_number'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  itemIdx: index('rr_item_id_idx').on(table.itemId),
  statusIdx: index('rr_status_idx').on(table.status),
  zohoItemIdx: index('rr_zoho_item_id_idx').on(table.zohoItemId),
  zohoPoIdx: index('rr_zoho_po_id_idx').on(table.zohoPoId),
  zohoPoUnique: uniqueIndex('rr_zoho_po_unique').on(table.zohoPoId),
}));

export const replenishmentOrderLines = pgTable('replenishment_order_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  replenishmentRequestId: uuid('replenishment_request_id').notNull().references(() => replenishmentRequests.id, { onDelete: 'cascade' }),
  orderId: integer('order_id').notNull().references(() => orders.id),
  orderLineId: text('order_line_id'),
  channelOrderId: text('channel_order_id'),
  quantityNeeded: numeric('quantity_needed', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  replIdx: index('rol_replenishment_idx').on(table.replenishmentRequestId),
  orderIdx: index('rol_order_idx').on(table.orderId),
  requestOrderUnique: uniqueIndex('rol_request_order_unique').on(table.replenishmentRequestId, table.orderId),
}));

export const itemStockCache = pgTable('item_stock_cache', {
  id: uuid('id').primaryKey().defaultRandom(),
  zohoItemId: text('zoho_item_id').notNull().unique(),
  itemId: uuid('item_id').references(() => items.id),
  quantityAvailable: numeric('quantity_available', { precision: 12, scale: 2 }).notNull().default('0'),
  quantityOnHand: numeric('quantity_on_hand', { precision: 12, scale: 2 }).notNull().default('0'),
  incomingQuantity: numeric('incoming_quantity', { precision: 12, scale: 2 }).notNull().default('0'),
  openPoIds: text('open_po_ids').array(),
  syncError: text('sync_error'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
}, (table) => ({
  itemIdx: index('isc_item_id_idx').on(table.itemId),
}));

export const replenishmentStatusLog = pgTable('replenishment_status_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  replenishmentRequestId: uuid('replenishment_request_id').notNull().references(() => replenishmentRequests.id, { onDelete: 'cascade' }),
  fromStatus: replenishmentStatusEnum('from_status'),
  toStatus: replenishmentStatusEnum('to_status').notNull(),
  changedBy: text('changed_by'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  requestIdx: index('rsl_request_idx').on(table.replenishmentRequestId),
}));

export const salesOrders = pgTable('sales_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  zohoSoId: text('zoho_so_id').unique(),
  salesorderNumber: text('salesorder_number'),
  referenceNumber: text('reference_number').notNull().unique(),
  channel: text('channel').notNull(),
  contactId: integer('contact_id').references(() => customers.id, { onDelete: 'set null' }),
  status: text('status').notNull(),
  returnStatus: text('return_status').default('none'),
  orderDate: date('order_date').notNull(),
  shipmentDate: date('shipment_date'),
  subTotal: numeric('sub_total', { precision: 12, scale: 2 }),
  taxTotal: numeric('tax_total', { precision: 12, scale: 2 }),
  total: numeric('total', { precision: 12, scale: 2 }),
  currencyCode: text('currency_code').default('USD'),
  shippingCharge: numeric('shipping_charge', { precision: 12, scale: 2 }),
  notes: text('notes'),
  lineItems: jsonb('line_items').notNull().default([]),
  billingAddress: jsonb('billing_address').default({}),
  shippingAddress: jsonb('shipping_address').default({}),
  zohoLastModified: timestamp('zoho_last_modified', { withTimezone: true }),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  internalNotes: text('internal_notes'),
  assignedTo: integer('assigned_to').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  referenceIdx: index('so_reference_idx').on(table.referenceNumber),
  channelIdx: index('so_channel_idx').on(table.channel),
  statusIdx: index('so_status_idx').on(table.status),
  orderDateIdx: index('so_order_date_idx').on(table.orderDate),
}));

export const packages = pgTable('packages', {
  id: uuid('id').primaryKey().defaultRandom(),
  zohoPackageId: text('zoho_package_id').unique(),
  salesOrderId: uuid('sales_order_id').notNull().references(() => salesOrders.id, { onDelete: 'cascade' }),
  packageNumber: text('package_number'),
  status: text('status'),
  date: date('date'),
  notes: text('notes'),
  lineItems: jsonb('line_items').notNull().default([]),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const shipmentOrders = pgTable('shipment_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  zohoShipmentId: text('zoho_shipment_id').unique(),
  packageId: uuid('package_id').notNull().references(() => packages.id, { onDelete: 'cascade' }),
  salesOrderId: uuid('sales_order_id').notNull().references(() => salesOrders.id, { onDelete: 'cascade' }),
  status: text('status'),
  date: date('date'),
  trackingNumber: text('tracking_number'),
  carrier: text('carrier'),
  shipstationOrderId: text('shipstation_order_id'),
  shipstationLabelUrl: text('shipstation_label_url'),
  shipmentId: bigint('shipment_id', { mode: 'number' }),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  zohoInvoiceId: text('zoho_invoice_id').unique(),
  salesOrderId: uuid('sales_order_id').references(() => salesOrders.id, { onDelete: 'set null' }),
  invoiceNumber: text('invoice_number'),
  status: text('status'),
  date: date('date'),
  dueDate: date('due_date'),
  total: numeric('total', { precision: 12, scale: 2 }),
  balance: numeric('balance', { precision: 12, scale: 2 }),
  customFields: jsonb('custom_fields').notNull().default({}),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const creditNotes = pgTable('credit_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  zohoCreditNoteId: text('zoho_credit_note_id').unique(),
  salesOrderId: uuid('sales_order_id').references(() => salesOrders.id, { onDelete: 'set null' }),
  invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
  creditNoteNumber: text('credit_note_number'),
  status: text('status'),
  date: date('date'),
  total: numeric('total', { precision: 12, scale: 2 }),
  balance: numeric('balance', { precision: 12, scale: 2 }),
  reason: text('reason'),
  lineItems: jsonb('line_items').notNull().default([]),
  customFields: jsonb('custom_fields').notNull().default({}),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const itemAdjustments = pgTable('item_adjustments', {
  id: uuid('id').primaryKey().defaultRandom(),
  zohoAdjustmentId: text('zoho_adjustment_id').unique(),
  reason: text('reason').notNull(),
  date: date('date').notNull(),
  referenceNumber: text('reference_number'),
  status: text('status').default('pending'),
  lineItems: jsonb('line_items').notNull().default([]),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const syncCursors = pgTable('sync_cursors', {
  resource: text('resource').primaryKey(),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  fullSyncAt: timestamp('full_sync_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const entityNotes = pgTable('entity_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  body: text('body').notNull(),
  authorId: integer('author_id').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  lookupIdx: index('entity_notes_lookup').on(table.entityType, table.entityId),
}));

// Orders table - Updated schema (serial tracking moved to tech_serial_numbers)
// Packing completion tracking moved to packer_logs table (packed_by); photos in photos table
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
  orderDate: timestamp('order_date', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
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
  packedBy: integer('packed_by').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// Station activity logs - cross-station visibility/query ledger.
// Fact tables still own specialized writes; this table records operator activity.
export const stationActivityLogs = pgTable('station_activity_logs', {
  id: serial('id').primaryKey(),
  station: varchar('station', { length: 20 }).notNull(),
  activityType: varchar('activity_type', { length: 30 }).notNull(),
  shipmentId: bigint('shipment_id', { mode: 'number' }),
  scanRef: text('scan_ref'),
  fnsku: text('fnsku').references(() => fbaFnskus.fnsku, { onDelete: 'set null' }),
  staffId: integer('staff_id').references(() => staff.id, { onDelete: 'set null' }),
  ordersExceptionId: integer('orders_exception_id').references(() => ordersExceptions.id, { onDelete: 'set null' }),
  fbaShipmentId: integer('fba_shipment_id').references(() => fbaShipments.id, { onDelete: 'set null' }),
  fbaShipmentItemId: integer('fba_shipment_item_id').references(() => fbaShipmentItems.id, { onDelete: 'set null' }),
  techSerialNumberId: integer('tech_serial_number_id'),
  packerLogId: integer('packer_log_id'),
  notes: text('notes'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
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
  receivingTrackingNumber: text('receiving_tracking_number'),
  carrier: text('carrier'),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  receivedBy: integer('received_by').references(() => staff.id, { onDelete: 'set null' }),
  unboxedAt: timestamp('unboxed_at', { withTimezone: true }),
  unboxedBy: integer('unboxed_by').references(() => staff.id, { onDelete: 'set null' }),
  qaStatus: qaStatusEnum('qa_status').notNull().default('PENDING'),
  dispositionCode: dispositionEnum('disposition_code').notNull().default('HOLD'),
  conditionGrade: conditionGradeEnum('condition_grade').notNull().default('BRAND_NEW'),
  isReturn: boolean('is_return').notNull().default(false),
  returnPlatform: returnPlatformEnum('return_platform'),
  returnReason: text('return_reason'),
  needsTest: boolean('needs_test').notNull().default(true),
  assignedTechId: integer('assigned_tech_id').references(() => staff.id, { onDelete: 'set null' }),
  targetChannel: targetChannelEnum('target_channel'),
  zohoPurchaseReceiveId: text('zoho_purchase_receive_id'),
  zohoWarehouseId: text('zoho_warehouse_id'),
  quantity: text('quantity'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const localPickupItems = pgTable('local_pickup_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  receivingId: integer('receiving_id').notNull().references(() => receiving.id, { onDelete: 'cascade' }).unique(),
  pickupDate: date('pickup_date').notNull(),
  productTitle: text('product_title'),
  sku: text('sku'),
  quantity: integer('quantity').notNull().default(1),
  partsStatus: text('parts_status').notNull().default('COMPLETE'),
  missingPartsNote: text('missing_parts_note'),
  receivingGrade: text('receiving_grade'),
  conditionNote: text('condition_note'),
  offerPrice: numeric('offer_price', { precision: 12, scale: 2 }),
  total: numeric('total', { precision: 12, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pickupDateIdx: index('local_pickup_items_pickup_date_idx').on(table.pickupDate),
  partsStatusIdx: index('local_pickup_items_parts_status_idx').on(table.partsStatus),
}));

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
  needsTest: boolean('needs_test').notNull().default(true),
  assignedTechId: integer('assigned_tech_id').references(() => staff.id, { onDelete: 'set null' }),

  // Final disposition label (PASS_TO_STOCK | PASS_TO_FBA | PASS_TO_ORDER_TEST | FAIL_DAMAGED | ...)
  dispositionFinal: text('disposition_final'),

  // Zoho sync metadata for incremental/integration-safe reconciliation
  zohoSyncSource: text('zoho_sync_source'),
  zohoLastModifiedTime: text('zoho_last_modified_time'),
  zohoSyncedAt: timestamp('zoho_synced_at', { withTimezone: true }),

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
  /** Packer who completed (shipped) this PACK assignment via the management UI. */
  completedByPackerId: integer('completed_by_packer_id').references(() => staff.id, { onDelete: 'set null' }),
  status: assignmentStatusEnum('status').notNull().default('ASSIGNED'),
  priority: integer('priority').notNull().default(100),
  /** Operational deadline sourced from orders.ship_by_date during migration, then maintained here. */
  deadlineAt: timestamp('deadline_at', { withTimezone: true }),
  outOfStock: text('out_of_stock'),
  repairOutcome: text('repair_outcome'),
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
  dateTime: timestamp('date_time', { withTimezone: true }),
  staticSku: text('static_sku'),
  serialNumber: text('serial_number'),
  shippingTrackingNumber: text('shipping_tracking_number'),
  notes: text('notes'),
  location: text('location'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
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
  statusHistory: jsonb('status_history').default([]),
  status: text('status').default('Pending Repair'),
  sourceSystem: text('source_system'),
  sourceOrderId: text('source_order_id'),
  sourceTrackingNumber: text('source_tracking_number'),
  sourceSku: text('source_sku'),
  intakeChannel: text('intake_channel'),
  incomingStatus: text('incoming_status'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  intakeConfirmedAt: timestamp('intake_confirmed_at', { withTimezone: true }),
  receivedByStaffId: integer('received_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
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
  /** FK to orders_exceptions for unmatched carrier scans */
  ordersExceptionId: integer('orders_exception_id').references(() => ordersExceptions.id, { onDelete: 'set null' }),
  /** Raw scan value for non-carrier rows (FNSKU, etc.) */
  scanRef: text('scan_ref'),
  serialNumber: text('serial_number').notNull(),
  serialType: varchar('serial_type', { length: 20 }).notNull().default('SERIAL'),
  testedBy: integer('tested_by').references(() => staff.id, { onDelete: 'set null' }),
  fnsku: text('fnsku').references(() => fbaFnskus.fnsku, { onDelete: 'set null' }),
  notes: text('notes'),
  fnskuLogId: bigint('fnsku_log_id', { mode: 'number' }),
  fbaShipmentId: integer('fba_shipment_id').references(() => fbaShipments.id, { onDelete: 'set null' }),
  fbaShipmentItemId: integer('fba_shipment_item_id').references(() => fbaShipmentItems.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
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
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
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
export type LocalPickupItem = typeof localPickupItems.$inferSelect;
export type NewLocalPickupItem = typeof localPickupItems.$inferInsert;
export type ReceivingLine = typeof receivingLines.$inferSelect;
export type NewReceivingLine = typeof receivingLines.$inferInsert;
export type InboundWorkflowStatus = typeof inboundWorkflowStatusEnum.enumValues[number];
export type WorkAssignment = typeof workAssignments.$inferSelect;
export type NewWorkAssignment = typeof workAssignments.$inferInsert;
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type ZohoLocation = typeof zohoLocations.$inferSelect;
export type NewZohoLocation = typeof zohoLocations.$inferInsert;
export type ItemLocationStock = typeof itemLocationStock.$inferSelect;
export type NewItemLocationStock = typeof itemLocationStock.$inferInsert;
export type SalesOrder = typeof salesOrders.$inferSelect;
export type NewSalesOrder = typeof salesOrders.$inferInsert;
export type Package = typeof packages.$inferSelect;
export type NewPackage = typeof packages.$inferInsert;
export type ShipmentOrder = typeof shipmentOrders.$inferSelect;
export type NewShipmentOrder = typeof shipmentOrders.$inferInsert;
export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type CreditNote = typeof creditNotes.$inferSelect;
export type NewCreditNote = typeof creditNotes.$inferInsert;
export type ItemAdjustment = typeof itemAdjustments.$inferSelect;
export type NewItemAdjustment = typeof itemAdjustments.$inferInsert;
export type SyncCursor = typeof syncCursors.$inferSelect;
export type NewSyncCursor = typeof syncCursors.$inferInsert;
export type EntityNote = typeof entityNotes.$inferSelect;
export type NewEntityNote = typeof entityNotes.$inferInsert;
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
