import { pgTable, serial, text, varchar, boolean, timestamp, integer, date, primaryKey, jsonb } from 'drizzle-orm/pg-core';

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
  sourceTable: text('source_table'), // Maps to tech_1, tech_2, tech_3, packer_1, packer_2
  active: boolean('active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

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

// Orders table - Updated schema (serial tracking moved to tech_serial_numbers)
// Packing completion tracking moved to packer_logs table (packed_by, pack_date_time, packer_photos_url)
export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  shipByDate: timestamp('ship_by_date'),
  orderId: text('order_id'),
  itemNumber: text('item_number'),
  productTitle: text('product_title'),
  sku: text('sku'),
  condition: text('condition'),
  shippingTrackingNumber: text('shipping_tracking_number'),
  outOfStock: text('out_of_stock'),
  notes: text('notes'),
  quantity: text('quantity').default('1'),
  // Assignment tracking (who is assigned to pack) - FK to staff.id
  packerId: integer('packer_id').references(() => staff.id, { onDelete: 'set null' }),
  // Assignment tracking (who is assigned to test) - FK to staff.id
  testerId: integer('tester_id').references(() => staff.id, { onDelete: 'set null' }),
  status: text('status'),
  // Status tracking
  statusHistory: jsonb('status_history').default([]),
  isShipped: boolean('is_shipped').notNull().default(false),
  // eBay integration columns
  accountSource: text('account_source'),
  orderDate: timestamp('order_date'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Packer logs - audit trail for all packer scans (orders, SKU, FNSKU, FBA, etc.)
export const packerLogs = pgTable('packer_logs', {
  id: serial('id').primaryKey(),
  shippingTrackingNumber: text('shipping_tracking_number').notNull(),
  trackingType: varchar('tracking_type', { length: 20 }).notNull(),
  packDateTime: timestamp('pack_date_time'),
  packedBy: integer('packed_by').references(() => staff.id, { onDelete: 'set null' }),
  packerPhotosUrl: jsonb('packer_photos_url'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Receiving table - Updated schema based on user screenshot & sheet mapping
export const receiving = pgTable('receiving', {
  id: serial('id').primaryKey(),
  // Support both legacy and current column names
  dateTime: text('date_time'),
  receivingDateTime: text('receiving_date_time'), // Sheet A
  receivingTrackingNumber: text('receiving_tracking_number'), // Sheet B
  carrier: text('carrier'), // Sheet C
  quantity: text('quantity'),
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
  dateTime: text('date_time'),
  staticSku: text('static_sku'),
  serialNumber: text('serial_number'),
  shippingTrackingNumber: text('shipping_tracking_number'),
  productTitle: text('product_title'),
  notes: text('notes'),
  location: text('location'),
});

// Repair Service table - Updated schema with JSON date_time
export const repairService = pgTable('repair_service', {
  id: serial('id').primaryKey(),
  dateTime: text('date_time'), // JSON: {start: timestamp, repaired: timestamp, done: timestamp}
  ticketNumber: text('ticket_number'),
  productTitle: text('product_title'),
  issue: text('issue'),
  serialNumber: text('serial_number'),
  contactInfo: text('contact_info'), // CSV: "name, phone, email"
  price: text('price'),
  status: text('status').default('pending'),
  repairReasons: text('repair_reasons'),
  process: text('process'), // JSON: [{parts: string, person: string, date: timestamp}]
});

// Packing logs table removed - all packing data now stored in orders table
// (packed_by, pack_date_time, packer_photos_url, is_shipped, status)

// NEW: Tech Serial Numbers table - Individual serial tracking with types
export const techSerialNumbers = pgTable('tech_serial_numbers', {
  id: serial('id').primaryKey(),
  shippingTrackingNumber: text('shipping_tracking_number').notNull(),
  serialNumber: text('serial_number').notNull(),
  serialType: varchar('serial_type', { length: 20 }).notNull().default('SERIAL'),
  testDateTime: timestamp('test_date_time').defaultNow(),
  testedBy: integer('tested_by').references(() => staff.id, { onDelete: 'set null' }),
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
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type PackerLog = typeof packerLogs.$inferSelect;
export type NewPackerLog = typeof packerLogs.$inferInsert;
export type RepairService = typeof repairService.$inferSelect;
export type NewRepairService = typeof repairService.$inferInsert;
export type TechSerialNumber = typeof techSerialNumbers.$inferSelect;
export type NewTechSerialNumber = typeof techSerialNumbers.$inferInsert;
export type OrdersException = typeof ordersExceptions.$inferSelect;
export type NewOrdersException = typeof ordersExceptions.$inferInsert;
