import { pgTable, serial, text, varchar, boolean, timestamp, integer, smallint, date, primaryKey, jsonb, pgEnum, bigserial, bigint, uuid, numeric, uniqueIndex, index, customType } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─── Multi-tenancy Helper ─────────────
export function orgIdCol() {
  return uuid('organization_id')
    .notNull()
    .default(sql`NULLIF(current_setting('app.current_org', true), '')::uuid`);
}

// eBay Accounts table
export const ebayAccounts = pgTable('ebay_accounts', {
  id: serial('id').primaryKey(),
  organizationId: orgIdCol(),
  // account_name is unique PER ORG (see ux_ebay_accounts_org_account below),
  // not globally — two tenants may both label an account 'ebay-main'.
  accountName: varchar('account_name', { length: 50 }).notNull(),
  ebayUserId: varchar('ebay_user_id', { length: 100 }),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }).notNull(),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }).notNull(),
  marketplaceId: varchar('marketplace_id', { length: 20 }).default('EBAY_US'),
  // Added by 2026-03-09_ebay_accounts_add_platform_zoho.sql (EBAY | ZOHO).
  platform: varchar('platform', { length: 20 }),
  lastSyncDate: timestamp('last_sync_date', { withTimezone: true }),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  orgEbayUserIdx: uniqueIndex('ux_ebay_accounts_org_ebay_user').on(table.organizationId, table.ebayUserId),
  orgAccountIdx: uniqueIndex('ux_ebay_accounts_org_account').on(table.organizationId, table.accountName),
  orgIdx: index('idx_ebay_accounts_organization').on(table.organizationId),
}));

// ─── Platform / Account / Type catalog ──────────────────────────────────────
// Org-scoped, CRUD-able replacement for the hardcoded SOURCE_PLATFORMS /
// RECEIVING_TYPE_OPTS lists. See docs/platform-account-type-catalog-plan.md and
// migrations 2026-06-13g (tables), 2026-06-14b (RLS), 2026-06-14f (type_id FK +
// account seed). The raw query layer lives in src/lib/neon/catalog-queries.ts;
// these definitions exist so the rest of the app can join type-safely.

/** CHANNEL — was SOURCE_PLATFORMS in src/lib/source-platform.ts. */
export const platforms = pgTable('platforms', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organizationId: orgIdCol(),
  slug: text('slug').notNull(),
  label: text('label').notNull(),
  /** Pill color token (was hardcoded in source-platform.ts). */
  tone: text('tone'),
  /** Soft-link → organization_integrations.provider (null = display-only). */
  provider: text('provider'),
  sortOrder: integer('sort_order').notNull().default(100),
  isActive: boolean('is_active').notNull().default(true),
  /** Seeded built-in (hide-only, slug immutable) vs the org's own custom row. */
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgSlugUx: uniqueIndex('uq_platforms_org_slug').on(table.organizationId, table.slug),
  orgIdx: index('idx_platforms_org').on(table.organizationId),
}));

/** STOREFRONT under a channel — generalizes ebay_accounts. */
export const platformAccounts = pgTable('platform_accounts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organizationId: orgIdCol(),
  platformId: bigint('platform_id', { mode: 'number' })
    .notNull()
    .references(() => platforms.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  label: text('label').notNull(),
  /** → organization_integrations.scope (the specific connection). */
  integrationScope: text('integration_scope'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgPlatformSlugUx: uniqueIndex('uq_platform_accounts_org_platform_slug').on(
    table.organizationId, table.platformId, table.slug,
  ),
  orgPlatformIdx: index('idx_platform_accounts_org_platform').on(table.organizationId, table.platformId),
}));

/** Per-org FLOW — was RECEIVING_TYPE_OPTS; the customizable one. */
export const types = pgTable('types', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organizationId: orgIdCol(),
  slug: text('slug').notNull(),
  label: text('label').notNull(),
  /** 'receiving' | 'shipping' | 'both'. */
  kind: text('kind').notNull().default('receiving'),
  /** Optional channel binding for fixed platform×flow combos (returns, etc.). */
  platformAccountId: bigint('platform_account_id', { mode: 'number' })
    .references(() => platformAccounts.id, { onDelete: 'set null' }),
  /** Optional: drives a custom node-graph flow (workflow_nodes.id). */
  workflowNodeId: text('workflow_node_id'),
  isReturn: boolean('is_return').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(100),
  isActive: boolean('is_active').notNull().default(true),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgSlugUx: uniqueIndex('uq_types_org_slug').on(table.organizationId, table.slug),
  orgIdx: index('idx_types_org').on(table.organizationId),
}));

// Amazon SP-API accounts (mirror of ebay_accounts; see 2026-06-14b_amazon_integration.sql)
// Per-account metadata + sync state. The per-seller LWA refresh token lives
// encrypted in organization_integrations (provider='amazon', scope='seller-{id}').
export const amazonAccounts = pgTable('amazon_accounts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organizationId: orgIdCol(),
  accountName: varchar('account_name', { length: 80 }).notNull(),
  sellerId: varchar('seller_id', { length: 64 }),
  region: text('region').notNull().default('NA'), // 'NA' | 'EU' | 'FE'
  marketplaceIds: jsonb('marketplace_ids').notNull().default(sql`'[]'::jsonb`),
  accessToken: text('access_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  lastUpdatedWatermark: timestamp('last_updated_watermark', { withTimezone: true }),
  syncStartedAt: timestamp('sync_started_at', { withTimezone: true }),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  status: text('status').notNull().default('active'), // active | error | revoked
  lastError: text('last_error'),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgNameIdx: uniqueIndex('ux_amazon_accounts_org_name').on(table.organizationId, table.accountName),
  orgIdx: index('idx_amazon_accounts_org').on(table.organizationId),
}));

// Per-call SP-API audit (mirror of ebay_api_calls)
export const amazonApiCalls = pgTable('amazon_api_calls', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organizationId: orgIdCol(),
  accountId: bigint('account_id', { mode: 'number' }),
  operation: text('operation').notNull(),
  method: text('method'),
  path: text('path'),
  statusCode: integer('status_code'),
  ok: boolean('ok'),
  rateLimit: text('rate_limit'),
  durationMs: integer('duration_ms'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AmazonAccountRow = typeof amazonAccounts.$inferSelect;
export type NewAmazonAccountRow = typeof amazonAccounts.$inferInsert;

// Staff table
//
// Columns added across two migrations:
//   2026-05-14_sso_foundation.sql  → ssoSubject, ssoProvider, lastLoginAt
//   2026-05-17_auth_system.sql     → pinHash, pinSetAt, pinFailedCount,
//                                    pinLockedUntil, employeeCode, status
//   2026-05-18_staff_permission_overrides.sql → permissionsAdded, permissionsRemoved
export const staff = pgTable('staff', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  role: varchar('role', { length: 50 }).notNull(),
  employeeId: varchar('employee_id', { length: 50 }).unique(),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  ssoSubject: text('sso_subject'),
  ssoProvider: text('sso_provider'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  // Phase F1: persisted at signup; the key for future owner email login + reset.
  email: text('email'),
  pinHash: text('pin_hash'),
  pinSetAt: timestamp('pin_set_at', { withTimezone: true }),
  pinFailedCount: integer('pin_failed_count').notNull().default(0),
  pinLockedUntil: timestamp('pin_locked_until', { withTimezone: true }),
  employeeCode: text('employee_code'),
  status: text('status').notNull().default('active'),
  permissionsAdded: text('permissions_added').array().notNull().default([]),
  permissionsRemoved: text('permissions_removed').array().notNull().default([]),
  sortOrder: integer('sort_order').notNull().default(0),
  colorHex: varchar('color_hex', { length: 7 }).notNull().default('#10b981'),
  defaultHomePath: text('default_home_path'),
  defaultHomePathMobile: text('default_home_path_mobile'),
  // Per-staff mobile UI override. JSON shape lives in
  // src/lib/auth/mobile-display-config.ts (MobileDisplayConfig). Layers on
  // top of roles.mobile_defaults; null means "fully inherit from role".
  mobileDisplayConfig: jsonb('mobile_display_config'),
  // Tenant attachment (2026-05-22_organizations_tenancy.sql). NOT NULL after
  // backfill; USAV staff carry the well-known USAV org id.
  organizationId: uuid('organization_id').notNull(),
  // Identity layer (2026-06-20e_identity_layer_phase1.sql). `staff` is now the
  // per-org operational PROFILE; the global human is `accounts`, and membership
  // in this org is `memberships`. Nullable until backfill completes.
  accountId: uuid('account_id').references(() => accounts.id),
  membershipId: uuid('membership_id').references(() => memberships.id),
});

// Editable roles taxonomy. is_system rows are seeded built-ins and cannot
// be deleted from the admin UI. See 2026-05-19_editable_roles.sql.
export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  label: text('label').notNull(),
  color: varchar('color', { length: 7 }).notNull().default('#6b7280'),
  position: integer('position').notNull().default(100),
  permissions: text('permissions').array().notNull().default([]),
  isSystem: boolean('is_system').notNull().default(false),
  // Per-role mobile UI defaults (MobileDisplayConfig). Inherited by every
  // staff in the role unless they have their own per-row override.
  mobileDefaults: jsonb('mobile_defaults'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  positionIdx: index('idx_roles_position').on(table.position),
}));

// Many-to-many: a staff can hold several roles.
export const staffRolesTable = pgTable('staff_roles', {
  staffId: integer('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  grantedBy: integer('granted_by').references(() => staff.id, { onDelete: 'set null' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.staffId, table.roleId] }),
  roleIdx: index('idx_staff_roles_role').on(table.roleId),
}));

// Per-staff station assignments (primary + secondary). Governs which stations
// the header goal chip shows/switches between. See 2026-06-02_staff_stations.sql.
export const staffStations = pgTable('staff_stations', {
  staffId: integer('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  station: varchar('station', { length: 20 }).notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  assignedBy: integer('assigned_by').references(() => staff.id, { onDelete: 'set null' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.staffId, table.station] }),
  staffIdx: index('idx_staff_stations_staff').on(table.staffId),
}));

export const staffPasskeys = pgTable('staff_passkeys', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  staffId: integer('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  credentialId: text('credential_id').notNull().unique(),
  publicKey: text('public_key').notNull(),
  counter: bigint('counter', { mode: 'number' }).notNull().default(0),
  transports: text('transports').array(),
  aaguid: uuid('aaguid'),
  deviceLabel: text('device_label'),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  staffIdx: index('idx_staff_passkeys_staff').on(table.staffId),
}));

export const staffSessions = pgTable('staff_sessions', {
  sid: text('sid').primaryKey(),
  staffId: integer('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  // Active tenant for this session. Always equals the staff's org today;
  // separating the column lets us add org-switching later without a
  // schema change.
  organizationId: uuid('organization_id').notNull(),
  deviceKind: text('device_kind').notNull(),
  deviceLabel: text('device_label'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const staffEnrollments = pgTable('staff_enrollments', {
  token: text('token').primaryKey(),
  staffId: integer('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  createdBy: integer('created_by').references(() => staff.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const staffStepups = pgTable('staff_stepups', {
  sid: text('sid').notNull().references(() => staffSessions.sid, { onDelete: 'cascade' }),
  scope: text('scope').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  method: text('method').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.sid, table.scope] }),
}));

export const authAudit = pgTable('auth_audit', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  staffId: integer('staff_id').references(() => staff.id, { onDelete: 'set null' }),
  event: text('event').notNull(),
  result: text('result').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  sid: text('sid'),
  detail: jsonb('detail').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  staffTimeIdx: index('idx_auth_audit_staff_time').on(table.staffId, table.createdAt),
  eventTimeIdx: index('idx_auth_audit_event_time').on(table.event, table.createdAt),
}));

export const staffWeeklySchedule = pgTable('staff_weekly_schedule', {
  staffId: integer('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  dayOfWeek: integer('day_of_week').notNull(),
  isScheduled: boolean('is_scheduled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.staffId, table.dayOfWeek] }),
}));

export const staffScheduleOverrides = pgTable('staff_schedule_overrides', {
  staffId: integer('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  scheduleDate: date('schedule_date').notNull(),
  isScheduled: boolean('is_scheduled').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.staffId, table.scheduleDate] }),
}));

export const staffWeekPlans = pgTable('staff_week_plans', {
  staffId: integer('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  weekStartDate: date('week_start_date').notNull(),
  dayOfWeek: integer('day_of_week').notNull(),
  isScheduled: boolean('is_scheduled').notNull(),
  source: text('source').notNull().default('manual'),
  createdByStaffId: integer('created_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.staffId, table.weekStartDate, table.dayOfWeek] }),
}));

export const staffAvailabilityRules = pgTable('staff_availability_rules', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  staffId: integer('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  ruleType: text('rule_type').notNull(),
  dayOfWeek: integer('day_of_week'),
  isAllowed: boolean('is_allowed').notNull().default(true),
  effectiveStartDate: date('effective_start_date'),
  effectiveEndDate: date('effective_end_date'),
  priority: integer('priority').notNull().default(100),
  reason: text('reason'),
  createdByStaffId: integer('created_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  staffPriorityIdx: index('staff_availability_rules_staff_active_idx').on(table.staffId, table.deletedAt, table.priority),
  weekdayIdx: index('staff_availability_rules_weekday_idx').on(table.staffId, table.dayOfWeek),
  dateWindowIdx: index('staff_availability_rules_date_window_idx').on(table.effectiveStartDate, table.effectiveEndDate),
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

export const repairIssueTemplates = pgTable('repair_issue_templates', {
  id: serial('id').primaryKey(),
  favoriteSkuId: integer('favorite_sku_id').references(() => favoriteSkus.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  category: text('category'),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const adminFeatureTypeEnum = pgEnum('admin_feature_type_enum', [
  'feature',
  'bug_fix',
]);

export const adminFeatureStatusEnum = pgEnum('admin_feature_status_enum', [
  'backlog',
  'in_progress',
  'done',
]);

export const adminFeaturePriorityEnum = pgEnum('admin_feature_priority_enum', [
  'low',
  'medium',
  'high',
]);

export const adminFeatures = pgTable('admin_features', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  type: adminFeatureTypeEnum('type').notNull().default('feature'),
  status: adminFeatureStatusEnum('status').notNull().default('backlog'),
  priority: adminFeaturePriorityEnum('priority').notNull().default('medium'),
  pageArea: varchar('page_area', { length: 100 }),
  sortOrder: integer('sort_order').notNull().default(100),
  isActive: boolean('is_active').notNull().default(true),
  assignedToStaffId: integer('assigned_to_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  createdByStaffId: integer('created_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  updatedByStaffId: integer('updated_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  typeIdx: index('admin_features_type_idx').on(table.type),
  statusOrderIdx: index('admin_features_status_order_idx').on(table.status, table.isActive, table.sortOrder),
  updatedAtIdx: index('admin_features_updated_at_idx').on(table.updatedAt),
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
  'LIKE_NEW',
  'REFURBISHED',
  'USED_A',
  'USED_B',
  'USED_C',
  'PARTS',
]);

/**
 * serial_status_enum — per-unit lifecycle states (see serial_units.current_status).
 * Values 1-9 are the original 2026-04-10 set; values 10-19 are the Phase 0
 * expansion added by 2026-05-17_inventory_v2_phase0.sql for the full refurb +
 * allocation state machine described in context/inventory_system_upgrade_plan.md.
 */
export const serialStatusEnum = pgEnum('serial_status_enum', [
  // Original (2026-04-10)
  'UNKNOWN',
  'RECEIVED',
  'TESTED',
  'STOCKED',
  'PICKED',
  'SHIPPED',
  'RETURNED',
  'RMA',
  'SCRAPPED',
  // Phase 0 expansion (2026-05-17) — refurb pipeline
  'TRIAGED',
  'IN_REPAIR',
  'REPAIR_DONE',
  'IN_TEST',
  'GRADED',
  // Phase 0 expansion — allocation/outbound pipeline
  'ALLOCATED',
  'PACKED',
  'LABELED',
  'STAGED',
  'ON_HOLD',
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
  organizationId: orgIdCol(),
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
  organizationId: orgIdCol(),
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
  entityType: text('entity_type'),
  entityId: integer('entity_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const items = pgTable('items', {
  organizationId: orgIdCol(),
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
  imageDocumentId: text('image_document_id'),
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
  organizationId: orgIdCol(),
  id: uuid('id').primaryKey().defaultRandom(),
  zohoLocationId: text('zoho_location_id').notNull().unique(),
  name: text('name').notNull(),
  isPrimary: boolean('is_primary').default(false),
  address: jsonb('address').default({}),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
});

export const itemLocationStock = pgTable('item_location_stock', {
  organizationId: orgIdCol(),
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
  organizationId: orgIdCol(),
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

// shipment_orders — DROPPED 2026-06-28 (dead, 0 rows; pre-STN Zoho-shipment table
// with duplicated tracking/carrier). Superseded by shipment_links + the STN master.
// See migration 2026-06-28q_drop_legacy_shipment_link_tables.sql.

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

// Idempotency + audit ledger for the shipped-order → Zoho fulfillment sync.
// See src/lib/migrations/2026-06-02_zoho_fulfillment_sync.sql and
// src/lib/zoho/fulfillment-sync.ts. One row per internal order keyed by
// reference_number (= orders.order_id). Records every Zoho artifact created so
// the push sync stays idempotent and leaves a durable audit trail.
export const zohoFulfillmentSync = pgTable('zoho_fulfillment_sync', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organizationId: uuid('organization_id'),
  referenceNumber: text('reference_number').notNull().unique(),
  channel: text('channel'),
  zohoSalesorderId: text('zoho_salesorder_id'),
  zohoPackageId: text('zoho_package_id'),
  zohoShipmentId: text('zoho_shipment_id'),
  zohoInvoiceId: text('zoho_invoice_id'),
  invoiceStatus: text('invoice_status'),
  stage: text('stage').notNull().default('pending'),
  status: text('status').notNull().default('pending'),
  delivered: boolean('delivered').notNull().default(false),
  carrier: text('carrier'),
  trackingNumber: text('tracking_number'),
  sourceHash: text('source_hash'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  dryRun: boolean('dry_run').notNull().default(false),
  raw: jsonb('raw').notNull().default({}),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  statusIdx: index('zfs_status_idx').on(table.status),
  updatedAtIdx: index('zfs_updated_at_idx').on(table.updatedAt),
  salesOrderIdx: index('zfs_salesorder_idx').on(table.zohoSalesorderId),
}));

export const syncCursors = pgTable('sync_cursors', {
  organizationId: orgIdCol(),
  resource: text('resource').primaryKey(),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  fullSyncAt: timestamp('full_sync_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const entityNotes = pgTable('entity_notes', {
  organizationId: orgIdCol(),
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
  organizationId: orgIdCol(),
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
  /** Realized sale price of this order line — what it sold for on its platform.
   *  Per-transaction fact (varies by platform/time), filled at ingestion. */
  saleAmount: numeric('sale_amount', { precision: 12, scale: 2 }),
  currency: text('currency').default('USD'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  /** FK to sku_catalog — central product hub */
  skuCatalogId: integer('sku_catalog_id'),
  /** Amazon fulfillment channel: 'AFN' (FBA, read-only) | 'MFN' (we ship). Null for non-Amazon. */
  fulfillmentChannel: text('fulfillment_channel'),
  /**
   * Catalog flow type (org `types` row). Additive FK from the platform/type
   * catalog (2026-06-14f); the order's channel still derives from
   * `account_source` (denormalized cache) — type_id is the normalized link
   * that reaches account → platform → integration.
   */
  typeId: bigint('type_id', { mode: 'number' }),
});

// order_shipment_links — DROPPED 2026-06-28. Subsumed by shipment_links
// (owner_type='ORDER', OUTBOUND). orders.shipment_id stays as the primary cache.
// See migration 2026-06-28q_drop_legacy_shipment_link_tables.sql.

// Packer logs - audit trail for all packer scans (orders, SKU, FNSKU, FBA, etc.)
// Photos are stored in the photos table (entity_type='PACKER_LOG', entity_id=packer_logs.id)
// shipment_id links ORDERS-type scans to shipping_tracking_numbers (carrier tracking)
// scan_ref stores non-carrier raw inputs (SKU, FNSKU, garbage scans)
export const packerLogs = pgTable('packer_logs', {
  organizationId: orgIdCol(),
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
  // Tenant scope. The DB column was added NOT NULL (FK→organizations, indexed,
  // RLS-armed) by 2026-05-23_org_id_on_business_tables.sql; this reflects it so
  // typed queries can select/filter it. Default = the tenant GUC set by
  // withTenantConnection.
  organizationId: orgIdCol(),
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
  // receiving_tracking_number dropped — tracking lives in shipping_tracking_numbers
  // (via shipmentId). See migration 2026-06-28_drop_receiving_tracking_number.sql.
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
  /** Shared unbox/test urgency flag — pending-order match or manual toggle. Drives rank-0 in the Prioritize sort. */
  isPriority: boolean('is_priority').notNull().default(false),
  assignedTechId: integer('assigned_tech_id').references(() => staff.id, { onDelete: 'set null' }),
  targetChannel: targetChannelEnum('target_channel'),
  zohoPurchaseReceiveId: text('zoho_purchase_receive_id'),
  zohoWarehouseId: text('zoho_warehouse_id'),
  quantity: text('quantity'),
  /** Carton-level support / ops notes (not per receiving_lines row). */
  supportNotes: text('support_notes'),
  /** Zoho PO header notes (overall, carton-level) — the "Zoho Notes" tab's primary
   *  content; distinct from receiving_lines.zoho_notes (per-line item desc). 2026-06-25. */
  zohoNotes: text('zoho_notes'),
  /** Filed Zendesk ticket # for a package-level claim, stored as "#<id>". */
  zendeskTicket: text('zendesk_ticket'),
  // expected_box_count dropped 2026-06-28o — never wired (inert stub, 0 rows);
  // multi-box PO rollup never consumed it. See migration
  // 2026-06-28o_drop_receiving_expected_box_count.sql.
  /**
   * Catalog flow type (org `types` row). Additive FK from the platform/type
   * catalog (2026-06-14f); the carton's effective type still comes from
   * `intake_type` (denormalized cache) — type_id is the normalized link.
   */
  typeId: bigint('type_id', { mode: 'number' }),
  // ── Drift reconciliation (2026-06-19): columns added via raw-SQL migrations
  //    that were missing from this Drizzle model. Types/defaults mirror the DB.
  organizationId: orgIdCol(),
  /** FK → shipping_tracking_numbers.id (managed outside this file; plain bigint). 2026-04-15 / 2026-06-08. */
  shipmentId: bigint('shipment_id', { mode: 'number' }),
  /** zoho_po | unmatched | local_pickup | sourcing_import (CHECK-constrained TEXT). 2026-04-14. */
  source: text('source'),
  /** ebay|amazon|fba|aliexpress|walmart|goodwill|ecwid|square|other (CHECK-constrained TEXT). 2026-04-14. */
  sourcePlatform: text('source_platform'),
  /** Carton-default intake type (denormalized cache; normalized link is type_id). 2026-06-13b. */
  intakeType: text('intake_type'),
  /** NO_PO|CARRIER_MISMATCH|SHORT|OVER|DAMAGED|WRONG_ITEM. 2026-06-08. */
  exceptionCode: text('exception_code'),
  /** Manual priority override 0..3 (NULL = Auto). 2026-06-09. */
  priorityTier: smallint('priority_tier'),
  zohoPurchaseOrderId: text('zoho_purchaseorder_id'),
  zohoPurchaseOrderNumber: text('zoho_purchaseorder_number'),
  listingUrl: text('listing_url'),
  /** License plate — stable carton identity (unified inbound model Phase 3). 2026-06-08. */
  lpn: text('lpn'),
  /** Legacy denormalized intake timestamp. 2026-03-05. */
  receivingDateTime: timestamp('receiving_date_time', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// receiving_shipments — DROPPED 2026-06-28. Subsumed by shipment_links
// (owner_type='RECEIVING', INBOUND); received_at/received_by map to
// linked_at/linked_by. See 2026-06-28q_drop_legacy_shipment_link_tables.sql.

/**
 * shipment_links — UNIFIED polymorphic owner↔tracking linkage (inbound + outbound).
 *
 * One row per (owner, shipment), supporting many-trackings-per-owner for BOTH
 * flows. Subsumes receiving_shipments (owner_type='RECEIVING', INBOUND) +
 * order_shipment_links (owner_type='ORDER', OUTBOUND) against the single STN
 * master. The is_primary row mirrors the denormalized receiving.shipment_id /
 * orders.shipment_id caches (which stay). owner_id has NO FK (polymorphic, like
 * photos/work_assignments); shipment_id FKs STN ON DELETE CASCADE. Migration
 * 2026-06-24_shipment_links.sql (RLS armed, not forced until Phase 4 writers).
 */
export const shipmentLinks = pgTable('shipment_links', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organizationId: orgIdCol(),
  ownerType: text('owner_type').notNull(), // 'RECEIVING' | 'ORDER'
  ownerId: integer('owner_id').notNull(),
  shipmentId: bigint('shipment_id', { mode: 'number' }).notNull(),
  boxSeq: integer('box_seq').notNull().default(1),
  isPrimary: boolean('is_primary').notNull().default(false),
  direction: text('direction').notNull(), // 'INBOUND' | 'OUTBOUND'
  role: text('role'), // PO_ANCHOR | EXTRA_BOX | ORDER_PRIMARY | ORDER_SPLIT
  source: text('source'),
  linkedBy: integer('linked_by'),
  linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerShipmentUx: uniqueIndex('ux_shipment_links_owner_shipment').on(table.organizationId, table.ownerType, table.ownerId, table.shipmentId),
  ownerPrimaryUx: uniqueIndex('ux_shipment_links_owner_primary').on(table.organizationId, table.ownerType, table.ownerId).where(sql`is_primary`),
  orgShipmentIdx: index('idx_shipment_links_org_shipment').on(table.organizationId, table.shipmentId),
  shipmentIdx: index('idx_shipment_links_shipment').on(table.shipmentId),
}));

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
  /** Zoho PO line description (read-only import); split from `notes` so a Zoho
   *  re-sync can't clobber operator notes. 2026-06-24 notes-collision fix. */
  zohoNotes: text('zoho_notes'),
  /** Filed Zendesk ticket # for a line-level claim, stored as "#<id>". */
  zendeskTicket: text('zendesk_ticket'),
  // ── Drift reconciliation (2026-06-19): DB columns added via raw-SQL
  //    migrations that were missing from this Drizzle model.
  organizationId: orgIdCol(),
  /** Direct line→shipment link (retires the LATERAL PO#-guess). FK shipping_tracking_numbers (plain bigint). 2026-06-08. */
  shipmentId: bigint('shipment_id', { mode: 'number' }),
  zohoReferenceNumber: text('zoho_reference_number'),
  zohoPurchaseOrderNumber: text('zoho_purchaseorder_number'),
  /** PO | RETURN | TRADE_IN | PICKUP (line-level override of carton intake_type). 2026-04-13. */
  receivingType: text('receiving_type').default('PO'),
  skuCatalogId: integer('sku_catalog_id').references(() => skuCatalog.id, { onDelete: 'set null' }),
  skuPlatformIdRow: integer('sku_platform_id_row').references(() => skuPlatformIds.id, { onDelete: 'set null' }),
  /** Operator source-platform override for unmatched lines. 2026-05-22. */
  sourcePlatformPill: text('source_platform_pill'),
  intakeType: text('intake_type'),
  listingUrl: text('listing_url'),
  listingReference: text('listing_reference'),
  /** Warehouse bin code. 2026-05-22. */
  locationCode: text('location_code'),
  /** Set when an operator manually added an unmatched line. 2026-05-22. */
  manualEntryAt: timestamp('manual_entry_at', { withTimezone: true }),
  /** When the line reached DONE. 2026-06-11. */
  receivedDoneAt: timestamp('received_done_at', { withTimezone: true }),
  sourceSystem: text('source_system'),
  sourceOrderId: text('source_order_id'),
  isRepairService: boolean('is_repair_service').notNull().default(false),
  // ── Receiving redesign Phase 0 (2026-06-24): line-level lifecycle facts ────
  /** Read-only mirror of Zoho PO line.rate (unit cost); Zoho stays SoR. */
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }),
  /** Line-level receiver (carton-level is receiving.received_by). 2026-06-24. */
  receivedBy: integer('received_by').references(() => staff.id, { onDelete: 'set null' }),
  /** Line-level dock-scan timestamp. 2026-06-24. */
  scannedAt: timestamp('scanned_at', { withTimezone: true }),
  /** Line-level unboxed timestamp (carton-level is receiving.unboxed_at). 2026-06-24. */
  unboxedAt: timestamp('unboxed_at', { withTimezone: true }),
  /** Line-level received timestamp. 2026-06-24. */
  receivedAt: timestamp('received_at', { withTimezone: true }),
  /** Per-line exception (carton-level is receiving.exception_code). 2026-06-24. */
  exceptionCode: text('exception_code'),
  /** Coarse operator lifecycle INCOMING|SCANNED|UNBOXED|RECEIVED (derive-SoT from
   *  workflow_status); PROBLEM is the orthogonal exception dimension. NULLABLE
   *  text, no enum/CHECK yet (cutover is a later migration). 2026-06-24. */
  receivingLineStatus: text('receiving_line_status'),
  // NOTE: DB also has GENERATED column `zoho_purchaseorder_number_norm` (2026-05-21,
  // GENERATED ALWAYS from zoho_purchaseorder_number). Intentionally omitted from the
  // model — it is read via raw SQL in the reconciler; adding it as a managed column
  // risks drizzle-kit mishandling the generated expression.
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * receiving_exceptions — line-level exception/claim domain (decomposed from the
 * receiving god-table: return_reason/support_notes/zendesk_ticket/exception_code
 * move to the LINE so multi-line cartons attribute per line). Written by the
 * guarded transitionReceivingLine() chokepoint + manual-advance (Phase 2/3).
 * Migration 2026-06-24_receiving_exceptions.sql (RLS armed, not forced yet).
 */
export const receivingExceptions = pgTable('receiving_exceptions', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organizationId: orgIdCol(),
  receivingLineId: integer('receiving_line_id').notNull().references(() => receivingLines.id, { onDelete: 'cascade' }),
  receivingId: integer('receiving_id').references(() => receiving.id, { onDelete: 'cascade' }),
  exceptionCode: text('exception_code').notNull(),
  reason: text('reason'),
  supportNotes: text('support_notes'),
  zendeskTicket: text('zendesk_ticket'),
  status: text('status').notNull().default('OPEN'), // OPEN | RESOLVED
  createdBy: integer('created_by'),
  resolvedBy: integer('resolved_by'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgLineIdx: index('idx_receiving_exceptions_org_line').on(table.organizationId, table.receivingLineId),
  orgReceivingIdx: index('idx_receiving_exceptions_org_receiving').on(table.organizationId, table.receivingId),
}));

// ─── Receiving polymorphic refactor — Layer 2 (typed facts) ─────────────────
// Additive side-tables that the one-street columns on receiving_lines move into
// during the per-street cutover. See docs/todo/polymorphic-tables-database-refactor-plan.md §4
// and migration 2026-06-29c_receiving_line_facts_tables.sql (RLS armed, not forced).

/** Zoho-PO-origin line facts (the Zoho cluster + unit_price). 1:1 with the line. */
export const receivingLineZoho = pgTable('receiving_line_zoho', {
  receivingLineId: integer('receiving_line_id').primaryKey().references(() => receivingLines.id, { onDelete: 'cascade' }),
  organizationId: orgIdCol(),
  zohoItemId: text('zoho_item_id'),
  zohoLineItemId: text('zoho_line_item_id'),
  zohoPurchaseReceiveId: text('zoho_purchase_receive_id'),
  zohoPurchaseOrderId: text('zoho_purchaseorder_id'),
  zohoPurchaseOrderNumber: text('zoho_purchaseorder_number'),
  zohoReferenceNumber: text('zoho_reference_number'),
  zohoSyncSource: text('zoho_sync_source'),
  zohoLastModifiedTime: text('zoho_last_modified_time'),
  zohoSyncedAt: timestamp('zoho_synced_at', { withTimezone: true }),
  zohoNotes: text('zoho_notes'),
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgPoLineIdx: uniqueIndex('ux_receiving_line_zoho_org_po_line').on(table.organizationId, table.zohoPurchaseOrderId, table.zohoLineItemId),
  orgPrLineIdx: uniqueIndex('ux_receiving_line_zoho_org_pr_line').on(table.organizationId, table.zohoPurchaseReceiveId, table.zohoLineItemId),
  orgPoIdx: index('idx_receiving_line_zoho_org_po').on(table.organizationId, table.zohoPurchaseOrderId),
}));

/** Line-level testing/QA routing facts. Per-unit verdicts stay on serial_units/testing_results. 1:1. */
export const receivingLineTesting = pgTable('receiving_line_testing', {
  receivingLineId: integer('receiving_line_id').primaryKey().references(() => receivingLines.id, { onDelete: 'cascade' }),
  organizationId: orgIdCol(),
  needsTest: boolean('needs_test').notNull().default(true),
  assignedTechId: integer('assigned_tech_id').references(() => staff.id, { onDelete: 'set null' }),
  qaStatus: qaStatusEnum('qa_status').notNull().default('PENDING'),
  dispositionCode: dispositionEnum('disposition_code').notNull().default('HOLD'),
  conditionGrade: conditionGradeEnum('condition_grade').notNull().default('BRAND_NEW'),
  dispositionFinal: text('disposition_final'),
  dispositionAudit: jsonb('disposition_audit').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgNeedsTestIdx: index('idx_receiving_line_testing_org_needs_test').on(table.organizationId),
  orgTechIdx: index('idx_receiving_line_testing_org_tech').on(table.organizationId, table.assignedTechId),
}));

/** RETURN/TRADE_IN intake facts (return_platform, return_reason, source_order_id, rma_ref). 1:1. */
export const receivingLineReturn = pgTable('receiving_line_return', {
  receivingLineId: integer('receiving_line_id').primaryKey().references(() => receivingLines.id, { onDelete: 'cascade' }),
  organizationId: orgIdCol(),
  returnPlatform: returnPlatformEnum('return_platform'),
  returnReason: text('return_reason'),
  sourceOrderId: text('source_order_id'),
  rmaRef: text('rma_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgSourceOrderIdx: index('idx_receiving_line_return_org_source_order').on(table.organizationId, table.sourceOrderId),
}));

/** Putaway facts (location_code, bin, put_away_*). 1:1. */
export const receivingLinePutaway = pgTable('receiving_line_putaway', {
  receivingLineId: integer('receiving_line_id').primaryKey().references(() => receivingLines.id, { onDelete: 'cascade' }),
  organizationId: orgIdCol(),
  locationCode: text('location_code'),
  bin: text('bin'),
  putAwayAt: timestamp('put_away_at', { withTimezone: true }),
  putAwayBy: integer('put_away_by').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgLocationIdx: index('idx_receiving_line_putaway_org_location').on(table.organizationId, table.locationCode),
}));

/**
 * Long-tail / org-custom receiving-line typed facts: (line_id, fact_kind, payload).
 * fact_kind is validated by src/lib/receiving/facts/registry.ts at write time (code
 * registry, not a DB CHECK) so a new kind needs no migration — same governance as
 * workflow_nodes.type → configSchema.
 */
export const receivingLineFacts = pgTable('receiving_line_facts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organizationId: orgIdCol(),
  receivingLineId: integer('receiving_line_id').notNull().references(() => receivingLines.id, { onDelete: 'cascade' }),
  factKind: text('fact_kind').notNull(),
  payload: jsonb('payload').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  lineKindIdx: uniqueIndex('ux_receiving_line_facts_line_kind').on(table.organizationId, table.receivingLineId, table.factKind),
  orgKindIdx: index('idx_receiving_line_facts_org_kind').on(table.organizationId, table.factKind),
  lineIdx: index('idx_receiving_line_facts_line').on(table.receivingLineId),
}));

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
/**
 * sku_stock — trigger-maintained projection of sku_stock_ledger.
 * Since 2026-04-15 (sku_stock_ledger_authoritative), `stock` and `boxedStock`
 * are recomputed by fn_recompute_sku_stock(); writes must go to the ledger.
 */
export const skuStock = pgTable('sku_stock', {
  id: serial('id').primaryKey(),
  // Stored as INTEGER post-2026-04-15; kept as text for backwards compat with existing reads.
  stock: integer('stock').notNull().default(0),
  boxedStock: integer('boxed_stock').notNull().default(0),
  sku: text('sku'),
  productTitle: text('product_title'),
  location: text('location'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * sku — RETIRED 2026-04-15. INSERTs blocked by trg_block_sku_inserts.
 * Historical rows preserved as archive + legacy FK target. New writes go to
 * serial_units. Read live data via the v_sku compat view or serial_units.
 */
export const sku = pgTable('sku', {
  id: serial('id').primaryKey(),
  dateTime: timestamp('date_time', { withTimezone: true }),
  staticSku: text('static_sku'),
  serialNumber: text('serial_number'),
  shippingTrackingNumber: text('shipping_tracking_number'),
  shipmentId: bigint('shipment_id', { mode: 'number' }),
  notes: text('notes'),
  location: text('location'),
  /** FK to serial_units master, added 2026-04-11. Nullable for legacy rows. */
  serialUnitId: integer('serial_unit_id'),
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
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  intakeConfirmedAt: timestamp('intake_confirmed_at', { withTimezone: true }),
  receivedByStaffId: integer('received_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  customerId: integer('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Generic documents table for storing signed agreements, forms, etc.
export const documents = pgTable('documents', {
  id: serial('id').primaryKey(),
  entityType: text('entity_type').notNull(),
  entityId: integer('entity_id').notNull(),
  documentType: text('document_type').notNull().default('intake_agreement'),
  signatureUrl: text('signature_url'),
  signerName: text('signer_name'),
  signedAt: timestamp('signed_at', { withTimezone: true }),
  documentData: jsonb('document_data').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;

// Packing data audit trail lives in packer_logs; photos in the unified photos table.

export const fbaFnskus = pgTable('fba_fnskus', {
  fnsku: text('fnsku').primaryKey(),
  productTitle: text('product_title'),
  asin: text('asin'),
  sku: text('sku'),
  /** Catalog-level condition grade — single source of truth for FBA condition (live column). */
  condition: text('condition'),
  isActive: boolean('is_active').notNull().default(true),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  /** FK to sku_catalog — central product hub */
  skuCatalogId: integer('sku_catalog_id'),
  /** Tenant owner (live column; nullable for legacy global rows). */
  organizationId: uuid('organization_id'),
});

export const fbaShipments = pgTable('fba_shipments', {
  id: serial('id').primaryKey(),
  shipmentRef: text('shipment_ref').notNull(),
  amazonShipmentId: text('amazon_shipment_id'),
  destinationFc: text('destination_fc'),
  dueDate: date('due_date'),
  status: text('status').notNull().default('PLANNED'),
  createdByStaffId: integer('created_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  assignedTechId: integer('assigned_tech_id').references(() => staff.id, { onDelete: 'set null' }),
  assignedPackerId: integer('assigned_packer_id').references(() => staff.id, { onDelete: 'set null' }),
  // Counter columns removed — counts computed inline via COUNT(*) FILTER (...)
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

// Junction table between internal FBA plans and carrier tracking rows.
// `tracking_id` points at `shipping_tracking_numbers.id`, which is managed outside this Drizzle schema file.
export const fbaShipmentTracking = pgTable('fba_shipment_tracking', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id').notNull().references(() => fbaShipments.id, { onDelete: 'cascade' }),
  trackingId: bigint('tracking_id', { mode: 'number' }).notNull(),
  label: text('label'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** Tenant owner (live column). */
  organizationId: uuid('organization_id'),
}, (table) => ({
  shipmentTrackingUnique: uniqueIndex('ux_fba_shipment_tracking_plan_tracking').on(table.shipmentId, table.trackingId),
}));

// Per-tracking bundle composition for a shipment: many shipment items can map to one tracking row.
export const fbaTrackingItemAllocations = pgTable('fba_tracking_item_allocations', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  shipmentId: integer('shipment_id').notNull().references(() => fbaShipments.id, { onDelete: 'cascade' }),
  trackingId: bigint('tracking_id', { mode: 'number' }).notNull(),
  shipmentItemId: integer('shipment_item_id').notNull().references(() => fbaShipmentItems.id, { onDelete: 'cascade' }),
  qty: integer('qty').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqueBundleItem: uniqueIndex('ux_fba_tracking_item_allocations_bundle_item')
    .on(table.shipmentId, table.trackingId, table.shipmentItemId),
  byShipmentTracking: index('idx_fba_tracking_item_allocations_shipment_tracking')
    .on(table.shipmentId, table.trackingId),
  byShipmentItem: index('idx_fba_tracking_item_allocations_item')
    .on(table.shipmentItemId),
}));

export const fbaFnskuLogs = pgTable('fba_fnsku_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  fnsku: text('fnsku').notNull().references(() => fbaFnskus.fnsku, { onDelete: 'restrict' }),
  sourceStage: text('source_stage').notNull(),
  eventType: text('event_type').notNull(),
  staffId: integer('staff_id').references(() => staff.id, { onDelete: 'set null' }),
  techSerialNumberId: bigint('tech_serial_number_id', { mode: 'number' }),
  fbaShipmentId: integer('fba_shipment_id').references(() => fbaShipments.id, { onDelete: 'set null' }),
  fbaShipmentItemId: integer('fba_shipment_item_id').references(() => fbaShipmentItems.id, { onDelete: 'set null' }),
  /** FK to the SAL row that triggered this log entry (Phase 1 SAL-SoT). */
  stationActivityLogId: integer('station_activity_log_id').references(() => stationActivityLogs.id, { onDelete: 'set null' }),
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
  /** Origin station for this serial event (TECH default; RECEIVING for unboxing serial capture). */
  stationSource: text('station_source').notNull().default('TECH'),
  /** FK to shipping_tracking_numbers for carrier-tracking rows */
  shipmentId: bigint('shipment_id', { mode: 'number' }),
  /** SKU bucket row that supplied this serial, when the serial was pulled from storage via a colon SKU scan. */
  sourceSkuId: integer('source_sku_id').references(() => sku.id, { onDelete: 'set null' }),
  /** FK to orders_exceptions for unmatched carrier scans */
  ordersExceptionId: integer('orders_exception_id').references(() => ordersExceptions.id, { onDelete: 'set null' }),
  /** FK to receiving_lines for unboxing/receiving serial capture. */
  receivingLineId: integer('receiving_line_id').references(() => receivingLines.id, { onDelete: 'set null' }),
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
  /** TRACKING_SCANNED / FNSKU_SCANNED SAL row that opened this serial session (not scan_ref-based). */
  contextStationActivityLogId: integer('context_station_activity_log_id').references(
    () => stationActivityLogs.id,
    { onDelete: 'set null' },
  ),
  /** FK to serial_units master, added 2026-04-11. Nullable for legacy/batch-import rows. */
  serialUnitId: integer('serial_unit_id'),
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
export type FbaShipmentTracking = typeof fbaShipmentTracking.$inferSelect;
export type NewFbaShipmentTracking = typeof fbaShipmentTracking.$inferInsert;
export type FbaFnskuLog = typeof fbaFnskuLogs.$inferSelect;
export type NewFbaFnskuLog = typeof fbaFnskuLogs.$inferInsert;
export type TechSerialNumber = typeof techSerialNumbers.$inferSelect;
export type NewTechSerialNumber = typeof techSerialNumbers.$inferInsert;
export type OrdersException = typeof ordersExceptions.$inferSelect;
export type NewOrdersException = typeof ordersExceptions.$inferInsert;

// ============================================================
// AI Training Pipeline
// ============================================================

export const trainingSampleStatusEnum = pgEnum('training_sample_status', [
  'raw',
  'rated',
  'queued',
  'trained',
  'rejected',
]);

export const pipelineTaskSourceEnum = pgEnum('pipeline_task_source', [
  'typecheck',
  'lint',
  'test_failure',
  'todo_comment',
  'manual',
]);

export const trainingRunStatusEnum = pgEnum('training_run_status', [
  'pending',
  'running',
  'completed',
  'failed',
]);

export const trainingSamples = pgTable('training_samples', {
  organizationId: orgIdCol(),
  id: serial('id').primaryKey(),
  instruction: text('instruction').notNull(),
  inputContext: text('input_context'),
  output: text('output').notNull(),
  source: varchar('source', { length: 50 }).notNull(),
  repo: varchar('repo', { length: 200 }),
  filePaths: jsonb('file_paths').$type<string[]>(),
  commitSha: varchar('commit_sha', { length: 40 }),
  status: trainingSampleStatusEnum('status').default('raw').notNull(),
  rating: integer('rating'),
  autoScore: numeric('auto_score'),
  testsPass: boolean('tests_pass'),
  trainingRunId: integer('training_run_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  ratedAt: timestamp('rated_at', { withTimezone: true }),
}, (table) => ({
  statusIdx: index('training_samples_status_idx').on(table.status),
  ratingIdx: index('training_samples_rating_idx').on(table.rating),
}));

export const trainingRuns = pgTable('training_runs', {
  organizationId: orgIdCol(),
  id: serial('id').primaryKey(),
  baseModel: varchar('base_model', { length: 200 }).notNull(),
  adapterName: varchar('adapter_name', { length: 200 }),
  loraRank: integer('lora_rank').default(16),
  learningRate: numeric('learning_rate').default('0.0002'),
  epochs: integer('epochs').default(3),
  sampleCount: integer('sample_count'),
  status: trainingRunStatusEnum('status').default('pending').notNull(),
  trainLoss: numeric('train_loss'),
  evalLoss: numeric('eval_loss'),
  durationSeconds: integer('duration_seconds'),
  adapterPath: text('adapter_path'),
  deviceId: varchar('device_id', { length: 50 }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  errorLog: text('error_log'),
});

export const modelVersions = pgTable('model_versions', {
  organizationId: orgIdCol(),
  id: serial('id').primaryKey(),
  runId: integer('run_id').references(() => trainingRuns.id),
  version: varchar('version', { length: 50 }).notNull(),
  baseModel: varchar('base_model', { length: 200 }).notNull(),
  adapterPath: text('adapter_path').notNull(),
  evalScore: numeric('eval_score'),
  promoted: boolean('promoted').default(false).notNull(),
  promotedAt: timestamp('promoted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const pipelineTasks = pgTable('pipeline_tasks', {
  organizationId: orgIdCol(),
  id: serial('id').primaryKey(),
  taskHash: varchar('task_hash', { length: 16 }).notNull().unique(),
  title: varchar('title', { length: 300 }).notNull(),
  source: pipelineTaskSourceEnum('source').notNull(),
  description: text('description').notNull(),
  filePaths: jsonb('file_paths').$type<string[]>().notNull(),
  context: text('context'),
  priority: integer('priority').default(3).notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resultBranch: varchar('result_branch', { length: 200 }),
  resultRating: integer('result_rating'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  statusIdx: index('pipeline_tasks_status_idx').on(table.status),
  priorityIdx: index('pipeline_tasks_priority_idx').on(table.priority),
}));

export const pipelineCycles = pgTable('pipeline_cycles', {
  organizationId: orgIdCol(),
  id: serial('id').primaryKey(),
  tasksDiscovered: integer('tasks_discovered').default(0).notNull(),
  tasksAttempted: integer('tasks_attempted').default(0).notNull(),
  tasksPassed: integer('tasks_passed').default(0).notNull(),
  tasksFailed: integer('tasks_failed').default(0).notNull(),
  samplesCollected: integer('samples_collected').default(0).notNull(),
  durationSeconds: integer('duration_seconds'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

// Type exports
export type TrainingSample = typeof trainingSamples.$inferSelect;
export type NewTrainingSample = typeof trainingSamples.$inferInsert;
export type TrainingRun = typeof trainingRuns.$inferSelect;
export type NewTrainingRun = typeof trainingRuns.$inferInsert;
export type ModelVersion = typeof modelVersions.$inferSelect;
export type NewModelVersion = typeof modelVersions.$inferInsert;
export type PipelineTask = typeof pipelineTasks.$inferSelect;
export type NewPipelineTask = typeof pipelineTasks.$inferInsert;
export type PipelineCycle = typeof pipelineCycles.$inferSelect;
export type NewPipelineCycle = typeof pipelineCycles.$inferInsert;

// ─── SKU Catalog Hub ─────────────────────────────────────────────────────────

export const skuCatalog = pgTable('sku_catalog', {
  id: serial('id').primaryKey(),
  sku: text('sku').notNull().unique(),
  productTitle: text('product_title').notNull(),
  category: text('category'),
  upc: text('upc'),
  ean: text('ean'),
  /** GS1 Global Trade Item Number — encodes Digital Link QRs (/01/{gtin}). Added 2026-05-14. */
  gtin: text('gtin'),
  imageUrl: text('image_url'),
  isActive: boolean('is_active').notNull().default(true),
  /** Sourcing lifecycle: active|eol|discontinued|nrnd|unknown. Non-active rows feed runSourcingScanJob. Added 2026-06-06. */
  lifecycleStatus: text('lifecycle_status').notNull().default('active'),
  /** Min on-hand before the sourcing scan opens a low_stock alert (NULL = none). */
  reorderThreshold: integer('reorder_threshold'),
  /** Rolling acquisition cost stamped from part_acquisitions on import; margin baseline. */
  lastKnownCostCents: integer('last_known_cost_cents'),
  sourcingNotes: text('sourcing_notes'),
  /** Per-SKU replenish price point (cents); the watcher alerts below this. Added 2026-06-06. */
  replenishTargetCents: integer('replenish_target_cents'),
  /** Per-SKU pack/handling guidance shown to the packer before confirm (P1-PCK-02). Added 2026-06-21. */
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const skuPlatformIds = pgTable('sku_platform_ids', {
  id: serial('id').primaryKey(),
  skuCatalogId: integer('sku_catalog_id').notNull().references(() => skuCatalog.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  platformSku: text('platform_sku'),
  platformItemId: text('platform_item_id'),
  accountName: text('account_name'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * platform_listings — first-class per-channel listing (ported from USAV_ERP's
 * `platform_listing`). Unlike sku_platform_ids (a thin id mapping), this carries
 * channel price/qty/condition + its own outbound sync state + a sync_hash for
 * idempotent skip. `skuCatalogId` is nullable so an UNRESOLVED listing (matched
 * to a channel but not yet to a catalog SKU) is persisted, not dropped.
 * org-scoped (organization_id, GUC default, RLS armed). See migration
 * 2026-06-17_platform_listings.sql + src/lib/inventory/platform-listings.ts.
 */
export const platformListings = pgTable('platform_listings', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organizationId: orgIdCol(),
  skuCatalogId: integer('sku_catalog_id').references(() => skuCatalog.id, { onDelete: 'set null' }),
  platform: text('platform').notNull(),
  accountName: text('account_name'),
  externalRefId: text('external_ref_id'),
  merchantSku: text('merchant_sku'),
  listedName: text('listed_name'),
  listedDescription: text('listed_description'),
  listingPriceCents: integer('listing_price_cents'),
  listingQuantity: integer('listing_quantity'),
  listingCondition: text('listing_condition'),
  upc: text('upc'),
  platformMetadata: jsonb('platform_metadata'),
  /** PENDING | SYNCED | ERROR */
  syncStatus: text('sync_status').notNull().default('PENDING'),
  /** sha256 of last-pushed payload; skip the push when unchanged. */
  syncHash: text('sync_hash'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  syncError: text('sync_error'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PlatformListing = typeof platformListings.$inferSelect;
export type NewPlatformListing = typeof platformListings.$inferInsert;

export const skuKitParts = pgTable('sku_kit_parts', {
  id: serial('id').primaryKey(),
  skuCatalogId: integer('sku_catalog_id').notNull().references(() => skuCatalog.id, { onDelete: 'cascade' }),
  componentName: text('component_name').notNull(),
  componentType: text('component_type').notNull().default('PART'),
  qtyRequired: integer('qty_required').notNull().default(1),
  requiredFor: text('required_for').array(),
  isCritical: boolean('is_critical').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

/**
 * pending_skus — to-do queue of SKUs seen in operations but not yet in
 * sku_catalog (need creating in Zoho, the SoT). `sku_catalog_id` stays NULL
 * while PENDING and is auto-stamped by trg_resolve_pending_sku when the matching
 * catalog row is created. See migration 2026-06-06b_pending_skus.sql +
 * src/lib/inventory/pending-skus.ts. status ∈ PENDING|CREATED|IGNORED|DUPLICATE.
 */
export const pendingSkus = pgTable('pending_skus', {
  id: serial('id').primaryKey(),
  normalizedSku: text('normalized_sku').notNull().unique(),
  rawSku: text('raw_sku').notNull(),
  status: text('status').notNull().default('PENDING'),
  occurrences: integer('occurrences').notNull().default(1),
  firstSource: text('first_source'),
  suggestedTitle: text('suggested_title'),
  skuCatalogId: integer('sku_catalog_id').references(() => skuCatalog.id, { onDelete: 'set null' }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  assignedTo: integer('assigned_to').references(() => staff.id, { onDelete: 'set null' }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PendingSku = typeof pendingSkus.$inferSelect;
export type NewPendingSku = typeof pendingSkus.$inferInsert;

// ─── Bose Sourcing Engine ────────────────────────────────────────────────────
// Compatibility DB + alternative-sourcing tables. See migrations
// 2026-06-06e/f/g and docs/bose-parts-sourcing-engine-plan.md.

/** Bose product model catalog — the root of the compatibility lookup. */
export const boseModels = pgTable('bose_models', {
  id: serial('id').primaryKey(),
  modelNumber: text('model_number').notNull().unique(),
  modelName: text('model_name').notNull(),
  family: text('family'),
  productType: text('product_type'),
  releaseYear: integer('release_year'),
  eolDate: date('eol_date'),
  imageUrl: text('image_url'),
  notes: text('notes'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export type BoseModel = typeof boseModels.$inferSelect;
export type NewBoseModel = typeof boseModels.$inferInsert;

/** Optional serial-prefix -> model decode. Ships empty; lookup degrades to model search. */
export const boseSerialPrefixes = pgTable('bose_serial_prefixes', {
  id: serial('id').primaryKey(),
  prefix: text('prefix').notNull().unique(),
  boseModelId: integer('bose_model_id').notNull().references(() => boseModels.id, { onDelete: 'cascade' }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export type BoseSerialPrefix = typeof boseSerialPrefixes.$inferSelect;
export type NewBoseSerialPrefix = typeof boseSerialPrefixes.$inferInsert;

/** Many-to-many: which sku_catalog parts fit which bose_models. Distinct from sku_relationships (BOM). */
export const partCompatibility = pgTable('part_compatibility', {
  id: serial('id').primaryKey(),
  boseModelId: integer('bose_model_id').notNull().references(() => boseModels.id, { onDelete: 'cascade' }),
  skuId: integer('sku_id').notNull().references(() => skuCatalog.id, { onDelete: 'cascade' }),
  partRole: text('part_role').notNull(),
  isOem: boolean('is_oem').notNull().default(true),
  fit: text('fit').notNull().default('exact'),               // exact|equivalent|salvage
  confidence: text('confidence').notNull().default('confirmed'), // confirmed|likely|unverified
  source: text('source').notNull().default('manual'),        // manual|csv_import|ebay
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex('part_compatibility_uniq').on(t.boseModelId, t.skuId, t.partRole),
}));
export type PartCompatibility = typeof partCompatibility.$inferSelect;
export type NewPartCompatibility = typeof partCompatibility.$inferInsert;

/** Third-party sourcing vendors (eBay sellers auto-created on import; others manual). */
export const suppliers = pgTable('suppliers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  supplierType: text('supplier_type').notNull().default('other'), // ebay_seller|distributor|salvage|oem|marketplace|other
  email: text('email'),
  phone: text('phone'),
  url: text('url'),
  ebaySellerId: text('ebay_seller_id'),
  rating: integer('rating'),
  leadTimeDays: integer('lead_time_days'),
  notes: text('notes'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;

/** Auto-flag queue for EOL/discontinued/low-stock SKUs. Upserted by runSourcingScanJob. */
export const sourcingAlerts = pgTable('sourcing_alerts', {
  id: serial('id').primaryKey(),
  skuId: integer('sku_id').notNull().references(() => skuCatalog.id, { onDelete: 'cascade' }),
  boseModelId: integer('bose_model_id').references(() => boseModels.id, { onDelete: 'set null' }),
  alertType: text('alert_type').notNull(),       // eol|discontinued|low_stock|demand_no_stock
  severity: text('severity').notNull().default('warn'), // info|warn|critical
  status: text('status').notNull().default('open'),     // open|sourcing|resolved|dismissed
  reason: text('reason'),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: integer('resolved_by').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export type SourcingAlert = typeof sourcingAlerts.$inferSelect;
export type NewSourcingAlert = typeof sourcingAlerts.$inferInsert;

/** Normalized secondary-market (eBay Browse) listings; the watchlist + import source. */
export const sourcingCandidates = pgTable('sourcing_candidates', {
  id: serial('id').primaryKey(),
  skuId: integer('sku_id').references(() => skuCatalog.id, { onDelete: 'set null' }),
  boseModelId: integer('bose_model_id').references(() => boseModels.id, { onDelete: 'set null' }),
  sourcingAlertId: integer('sourcing_alert_id').references(() => sourcingAlerts.id, { onDelete: 'set null' }),
  supplierId: integer('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
  source: text('source').notNull().default('ebay'),   // ebay|manual
  externalId: text('external_id'),
  title: text('title').notNull(),
  url: text('url'),
  imageUrl: text('image_url'),
  condition: text('condition'),                       // new|refurbished|used|for_parts
  priceCents: integer('price_cents'),
  shippingCents: integer('shipping_cents'),
  currency: text('currency').notNull().default('USD'),
  sellerName: text('seller_name'),
  status: text('status').notNull().default('candidate'), // candidate|watching|ordered|imported|rejected
  raw: jsonb('raw'),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export type SourcingCandidate = typeof sourcingCandidates.$inferSelect;
export type NewSourcingCandidate = typeof sourcingCandidates.$inferInsert;

/** Cost + condition ledger linking a candidate to the receiving/serial_units pipeline on import. */
export const partAcquisitions = pgTable('part_acquisitions', {
  id: serial('id').primaryKey(),
  sourcingCandidateId: integer('sourcing_candidate_id').references(() => sourcingCandidates.id, { onDelete: 'set null' }),
  supplierId: integer('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
  skuId: integer('sku_id').notNull().references(() => skuCatalog.id, { onDelete: 'cascade' }),
  receivingId: integer('receiving_id').references(() => receiving.id, { onDelete: 'set null' }),
  serialUnitId: integer('serial_unit_id').references(() => serialUnits.id, { onDelete: 'set null' }),
  acquisitionCostCents: integer('acquisition_cost_cents'),
  shippingCostCents: integer('shipping_cost_cents'),
  condition: text('condition'),                       // new|refurbished|used|for_parts
  status: text('status').notNull().default('ordered'), // ordered|received|imported|returned
  orderedAt: timestamp('ordered_at', { withTimezone: true }).notNull().defaultNow(),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export type PartAcquisition = typeof partAcquisitions.$inferSelect;
export type NewPartAcquisition = typeof partAcquisitions.$inferInsert;

export const qcCheckTemplates = pgTable('qc_check_templates', {
  id: serial('id').primaryKey(),
  skuCatalogId: integer('sku_catalog_id').references(() => skuCatalog.id, { onDelete: 'cascade' }),
  category: text('category'),
  stepLabel: text('step_label').notNull(),
  stepType: text('step_type').notNull().default('PASS_FAIL'),
  sortOrder: integer('sort_order').notNull().default(0),
  // Lifecycle: 'draft' steps are hidden from execution views (tech checklist /
  // testing-bundle / bulk settle) until published. Default 'published' keeps
  // every existing step visible. See 2026-06-06_qc_template_lifecycle.sql.
  status: text('status').notNull().default('published'),
  // Structured-value foundation (battery %, BT, measurements). Null = legacy
  // pass/fail. Server decides pass/fail from value vs pass_min/pass_max.
  valueKind: text('value_kind'),
  valueUnit: text('value_unit'),
  valueEnum: jsonb('value_enum'),
  passMin: numeric('pass_min'),
  passMax: numeric('pass_max'),
  // Failure mode to auto-tag on this unit when this step fails (2026-06-07).
  failureModeId: integer('failure_mode_id').references(() => failureModes.id, { onDelete: 'set null' }),
});

export const techVerifications = pgTable('tech_verifications', {
  id: serial('id').primaryKey(),
  sourceKind: text('source_kind').notNull(),
  sourceRowId: integer('source_row_id').notNull(),
  skuCatalogId: integer('sku_catalog_id').notNull().references(() => skuCatalog.id),
  stepType: text('step_type').notNull(),
  stepId: integer('step_id').notNull(),
  passed: boolean('passed'),
  verifiedBy: integer('verified_by'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
  notes: text('notes'),
  // Structured recorded answer for value_kind steps (battery %, voltage, …).
  valueNum: numeric('value_num'),
  valueText: text('value_text'),
  // Which failure mode a failed result mapped to (2026-06-07).
  failedModeId: integer('failed_mode_id').references(() => failureModes.id, { onDelete: 'set null' }),
});

// ──────────────────────────────────────────────
// AI Chat Sessions & Messages
// ──────────────────────────────────────────────
// Inventory v2 — Drizzle declarations for tables previously created via raw
// SQL migration (Apr–May 2026) plus Phase 0 additions from
// context/inventory_system_upgrade_plan.md. These were accessed via raw SQL
// before; declaring them here unlocks typed reads/writes across the codebase.
// Zero behavior change in this commit.
// ──────────────────────────────────────────────

/**
 * locations — bin-addressable warehouse map (post 2026-04-09 bin upgrade).
 * The room/row/col triple plus zone_letter encodes each bin; barcode is the
 * scannable surface. NOT to be confused with zoho_locations (Zoho warehouse
 * mirror) which still lives separately above.
 */
export const locations = pgTable('locations', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  room: text('room'),
  description: text('description'),
  barcode: text('barcode').unique(),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  rowLabel: text('row_label'),
  colLabel: text('col_label'),
  binType: text('bin_type'),
  capacity: integer('capacity'),
  parentId: integer('parent_id'),
  /** Server-of-record letter for the room. NULL on bin rows; set on the parent room row only. */
  zoneLetter: text('zone_letter'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * bin_contents — what SKU lives in which bin, and how many.
 * UNIQUE(location_id, sku). FK on sku → sku_catalog.sku since 2026-04-09.
 */
export const binContents = pgTable('bin_contents', {
  id: serial('id').primaryKey(),
  locationId: integer('location_id').notNull().references(() => locations.id),
  sku: text('sku').notNull(),
  qty: integer('qty').notNull().default(0),
  minQty: integer('min_qty'),
  maxQty: integer('max_qty'),
  lastCounted: timestamp('last_counted', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  locSkuUniq: uniqueIndex('bin_contents_location_id_sku_key').on(table.locationId, table.sku),
}));

/** location_transfers — audit log for every bin-to-bin SKU move. */
export const locationTransfers = pgTable('location_transfers', {
  id: serial('id').primaryKey(),
  entityType: text('entity_type').notNull(),  // 'SKU_STOCK' | 'SKU_RECORD'
  entityId: integer('entity_id').notNull(),
  sku: text('sku').notNull(),
  fromLocation: text('from_location'),
  toLocation: text('to_location').notNull(),
  staffId: integer('staff_id'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * serial_units — per-unit aggregate root (2026-04-10).
 * Stores cradle-to-grave lifecycle state for every physical serialized unit.
 * Relaxed: most columns nullable so legacy / batch-imported serials are
 * first-class. New writes should always upsert by normalized_serial.
 */
export const serialUnits = pgTable('serial_units', {
  id: serial('id').primaryKey(),
  serialNumber: text('serial_number').notNull(),
  /**
   * Per-org natural key. The unique is PER-TENANT — ux_serial_units_org_normalized_serial
   * on (organization_id, normalized_serial), 2026-06-19 — NOT a global unique, because a
   * serial string only identifies a unit within one tenant's inventory. (Index lives in
   * SQL migrations, this table's source of truth; not re-expressed here.)
   */
  normalizedSerial: text('normalized_serial').notNull(),
  sku: text('sku'),
  skuCatalogId: integer('sku_catalog_id').references(() => skuCatalog.id, { onDelete: 'set null' }),
  zohoItemId: text('zoho_item_id'),
  /** USAV-minted unit identity {SKU_SHORT}-{YYWW}-{SEQ6}, stamped at first label. Org-unique. Added 2026-06-06. */
  unitUid: text('unit_uid'),
  currentStatus: serialStatusEnum('current_status').notNull().default('UNKNOWN'),
  currentLocation: text('current_location'),
  conditionGrade: conditionGradeEnum('condition_grade'),
  originSource: text('origin_source'),
  originReceivingLineId: integer('origin_receiving_line_id').references(() => receivingLines.id, { onDelete: 'set null' }),
  originTsnId: integer('origin_tsn_id'),
  originSkuId: integer('origin_sku_id'),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  receivedBy: integer('received_by'),
  notes: text('notes'),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  /** Legacy-coverage columns added 2026-04-15 when the sku table was retired. */
  shippingTrackingNumber: text('shipping_tracking_number'),
  shipmentId: bigint('shipment_id', { mode: 'number' }),
  legacyNotes: text('legacy_notes'),
  legacyDateTime: timestamp('legacy_date_time'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // NOTE: the org-scoped partial unique index ux_serial_units_org_unit_uid
  // and the organization_id column (added 2026-05-23) live in SQL migrations,
  // which are the source of truth for this table — not expressed here.
});

/**
 * sku_stock_ledger — authoritative signed-delta ledger for SKU quantities.
 * Marked authoritative 2026-04-15: sku_stock.stock / .boxed_stock are now
 * trigger-maintained from SUM(delta) per (sku, dimension). All writes go here;
 * direct mutations on sku_stock are forbidden.
 *
 * dimension ∈ ('WAREHOUSE','BOXED').
 * reason: TEXT free-form; typed via reason_codes.reason_code_id since 2026-05-14.
 */
export const skuStockLedger = pgTable('sku_stock_ledger', {
  id: serial('id').primaryKey(),
  sku: text('sku').notNull(),
  delta: integer('delta').notNull(),
  reason: text('reason').notNull().default('ADJUSTMENT'),
  staffId: integer('staff_id'),
  dimension: text('dimension').notNull().default('WAREHOUSE'),
  reasonCodeId: integer('reason_code_id'),
  refSerialUnitId: integer('ref_serial_unit_id'),
  refPackerLogId: integer('ref_packer_log_id'),
  refTechLogId: integer('ref_tech_log_id'),
  refSalId: integer('ref_sal_id'),
  refOrderId: integer('ref_order_id'),
  refShipmentId: integer('ref_shipment_id'),
  refReceivingLineId: integer('ref_receiving_line_id'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * inventory_events — unified lifecycle / audit timeline (2026-05-13).
 * Sibling to sku_stock_ledger: ledger holds quantity deltas, events hold the
 * lifecycle context (status changes, putaway, move, test, etc.). They join
 * on inventory_events.stock_ledger_id when an event also moved quantity.
 *
 * event_type ∈ RECEIVED | TEST_START | TEST_PASS | TEST_FAIL | PUTAWAY |
 *              MOVED | PICKED | PACKED | SHIPPED | ADJUSTED | RETURNED |
 *              SCRAPPED | LISTED | NOTE
 * Phase 0 adds: ALLOCATED | RELEASED | TRIAGED | REPAIR_STARTED |
 *               REPAIR_COMPLETED | GRADED | LABELED | STAGED | HELD |
 *               RELEASED_HOLD
 */
export const inventoryEvents = pgTable('inventory_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  eventType: text('event_type').notNull(),
  actorStaffId: integer('actor_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  station: text('station'),
  receivingId: bigint('receiving_id', { mode: 'number' }),
  receivingLineId: bigint('receiving_line_id', { mode: 'number' }),
  serialUnitId: integer('serial_unit_id').references(() => serialUnits.id, { onDelete: 'set null' }),
  sku: text('sku'),
  binId: integer('bin_id').references(() => locations.id, { onDelete: 'set null' }),
  prevBinId: integer('prev_bin_id').references(() => locations.id, { onDelete: 'set null' }),
  prevStatus: text('prev_status'),
  nextStatus: text('next_status'),
  stockLedgerId: integer('stock_ledger_id').references(() => skuStockLedger.id, { onDelete: 'set null' }),
  scanToken: text('scan_token'),
  /** UNIQUE — mobile clients send this for idempotent retries. */
  clientEventId: text('client_event_id').unique(),
  notes: text('notes'),
  payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
  /**
   * Per-tenant scope. Added to the live table by 2026-05-23_org_id_on_business_tables.sql
   * (column + RLS); declared here so the Drizzle model matches the DB and the
   * column isn't silently dropped by `db:push`. Defaults from the GUC so raw-SQL
   * callers that don't pass orgId still tenant-stamp via `app.current_org`.
   */
  organizationId: orgIdCol(),
  /** Optional multi-warehouse scope (2026-05-14_multi_warehouse.sql). */
  warehouseId: integer('warehouse_id'),
});

/**
 * reason_codes — typed lookup for ledger adjustments (2026-05-14).
 * Replaces the free-text `reason` column with categorized codes that drive
 * financial classification (shrinkage, sale, return, etc.).
 */
export const reasonCodes = pgTable('reason_codes', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  label: text('label').notNull(),
  /** shrinkage | adjustment | sale | return | movement | initial */
  category: text('category').notNull(),
  /** in | out | either */
  direction: text('direction').notNull(),
  requiresNote: boolean('requires_note').notNull().default(false),
  requiresPhoto: boolean('requires_photo').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(100),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * printer_profiles — targets for /api/print/dispatch (2026-05-14).
 * One row per physical printer with vendor + external dispatcher id +
 * optional default label class (carton | product | bin).
 */
export const printerProfiles = pgTable('printer_profiles', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  externalId: text('external_id').notNull(),
  vendor: text('vendor').notNull().default('printnode'),
  /** carton | product | bin | unit | null (generic). 'unit' added 2026-05-17 Phase 1 for Tier-3 GS1 unit labels. */
  defaultFor: text('default_for'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * stock_alerts — daily-cron-generated bin signals (2026-05-14).
 * alert_type ∈ LOW_STOCK | NEVER_COUNTED | STALE_COUNT. One open alert per
 * (sku, bin_id, alert_type); closed alerts (resolved_at IS NOT NULL) stay
 * for history.
 */
export const stockAlerts = pgTable('stock_alerts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  sku: text('sku').notNull(),
  binId: integer('bin_id').references(() => locations.id, { onDelete: 'set null' }),
  alertType: text('alert_type').notNull(),
  threshold: integer('threshold'),
  qtyAtTrigger: integer('qty_at_trigger'),
  triggeredAt: timestamp('triggered_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  notifiedAt: timestamp('notified_at', { withTimezone: true }),
  notes: text('notes'),
});

/** cycle_count_campaigns — month-end / audit count campaigns (2026-05-14). */
export const cycleCountCampaigns = pgTable('cycle_count_campaigns', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  scope: jsonb('scope').notNull().default(sql`'{}'::jsonb`),
  varianceTol: numeric('variance_tol', { precision: 5, scale: 2 }).notNull().default('0.05'),
  /** open | closed */
  status: text('status').notNull().default('open'),
  createdBy: integer('created_by').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});

/**
 * cycle_count_lines — per (bin, sku) expected→counted rows. Within
 * campaign.varianceTol auto-approves; over tolerance lands in pending_review.
 */
export const cycleCountLines = pgTable('cycle_count_lines', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  campaignId: integer('campaign_id').notNull().references(() => cycleCountCampaigns.id, { onDelete: 'cascade' }),
  binId: integer('bin_id').notNull().references(() => locations.id, { onDelete: 'cascade' }),
  sku: text('sku').notNull(),
  expectedQty: integer('expected_qty').notNull(),
  countedQty: integer('counted_qty'),
  /** GENERATED ALWAYS AS (counted_qty - expected_qty) STORED — read-only. */
  variance: integer('variance'),
  /** pending | counted | pending_review | approved | rejected */
  status: text('status').notNull().default('pending'),
  countedBy: integer('counted_by').references(() => staff.id, { onDelete: 'set null' }),
  countedAt: timestamp('counted_at', { withTimezone: true }),
  approvedBy: integer('approved_by').references(() => staff.id, { onDelete: 'set null' }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  campaignBinSkuUniq: uniqueIndex('cycle_count_lines_unique').on(table.campaignId, table.binId, table.sku),
}));

// ──────────────────────────────────────────────
// Phase 0 NEW tables (created by 2026-05-17_inventory_v2_phase0.sql)
// ──────────────────────────────────────────────

/**
 * serial_unit_condition_history — per-unit grade timeline.
 * Append-only. One row per condition change; links to the inventory_event
 * that produced the assessment.
 */
export const serialUnitConditionHistory = pgTable('serial_unit_condition_history', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  serialUnitId: integer('serial_unit_id').notNull().references(() => serialUnits.id, { onDelete: 'cascade' }),
  assessedAt: timestamp('assessed_at', { withTimezone: true }).notNull().defaultNow(),
  assessedByStaffId: integer('assessed_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  prevGrade: conditionGradeEnum('prev_grade'),
  newGrade: conditionGradeEnum('new_grade').notNull(),
  cosmeticNotes: text('cosmetic_notes'),
  functionalNotes: text('functional_notes'),
  inventoryEventId: bigint('inventory_event_id', { mode: 'number' }).references(() => inventoryEvents.id, { onDelete: 'set null' }),
});

/**
 * failure_modes — defect taxonomy (lookup). `code` is the stable key; a mode
 * may cap the best assignable grade (advisory). See 2026-06-07_failure_modes.sql.
 */
export const failureModes = pgTable('failure_modes', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  label: text('label').notNull(),
  category: text('category').notNull().default('hardware'),
  severity: text('severity').notNull().default('major'),
  isRepairable: boolean('is_repairable').notNull().default(true),
  typicalCostCents: integer('typical_cost_cents'),
  capsGradeAt: conditionGradeEnum('caps_grade_at'),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * unit_failure_tags — per-serial defect tags. Opened (open) then resolved.
 * At most one OPEN tag per (unit, mode) — auto-tag-on-fail stays idempotent.
 */
export const unitFailureTags = pgTable('unit_failure_tags', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  serialUnitId: integer('serial_unit_id').notNull().references(() => serialUnits.id, { onDelete: 'cascade' }),
  failureModeId: integer('failure_mode_id').notNull().references(() => failureModes.id),
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
  detectedByStaffId: integer('detected_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  source: text('source').notNull().default('manual'),
  resolutionStatus: text('resolution_status').notNull().default('open'),
  inventoryEventId: bigint('inventory_event_id', { mode: 'number' }).references(() => inventoryEvents.id, { onDelete: 'set null' }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Set when a completed repair resolved this tag (2026-06-07_unit_repairs.sql).
  resolvedRepairId: integer('resolved_repair_id').references(() => unitRepairs.id, { onDelete: 'set null' }),
});

/**
 * unit_repairs — per-serial repair records (Phase 3). Opened then
 * completed/failed/scrapped; carries parts/cost/labor and cross-links the
 * REPAIR_STARTED / REPAIR_COMPLETED events. `repair_service_id` bridges the
 * legacy intake table. See 2026-06-07_unit_repairs.sql.
 */
export const unitRepairs = pgTable('unit_repairs', {
  id: serial('id').primaryKey(),
  serialUnitId: integer('serial_unit_id').notNull().references(() => serialUnits.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending'),
  summary: text('summary').notNull(),
  partsUsed: jsonb('parts_used'),
  laborMinutes: integer('labor_minutes'),
  costCents: integer('cost_cents'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  startedByStaffId: integer('started_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  completedByStaffId: integer('completed_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  rmaId: integer('rma_id'),
  repairServiceId: integer('repair_service_id'),
  startEventId: bigint('start_event_id', { mode: 'number' }).references(() => inventoryEvents.id, { onDelete: 'set null' }),
  doneEventId: bigint('done_event_id', { mode: 'number' }).references(() => inventoryEvents.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** repair_failure_resolutions — which failure modes a repair addresses. */
export const repairFailureResolutions = pgTable('repair_failure_resolutions', {
  repairId: integer('repair_id').notNull().references(() => unitRepairs.id, { onDelete: 'cascade' }),
  failureModeId: integer('failure_mode_id').notNull().references(() => failureModes.id),
}, (t) => ({
  pk: primaryKey({ columns: [t.repairId, t.failureModeId] }),
}));

/**
 * unit_quality_scores — derived per-unit quality projection (Phase 4). A cache
 * of qualityScore.ts output; rebuildable by the backfill script, never SoT.
 * See 2026-06-07_unit_quality_scores.sql.
 */
export const unitQualityScores = pgTable('unit_quality_scores', {
  serialUnitId: integer('serial_unit_id').primaryKey().references(() => serialUnits.id, { onDelete: 'cascade' }),
  qualityScore: integer('quality_score').notNull(),
  riskLevel: text('risk_level').notNull().default('medium'),
  riskReasons: jsonb('risk_reasons').notNull().default('[]'),
  ebayConditionId: text('ebay_condition_id'),
  gradeAtScore: conditionGradeEnum('grade_at_score'),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * testing_results — append-only log of per-unit testing verdicts (2026-05-29).
 * Powers the "Recently Tested" feed: one row per verdict click. References the
 * serial unit by id ONLY — serial number / SKU / condition are JOINed from
 * serial_units (single source of truth, written by the receiving pipeline),
 * never duplicated here. Authoritative current state lives on
 * serial_units.current_status; this is history, keyed by created_at.
 *
 * verdict ∈ PASS | TEST_AGAIN | TESTING_FAILED (CHECK constraint)
 * Writer: src/app/api/serial-units/[id]/test/route.ts
 */
export const testingResults = pgTable('testing_results', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  /** The serial unit under test — the only serial reference. */
  serialUnitId: integer('serial_unit_id').references(() => serialUnits.id, { onDelete: 'set null' }),
  receivingLineId: integer('receiving_line_id').references(() => receivingLines.id, { onDelete: 'set null' }),
  /** PASS | TEST_AGAIN | TESTING_FAILED */
  verdict: text('verdict').notNull(),
  /** serial_status the verdict mapped to: TESTED | IN_TEST | ON_HOLD. */
  unitStatus: text('unit_status'),
  testedBy: integer('tested_by').references(() => staff.id, { onDelete: 'set null' }),
  notes: text('notes'),
  inventoryEventId: bigint('inventory_event_id', { mode: 'number' }).references(() => inventoryEvents.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * order_unit_allocations — reservation of a specific serialized unit to an
 * order line. Enforces "one live allocation per unit" via DEFERRABLE UNIQUE
 * on serial_unit_id WHERE state != 'RELEASED'. Released rows stay for history.
 *
 * state ∈ ALLOCATED | PICKED | PACKED | SHIPPED | RELEASED
 */
export const orderUnitAllocations = pgTable('order_unit_allocations', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'restrict' }),
  serialUnitId: integer('serial_unit_id').notNull().references(() => serialUnits.id, { onDelete: 'restrict' }),
  allocatedAt: timestamp('allocated_at', { withTimezone: true }).notNull().defaultNow(),
  allocatedByStaffId: integer('allocated_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  state: text('state').notNull().default('ALLOCATED'),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  releasedReason: text('released_reason'),
});

/**
 * fba_shipment_item_units — links specific serialized units to FBA shipment
 * item lines. Tier-3 (serialized) FNSKU scans populate this; Tier-1/2 lines
 * remain pure quantity rows.
 */
export const fbaShipmentItemUnits = pgTable('fba_shipment_item_units', {
  fbaShipmentItemId: integer('fba_shipment_item_id').notNull().references(() => fbaShipmentItems.id, { onDelete: 'cascade' }),
  serialUnitId: integer('serial_unit_id').notNull().references(() => serialUnits.id, { onDelete: 'restrict' }),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  addedByStaffId: integer('added_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.fbaShipmentItemId, table.serialUnitId] }),
}));

/**
 * unit_id_sequences — per-SKU-per-year unit ID counter for GS1 unit labels.
 * Format: {SKU_SHORT}-{YEAR}-{NEXT_SEQ:06}. Updated atomically in a single
 * UPDATE … RETURNING; never read without writing.
 */
export const unitIdSequences = pgTable('unit_id_sequences', {
  skuCatalogId: integer('sku_catalog_id').notNull().references(() => skuCatalog.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  nextSeq: integer('next_seq').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.skuCatalogId, table.year] }),
}));

// ──────────────────────────────────────────────

export const aiChatSessions = pgTable('ai_chat_sessions', {
  organizationId: orgIdCol(),
  id: text('id').primaryKey(),                     // client-generated session ID (e.g. "oc-...")
  title: text('title'),                             // auto-generated from first message
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  updatedIdx: index('ai_chat_sessions_updated_idx').on(table.updatedAt),
}));

export const aiChatMessages = pgTable('ai_chat_messages', {
  organizationId: orgIdCol(),
  id: serial('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => aiChatSessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),                     // 'user' | 'assistant'
  content: text('content').notNull(),
  mode: text('mode'),                               // 'local_ops' | 'rag' | 'hybrid' | 'assistant'
  analysis: jsonb('analysis'),                      // AiStructuredAnswer JSON
  error: boolean('error').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sessionIdx: index('ai_chat_messages_session_idx').on(table.sessionId),
}));

export type AiChatSession = typeof aiChatSessions.$inferSelect;
export type NewAiChatSession = typeof aiChatSessions.$inferInsert;
export type AiChatMessage = typeof aiChatMessages.$inferSelect;
export type NewAiChatMessage = typeof aiChatMessages.$inferInsert;

export const receivingClaimSellerMessages = pgTable('receiving_claim_seller_messages', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organizationId: orgIdCol(),
  receivingId: integer('receiving_id').notNull().references(() => receiving.id, { onDelete: 'cascade' }),
  receivingLineId: integer('receiving_line_id').references(() => receivingLines.id, { onDelete: 'cascade' }),
  zendeskTicketId: bigint('zendesk_ticket_id', { mode: 'number' }),
  sellerMessage: text('seller_message').notNull(),
  subjectSnapshot: text('subject_snapshot'),
  model: text('model'),
  createdBy: integer('created_by').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ReceivingClaimSellerMessage = typeof receivingClaimSellerMessages.$inferSelect;
export type NewReceivingClaimSellerMessage = typeof receivingClaimSellerMessages.$inferInsert;

// SKU Catalog type exports
export type SkuCatalog = typeof skuCatalog.$inferSelect;
export type NewSkuCatalog = typeof skuCatalog.$inferInsert;
export type SkuPlatformId = typeof skuPlatformIds.$inferSelect;
export type NewSkuPlatformId = typeof skuPlatformIds.$inferInsert;
export type SkuKitPart = typeof skuKitParts.$inferSelect;
export type NewSkuKitPart = typeof skuKitParts.$inferInsert;
export type QcCheckTemplate = typeof qcCheckTemplates.$inferSelect;
export type NewQcCheckTemplate = typeof qcCheckTemplates.$inferInsert;
export type TechVerification = typeof techVerifications.$inferSelect;
export type NewTechVerification = typeof techVerifications.$inferInsert;

// Inventory v2 type exports
export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;
export type BinContent = typeof binContents.$inferSelect;
export type NewBinContent = typeof binContents.$inferInsert;
export type LocationTransfer = typeof locationTransfers.$inferSelect;
export type NewLocationTransfer = typeof locationTransfers.$inferInsert;
export type SerialUnit = typeof serialUnits.$inferSelect;
export type NewSerialUnit = typeof serialUnits.$inferInsert;
export type SkuStockLedgerRow = typeof skuStockLedger.$inferSelect;
export type NewSkuStockLedgerRow = typeof skuStockLedger.$inferInsert;
export type InventoryEvent = typeof inventoryEvents.$inferSelect;
export type NewInventoryEvent = typeof inventoryEvents.$inferInsert;
export type ReasonCode = typeof reasonCodes.$inferSelect;
export type NewReasonCode = typeof reasonCodes.$inferInsert;
export type PrinterProfile = typeof printerProfiles.$inferSelect;
export type NewPrinterProfile = typeof printerProfiles.$inferInsert;
export type StockAlert = typeof stockAlerts.$inferSelect;
export type NewStockAlert = typeof stockAlerts.$inferInsert;
export type CycleCountCampaign = typeof cycleCountCampaigns.$inferSelect;
export type NewCycleCountCampaign = typeof cycleCountCampaigns.$inferInsert;
export type CycleCountLine = typeof cycleCountLines.$inferSelect;
export type NewCycleCountLine = typeof cycleCountLines.$inferInsert;
export type SerialUnitConditionHistoryRow = typeof serialUnitConditionHistory.$inferSelect;
export type NewSerialUnitConditionHistoryRow = typeof serialUnitConditionHistory.$inferInsert;
export type OrderUnitAllocation = typeof orderUnitAllocations.$inferSelect;
export type NewOrderUnitAllocation = typeof orderUnitAllocations.$inferInsert;
export type TestingResult = typeof testingResults.$inferSelect;
export type NewTestingResult = typeof testingResults.$inferInsert;
export type FbaShipmentItemUnit = typeof fbaShipmentItemUnits.$inferSelect;
export type NewFbaShipmentItemUnit = typeof fbaShipmentItemUnits.$inferInsert;
export type UnitIdSequence = typeof unitIdSequences.$inferSelect;
export type NewUnitIdSequence = typeof unitIdSequences.$inferInsert;

// ─── Multi-tenancy (2026-05-22_organizations_tenancy.sql,
//                    2026-05-23_org_id_on_business_tables.sql) ─────────────
//
// Every business table carries `organization_id`. The column has a Postgres
// DEFAULT that reads from the `app.current_org` GUC, set by
// withTenantConnection — so application inserts don't have to specify the
// org explicitly, and queries that bypass the GUC fail loudly with a NOT
// NULL violation.
//
// The Drizzle helper below mirrors that column shape so $inferInsert treats
// `organizationId` as optional (the DB default fills it in).

// Tenant root. Every business table gets `organization_id` referencing this
// in the next migration. USAV is org #1 with a fixed UUID
// (see src/lib/tenancy/constants.ts).
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  plan: text('plan').notNull().default('trial'),
  status: text('status').notNull().default('active'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  // Phase F1: the org's billing/notification address (persisted at signup) —
  // used by Stripe checkout instead of the billing+slug@ placeholder fallback.
  billingEmail: text('billing_email'),
  // Tenant-wide config bag (branding, timezone, currency, label format, etc.)
  // Schema policed at the zod layer in src/lib/tenancy/settings.ts.
  settings: jsonb('settings').notNull().default(sql`'{}'::jsonb`),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  planIdx: index('idx_organizations_plan').on(table.plan),
  statusIdx: index('idx_organizations_status').on(table.status),
}));

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

// ─── Identity layer (2026-06-20e_identity_layer_phase1.sql) ──────────────────
// GLOBAL, tenant-agnostic tables. They are read at login, before any
// app.current_org GUC exists, so they intentionally carry NO tenant_isolation
// policy. See docs/identity-layer-plan.md.

// The human / global login identity.
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  primaryEmail: text('primary_email'),
  displayName: text('display_name'),
  status: text('status').notNull().default('active'),     // active | suspended | deleted
  kind: text('kind').notNull().default('human'),          // human | service
  passwordHash: text('password_hash'),
  ssoProvider: text('sso_provider'),
  ssoSubject: text('sso_subject'),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// Verified emails — the cross-org match key (lower(email) unique).
export const accountEmails = pgTable('account_emails', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  emailUniq: uniqueIndex('uq_account_emails_email').on(sql`lower(${table.email})`),
  accountIdx: index('idx_account_emails_account').on(table.accountId),
}));

// Federated logins (google/microsoft/saml/oidc/password).
export const accountIdentities = pgTable('account_identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  subject: text('subject').notNull(),
  emailAtLink: text('email_at_link'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  providerSubjectUniq: uniqueIndex('uq_account_identities_provider_subject').on(table.provider, table.subject),
  accountIdx: index('idx_account_identities_account').on(table.accountId),
}));

// Passkeys, lifted from per-staff to per-account.
export const webauthnCredentials = pgTable('webauthn_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  credentialId: text('credential_id').notNull().unique(),
  publicKey: text('public_key').notNull(),
  signCount: bigint('sign_count', { mode: 'number' }).notNull().default(0),
  transports: text('transports').array(),
  aaguid: uuid('aaguid'),
  label: text('label'),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  accountIdx: index('idx_webauthn_credentials_account').on(table.accountId),
}));

// TOTP + recovery codes.
export const accountMfa = pgTable('account_mfa', {
  accountId: uuid('account_id').primaryKey().references(() => accounts.id, { onDelete: 'cascade' }),
  totpSecret: text('totp_secret'),
  recoveryCodes: text('recovery_codes').array(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
});

// Append-only auth audit.
export const authEvents = pgTable('auth_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  orgId: uuid('org_id'),
  event: text('event').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  accountIdx: index('idx_auth_events_account').on(table.accountId, table.createdAt),
}));

// account × org bridge — the authoritative "who belongs where".
export const memberships = pgTable('memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('active'),  // invited | active | suspended | removed
  invitedBy: uuid('invited_by').references(() => accounts.id),
  joinedAt: timestamp('joined_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  accountOrgUniq: uniqueIndex('uq_memberships_account_org').on(table.accountId, table.orgId),
  orgIdx: index('idx_memberships_org').on(table.orgId),
  accountIdx: index('idx_memberships_account').on(table.accountId),
}));

// Invite-by-email on-ramp (the account may not exist yet).
export const orgInvitations = pgTable('org_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  roleKey: text('role_key'),
  tokenHash: text('token_hash').notNull(),
  invitedBy: uuid('invited_by').references(() => accounts.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgIdx: index('idx_org_invitations_org').on(table.orgId),
  emailIdx: index('idx_org_invitations_email').on(sql`lower(${table.email})`),
}));

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
export type OrgInvitation = typeof orgInvitations.$inferSelect;

// eBay API Calls audit logger table
export const ebayApiCalls = pgTable('ebay_api_calls', {
  id: serial('id').primaryKey(),
  organizationId: orgIdCol(),
  endpoint: text('endpoint').notNull(),
  method: text('method').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  statusCode: integer('status_code').notNull(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgIdx: index('idx_ebay_api_calls_organization').on(table.organizationId),
}));


export const pgVector = customType<{ data: number[] }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: unknown): number[] {
    if (typeof value === 'string') {
      return value.slice(1, -1).split(',').map(Number);
    }
    return value as number[];
  }
});

export const ragDocuments = pgTable('rag_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: orgIdCol(),
  fileName: text('file_name').notNull(),
  fileSize: integer('file_size').notNull(),
  mimeType: text('mime_type').notNull(),
  filePath: text('file_path').notNull(),
  chunkCount: integer('chunk_count').notNull().default(0),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgIdx: index('idx_rag_documents_organization_id').on(table.organizationId),
}));

export const ragDocumentChunks = pgTable('rag_document_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id')
    .notNull()
    .references(() => ragDocuments.id, { onDelete: 'cascade' }),
  organizationId: orgIdCol(),
  text: text('text').notNull(),
  embedding: pgVector('embedding').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
}, (table) => ({
  orgIdx: index('idx_rag_document_chunks_organization_id').on(table.organizationId),
  docIdx: index('idx_rag_document_chunks_document_id').on(table.documentId),
}));

// ─── Workflow graph layer ─────────────────────────────────────
//
// Node-based "Operations" engine (see docs/operations-studio/NODE_WORKFLOW_ARCHITECTURE.md and
// docs/operations-studio/NODE_WORKFLOW_IMPLEMENTATION_PLAN.md). These tables hold the GRAPH
// definition (which node connects to which, with conditional routing) and a
// pointer into the existing item state machine (serial_units +
// station_activity_logs). They add no behavior on their own — the engine in
// src/lib/workflow reads/writes them; domain logic stays in src/lib/*.

// workflow_definitions — one named, versioned graph per org. Only one row per
// (org, name) is is_active; publishing a new version flips the flag.
export const workflowDefinitions = pgTable('workflow_definitions', {
  id: serial('id').primaryKey(),
  organizationId: orgIdCol(),
  name: text('name').notNull(),
  version: integer('version').notNull().default(1),
  isActive: boolean('is_active').notNull().default(false),
  // Canvas sticky-note decorations (Studio ST6 / Phase E3): array of
  // { id, text, x, y, color? }. NOT engine nodes — a pure canvas layer that
  // rides with the definition row (copied on draft-fork, published atomically).
  annotations: jsonb('annotations').notNull().default(sql`'[]'::jsonb`),
  createdBy: integer('created_by').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgIdx: index('idx_workflow_definitions_organization_id').on(table.organizationId),
  orgNameVersionIdx: uniqueIndex('ux_workflow_definitions_org_name_version').on(
    table.organizationId,
    table.name,
    table.version,
  ),
}));

// workflow_nodes — one row per node on the canvas. `type` is the registry key
// (e.g. 'inspection'); `config` is the per-node form state; position is React
// Flow coordinates.
export const workflowNodes = pgTable('workflow_nodes', {
  id: text('id').primaryKey(), // canvas node uuid (client-generated)
  workflowDefinitionId: integer('workflow_definition_id')
    .notNull()
    .references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  positionX: numeric('position_x').notNull(),
  positionY: numeric('position_y').notNull(),
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
}, (table) => ({
  defIdx: index('idx_workflow_nodes_definition_id').on(table.workflowDefinitionId),
}));

// workflow_edges — a connection from a node's named output port to another
// node. The (sourceNode, sourcePort) pair is what drives conditional routing:
// an inspection node's 'fail' port edge points at the repair node.
export const workflowEdges = pgTable('workflow_edges', {
  id: text('id').primaryKey(),
  workflowDefinitionId: integer('workflow_definition_id')
    .notNull()
    .references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  sourceNode: text('source_node').notNull(),
  sourcePort: text('source_port').notNull(),
  targetNode: text('target_node').notNull(),
}, (table) => ({
  defIdx: index('idx_workflow_edges_definition_id').on(table.workflowDefinitionId),
  sourceIdx: index('idx_workflow_edges_source').on(
    table.workflowDefinitionId,
    table.sourceNode,
    table.sourcePort,
  ),
}));

// workflow_templates — system-owned graph blueprints (Studio ST6 / Phase E4).
// DELIBERATELY GLOBAL / cross-tenant: no organization_id, not RLS-enforced —
// these are shared default flows a tenant CLONES into its own
// workflow_definitions (re-minted ids, org-stamped) as an editable draft. The
// `graph` JSONB is the same { nodes, edges } shape the studio canvas paints.
export const workflowTemplates = pgTable('workflow_templates', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category'),
  // { nodes:[{id,type,x,y,config}], edges:[{id,source,sourcePort,target}] }
  graph: jsonb('graph').notNull().default(sql`'{"nodes":[],"edges":[]}'::jsonb`),
  isSystem: boolean('is_system').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  slugIdx: uniqueIndex('ux_workflow_templates_slug').on(table.slug),
}));

// item_workflow_state — where a given serial unit currently sits in its active
// workflow. One active row per unit (the unique index enforces it). `context`
// accumulates node outputs for downstream nodes to read.
export const itemWorkflowState = pgTable('item_workflow_state', {
  id: serial('id').primaryKey(),
  organizationId: orgIdCol(),
  serialUnitId: integer('serial_unit_id')
    .notNull()
    .references(() => serialUnits.id, { onDelete: 'cascade' }),
  workflowDefinitionId: integer('workflow_definition_id')
    .notNull()
    .references(() => workflowDefinitions.id),
  currentNodeId: text('current_node_id').notNull(),
  status: text('status').notNull().default('active'), // active | blocked | done | error
  context: jsonb('context').notNull().default(sql`'{}'::jsonb`),
  enteredNodeAt: timestamp('entered_node_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  activeUnitIdx: uniqueIndex('ux_item_workflow_state_unit').on(table.serialUnitId),
  orgIdx: index('idx_item_workflow_state_organization_id').on(table.organizationId),
  defStatusIdx: index('idx_item_workflow_state_definition_status').on(
    table.workflowDefinitionId,
    table.status,
  ),
}));

// workflow_runs — append-only log of every node execution, for observability
// (time-in-node, fail rates, bottlenecks). Mirrors the pipeline_cycles pattern.
export const workflowRuns = pgTable('workflow_runs', {
  id: serial('id').primaryKey(),
  organizationId: orgIdCol(),
  serialUnitId: integer('serial_unit_id').notNull(),
  workflowDefinitionId: integer('workflow_definition_id'),
  nodeType: text('node_type').notNull(),
  output: text('output'),
  durationMs: integer('duration_ms'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  unitIdx: index('idx_workflow_runs_serial_unit_id').on(table.serialUnitId),
  orgCreatedIdx: index('idx_workflow_runs_org_created').on(table.organizationId, table.createdAt),
}));

// workflow_node_stats — daily per-node queue-depth snapshots for the Studio
// Flow² lens (queue growth / age trends that a point-in-time query can't
// recover). Written by /api/cron/workflow-node-stats; idempotent per
// (definition, node, day). Time-in-node medians come from workflow_runs.
export const workflowNodeStats = pgTable('workflow_node_stats', {
  id: serial('id').primaryKey(),
  organizationId: orgIdCol(),
  workflowDefinitionId: integer('workflow_definition_id')
    .notNull()
    .references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  nodeId: text('node_id').notNull(),
  snapshotDate: date('snapshot_date').notNull(),
  queueDepth: integer('queue_depth').notNull().default(0),
  blockedCount: integer('blocked_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  // Captured daily THROUGHPUT: units that exited this node on snapshot_date
  // (derived from workflow_runs). SUM over a date range = throughput for the
  // range — see 2026-06-28n migration + node-stats.ts.
  completedCount: integer('completed_count').notNull().default(0),
  oldestEnteredAt: timestamp('oldest_entered_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  dayIdx: uniqueIndex('ux_workflow_node_stats_day').on(
    table.workflowDefinitionId,
    table.nodeId,
    table.snapshotDate,
  ),
  orgDateIdx: index('idx_workflow_node_stats_org_date').on(table.organizationId, table.snapshotDate),
}));

// station_definitions — layer 2 of the Operations Studio: one row per
// (page, mode) station composition, e.g. ('receiving', 'incoming'). `config`
// holds the ordered slots → block instances → source/action bindings (see
// docs/operations-studio/station-builder-ui-plan.md §2.4). Blocks/sources/
// actions are CODE (src/lib/stations registries); this table is the DATA.
// Versioning + is_active publish semantics copy workflow_definitions exactly:
// only one row per (org, page, mode) is active; publishing flips the flag.
export const stationDefinitions = pgTable('station_definitions', {
  id: serial('id').primaryKey(),
  organizationId: orgIdCol(),
  pageKey: text('page_key').notNull(), // 'receiving'
  modeKey: text('mode_key').notNull(), // 'incoming' — one row per sidebar mode
  label: text('label').notNull(),
  // Optional tie to the process graph (Studio zoom L2 opens this station).
  workflowNodeId: text('workflow_node_id'),
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
  version: integer('version').notNull().default(1),
  isActive: boolean('is_active').notNull().default(false),
  updatedBy: integer('updated_by').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgIdx: index('idx_station_definitions_organization_id').on(table.organizationId),
  orgPageModeVersionIdx: uniqueIndex('ux_station_definitions_org_page_mode_version').on(
    table.organizationId,
    table.pageKey,
    table.modeKey,
    table.version,
  ),
}));

// ─── Warranty Claim Logger + Repair Outcome Tracker ──────────────────────────
// 4th mode on the Orders / Shipping page. See 2026-06-06_warranty_claim_logger.sql
// and docs/warranty-claim-logger-plan.md. Clock logic: src/lib/warranty/clock.ts.

/**
 * warranty_claims — first-class warranty claim. The customer-facing record
 * (status, denial reason, warranty clock). Physical returns link out to
 * rma_authorizations (rma_id); repair handoff to repair_service.
 */
export const warrantyClaims = pgTable('warranty_claims', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organizationId: orgIdCol(),
  claimNumber: text('claim_number').notNull().unique(),
  serialUnitId: integer('serial_unit_id').references(() => serialUnits.id, { onDelete: 'set null' }),
  serialNumber: text('serial_number'),
  orderId: integer('order_id').references(() => orders.id, { onDelete: 'set null' }),
  sku: text('sku'),
  productTitle: text('product_title'),
  customerId: integer('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  sourceSystem: text('source_system'),
  sourceOrderId: text('source_order_id'),
  sourceTrackingNumber: text('source_tracking_number'),
  purchaseProofUrl: text('purchase_proof_url'),
  purchaseProofAttachmentId: text('purchase_proof_attachment_id'),
  purchasedAt: timestamp('purchased_at', { withTimezone: true }),
  /** Carrier DELIVERED date (from shipping_tracking_numbers) when known. */
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  /** Packed/scanned date — fallback clock anchor (+4d estimate). */
  packedScannedAt: timestamp('packed_scanned_at', { withTimezone: true }),
  warrantyStartsAt: timestamp('warranty_starts_at', { withTimezone: true }),
  warrantyExpiresAt: timestamp('warranty_expires_at', { withTimezone: true }),
  /** DELIVERED | PACKED_PLUS_ESTIMATE (provisional until a real delivered date lands). */
  clockBasis: text('clock_basis'),
  /** Term snapshot (per-org, default 30) at log time. */
  warrantyDays: integer('warranty_days'),
  /** LOGGED | SUBMITTED | APPROVED | DENIED | IN_REPAIR | REPAIRED | CLOSED | EXPIRED */
  status: text('status').notNull().default('LOGGED'),
  denialReasonCode: text('denial_reason_code').references(() => reasonCodes.code, { onDelete: 'set null' }),
  denialNotes: text('denial_notes'),
  rmaId: bigint('rma_id', { mode: 'number' }),
  repairServiceId: integer('repair_service_id').references(() => repairService.id, { onDelete: 'set null' }),
  /** Linked Zendesk ticket (created from this claim). See 2026-06-09_warranty_zendesk_link.sql. */
  zendeskTicketId: bigint('zendesk_ticket_id', { mode: 'number' }),
  notes: text('notes'),
  createdByStaffId: integer('created_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  /** Soft-delete tombstone — claims keep their event/audit trail, reads filter NULL. */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgIdx: index('idx_warranty_claims_org').on(table.organizationId),
  statusIdx: index('idx_warranty_claims_status').on(table.status),
}));

/**
 * warranty_claim_events — append-only per-claim timeline (status changes, notes,
 * attachments, notifications).
 */
export const warrantyClaimEvents = pgTable('warranty_claim_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organizationId: orgIdCol(),
  claimId: bigint('claim_id', { mode: 'number' }).notNull().references(() => warrantyClaims.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
  actorStaffId: integer('actor_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  claimIdx: index('idx_warranty_events_claim').on(table.claimId, table.createdAt),
}));

/**
 * warranty_repair_attempts — one row per repair attempt/outcome with parts-used
 * + photo attachments (NAS refs).
 */
export const warrantyRepairAttempts = pgTable('warranty_repair_attempts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organizationId: orgIdCol(),
  claimId: bigint('claim_id', { mode: 'number' }).notNull().references(() => warrantyClaims.id, { onDelete: 'cascade' }),
  attemptNo: integer('attempt_no').notNull().default(1),
  technicianStaffId: integer('technician_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  diagnosis: text('diagnosis'),
  partsUsed: jsonb('parts_used').notNull().default(sql`'[]'::jsonb`),
  /** FIXED | NOT_FIXABLE | PENDING_PARTS | RTV */
  outcome: text('outcome'),
  laborMinutes: integer('labor_minutes'),
  costParts: numeric('cost_parts', { precision: 12, scale: 2 }),
  costLabor: numeric('cost_labor', { precision: 12, scale: 2 }),
  photoAttachmentIds: jsonb('photo_attachment_ids').notNull().default(sql`'[]'::jsonb`),
  notes: text('notes'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  claimIdx: index('idx_warranty_repair_claim').on(table.claimId, table.attemptNo),
}));

/**
 * warranty_quotes — post-warranty paid-repair quote for a denied/expired claim.
 */
export const warrantyQuotes = pgTable('warranty_quotes', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organizationId: orgIdCol(),
  claimId: bigint('claim_id', { mode: 'number' }).notNull().references(() => warrantyClaims.id, { onDelete: 'cascade' }),
  quoteNumber: text('quote_number').notNull().unique(),
  lineItems: jsonb('line_items').notNull().default(sql`'[]'::jsonb`),
  subtotal: numeric('subtotal', { precision: 12, scale: 2 }),
  tax: numeric('tax', { precision: 12, scale: 2 }),
  total: numeric('total', { precision: 12, scale: 2 }),
  /** DRAFT | SENT | ACCEPTED | DECLINED | EXPIRED */
  status: text('status').notNull().default('DRAFT'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  createdByStaffId: integer('created_by_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  claimIdx: index('idx_warranty_quotes_claim').on(table.claimId),
  statusIdx: index('idx_warranty_quotes_status').on(table.status),
}));

export type WarrantyClaim = typeof warrantyClaims.$inferSelect;
export type NewWarrantyClaim = typeof warrantyClaims.$inferInsert;
export type WarrantyClaimEvent = typeof warrantyClaimEvents.$inferSelect;
export type WarrantyRepairAttempt = typeof warrantyRepairAttempts.$inferSelect;
export type WarrantyQuote = typeof warrantyQuotes.$inferSelect;

