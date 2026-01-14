import { pgTable, serial, text, varchar, boolean, timestamp, integer, date, primaryKey } from 'drizzle-orm/pg-core';

// Staff table
export const staff = pgTable('staff', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  role: varchar('role', { length: 50 }).notNull(),
  employeeId: varchar('employee_id', { length: 50 }).unique(),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

// Tags table
export const tags = pgTable('tags', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 50 }).notNull().unique(),
  color: varchar('color', { length: 20 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Task templates table
export const taskTemplates = pgTable('task_templates', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  role: varchar('role', { length: 50 }).notNull(),
  stationId: text('station_id'), // e.g., "Tech_1", "Tech_2", "Packer_1"
  orderNumber: varchar('order_number', { length: 100 }),
  trackingNumber: varchar('tracking_number', { length: 100 }),
  createdBy: integer('created_by').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
});

// Task tags relationship
export const taskTags = pgTable('task_tags', {
  taskTemplateId: integer('task_template_id').notNull().references(() => taskTemplates.id, { onDelete: 'cascade' }),
  tagId: integer('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.taskTemplateId, table.tagId] }),
}));

// Daily task instances
export const dailyTaskInstances = pgTable('daily_task_instances', {
  id: serial('id').primaryKey(),
  templateId: integer('template_id').references(() => taskTemplates.id, { onDelete: 'cascade' }),
  staffId: integer('staff_id').references(() => staff.id, { onDelete: 'cascade' }),
  taskDate: date('task_date').notNull(),
  status: varchar('status', { length: 20 }).default('pending'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  durationMinutes: integer('duration_minutes'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
});

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

export const orders = pgTable('orders', { ...genericColumns });
export const tech1 = pgTable('tech_1', { ...genericColumns });
export const tech2 = pgTable('tech_2', { ...genericColumns });
export const tech3 = pgTable('tech_3', { ...genericColumns });
export const tech4 = pgTable('tech_4', { ...genericColumns });
export const packer1 = pgTable('packer_1', { ...genericColumns });
export const packer2 = pgTable('packer_2', { ...genericColumns });
export const packer3 = pgTable('packer_3', { ...genericColumns });
export const receiving = pgTable('receiving', { ...genericColumns });
export const shipped = pgTable('shipped', { ...genericColumns });
export const skuStock = pgTable('sku_stock', { ...genericColumns });
export const sku = pgTable('sku', { ...genericColumns });
export const rs = pgTable('rs', { ...genericColumns });

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
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type TaskTemplate = typeof taskTemplates.$inferSelect;
export type NewTaskTemplate = typeof taskTemplates.$inferInsert;
export type DailyTaskInstance = typeof dailyTaskInstances.$inferSelect;
export type NewDailyTaskInstance = typeof dailyTaskInstances.$inferInsert;
export type ReceivingTask = typeof receivingTasks.$inferSelect;
export type NewReceivingTask = typeof receivingTasks.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type PackingLog = typeof packingLogs.$inferSelect;
export type NewPackingLog = typeof packingLogs.$inferInsert;