import { pgTable, serial, text, varchar, boolean, timestamp, integer, date, primaryKey, jsonb } from 'drizzle-orm/pg-core';

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
  urgent: boolean('urgent').default(false),
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

// Orders table - Updated schema based on user screenshot
export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  shipByDate: text('ship_by_date'),
  orderId: text('order_id'),
  productTitle: text('product_title'),
  sku: text('sku'),
  condition: text('condition'),
  shippingTrackingNumber: text('shipping_tracking_number'),
  daysLate: text('days_late'),
  outOfStock: text('out_of_stock'),
  notes: text('notes'),
  assignedTo: text('assigned_to'),
  status: text('status').notNull().default('unassigned'),
  urgent: text('urgent'),
  serialNumber: text('serial_number'),
  // Completion tracking (who completed the work) - FK to staff.id
  testedBy: integer('tested_by').references(() => staff.id, { onDelete: 'set null' }),
  testDateTime: text('test_date_time'),
  packedBy: integer('packed_by').references(() => staff.id, { onDelete: 'set null' }),
  packDateTime: text('pack_date_time'),
  // Assignment tracking (who is assigned) - FK to staff.id
  testerId: integer('tester_id').references(() => staff.id, { onDelete: 'set null' }),
  packerId: integer('packer_id').references(() => staff.id, { onDelete: 'set null' }),
  // Status tracking
  statusHistory: jsonb('status_history').default([]),
  isShipped: boolean('is_shipped').default(false),
});

// Receiving table - Updated schema based on user screenshot & sheet mapping
export const receiving = pgTable('receiving', {
  id: serial('id').primaryKey(),
  dateTime: text('date_time'), // Sheet A
  receivingTrackingNumber: text('receiving_tracking_number'), // Sheet B
  carrier: text('carrier'), // Sheet C
  quantity: text('quantity'), // Sheet D
});

// Shipped table - DEPRECATED: Now using orders table with is_shipped = true

// Sku Stock table
export const skuStock = pgTable('sku_stock', {
  id: serial('id').primaryKey(),
  stock: text('stock'),
  sku: text('sku'),
  size: text('size'),
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

// NEW: Packing logs for the packer dashboard
export const packingLogs = pgTable('packing_logs', {
  id: serial('id').primaryKey(),
  trackingNumber: varchar('tracking_number', { length: 100 }).notNull(),
  orderId: varchar('order_id', { length: 100 }),
  photos: text('photos'), // Store as JSON string or comma-separated URLs
  packerId: integer('packer_id').references(() => staff.id, { onDelete: 'set null' }),
  boxSize: varchar('box_size', { length: 50 }),
  packedAt: timestamp('packed_at').defaultNow(),
  notes: text('notes'),
  status: varchar('status', { length: 20 }).default('completed'),
});

// Type exports
export type Staff = typeof staff.$inferSelect;
export type NewStaff = typeof staff.$inferInsert;
export type ReceivingTask = typeof receivingTasks.$inferSelect;
export type NewReceivingTask = typeof receivingTasks.$inferInsert;
export type Receiving = typeof receiving.$inferSelect;
export type NewReceiving = typeof receiving.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type RepairService = typeof repairService.$inferSelect;
export type NewRepairService = typeof repairService.$inferInsert;
export type PackingLog = typeof packingLogs.$inferSelect;
export type NewPackingLog = typeof packingLogs.$inferInsert;