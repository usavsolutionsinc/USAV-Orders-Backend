/**
 * Client- AND server-safe permission types and pure helpers.
 *
 * No DB imports. Anything that needs `pool` (e.g. `getStaffRole`,
 * `assertPermission`) lives in `permissions.ts` — re-exports the names
 * here for backwards-compatibility with existing imports.
 *
 * Why split? Importing `permissions.ts` into a client component used to
 * drag `pg` and its native deps (`fs`, `net`, `tls`, `dns`) into the
 * browser bundle. This module is safe to import anywhere.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type StaffRole =
  | 'packer'
  | 'receiver'
  | 'receiving'        // legacy alias for 'receiver'
  | 'technician'
  | 'sales'
  | 'shipper'
  | 'inventory_manager'
  | 'viewer'
  | 'readonly'         // legacy alias for 'viewer'
  | 'admin'
  | 'unknown';

const ROLE_ALIASES: Record<string, StaffRole> = {
  receiving: 'receiver',
  readonly:  'viewer',
};

export const ALL_ROLES: ReadonlyArray<Exclude<StaffRole, 'unknown' | 'receiving' | 'readonly'>> = [
  'admin', 'receiver', 'packer', 'technician', 'shipper', 'inventory_manager', 'sales', 'viewer',
];

export type PermissionAction =
  | 'bin.adjust'
  | 'bin.set'
  | 'bin.rename'
  | 'bin.swap'
  | 'bin.remove'
  | 'bin.add_sku'
  | 'cycle_count.approve';

export type PermissionString =
  | 'dashboard.view' | 'operations.view' | 'reports.view' | 'reports.export'
  | 'receiving.view' | 'receiving.scan_po' | 'receiving.mark_received'
  | 'receiving.upload_photo' | 'receiving.bin_assign'
  | 'packing.view' | 'packing.start_session' | 'packing.scan_order'
  | 'packing.print_label' | 'packing.complete_order'
  | 'tech.view' | 'tech.scan_serial' | 'tech.qc_pass' | 'tech.qc_fail' | 'tech.assign_bin'
  | 'repair.view' | 'repair.intake' | 'repair.mark_repaired'
  | 'shipping.view' | 'shipping.mark_shipped' | 'shipping.void_order'
  | 'orders.view' | 'orders.create' | 'orders.void'
  | 'fba.view' | 'fba.manage_fnskus' | 'fba.stage_shipments'
  | 'sku_stock.view' | 'sku_stock.adjust' | 'sku_stock.manage'
  | PermissionAction
  | 'cycle_count.view'
  | 'replenish.view' | 'replenish.create_po' | 'replenish.approve_po'
  | 'work_orders.view' | 'work_orders.claim' | 'work_orders.complete'
  | 'walk_in.view' | 'walk_in.intake'
  | 'print.label' | 'print.silent'
  | 'integrations.zoho' | 'integrations.ebay' | 'integrations.ecwid'
  | 'settings.workstation' | 'settings.hardware'
  | 'admin.view' | 'admin.manage_staff' | 'admin.manage_roles'
  | 'admin.manage_features' | 'admin.view_logs' | 'admin.view_sessions';

export const STEP_UP_PERMISSIONS: ReadonlySet<PermissionString> = new Set<PermissionString>([
  'shipping.void_order', 'orders.void',
  'bin.remove', 'bin.swap',
  'cycle_count.approve', 'replenish.approve_po',
]);

type CanonicalRole = Exclude<StaffRole, 'unknown' | 'receiving' | 'readonly'>;

const ROLE_PERMISSION_SETS: Record<Exclude<CanonicalRole, 'admin'>, ReadonlyArray<PermissionString>> = {
  receiver: [
    'receiving.view', 'receiving.scan_po', 'receiving.mark_received',
    'receiving.upload_photo', 'receiving.bin_assign',
    'sku_stock.view', 'bin.adjust', 'bin.set', 'bin.add_sku',
    'walk_in.view', 'print.label', 'work_orders.view', 'work_orders.claim',
    'work_orders.complete',
  ],
  packer: [
    'packing.view', 'packing.start_session', 'packing.scan_order',
    'packing.print_label', 'packing.complete_order',
    'sku_stock.view', 'bin.adjust', 'bin.set', 'bin.add_sku',
    'print.label', 'work_orders.view', 'work_orders.claim', 'work_orders.complete',
    'dashboard.view',
  ],
  technician: [
    'tech.view', 'tech.scan_serial', 'tech.qc_pass', 'tech.qc_fail', 'tech.assign_bin',
    'repair.view', 'repair.intake', 'repair.mark_repaired',
    'sku_stock.view', 'bin.adjust', 'bin.set', 'bin.add_sku',
    'print.label', 'work_orders.view', 'work_orders.claim', 'work_orders.complete',
  ],
  shipper: [
    'shipping.view', 'shipping.mark_shipped', 'shipping.void_order',
    'orders.view', 'dashboard.view', 'print.label',
  ],
  inventory_manager: [
    'sku_stock.view', 'sku_stock.adjust', 'sku_stock.manage',
    'bin.adjust', 'bin.set', 'bin.rename', 'bin.swap', 'bin.remove', 'bin.add_sku',
    'cycle_count.view', 'cycle_count.approve',
    'replenish.view', 'replenish.create_po', 'replenish.approve_po',
    'fba.view', 'reports.view', 'operations.view',
    'admin.view_logs',
  ],
  sales: [
    'dashboard.view', 'orders.view', 'orders.create',
    'walk_in.view', 'walk_in.intake',
    'sku_stock.view', 'repair.view', 'reports.view',
  ],
  viewer: [
    'dashboard.view', 'operations.view', 'receiving.view', 'packing.view',
    'tech.view', 'shipping.view', 'fba.view', 'sku_stock.view',
    'cycle_count.view', 'replenish.view', 'work_orders.view',
    'walk_in.view', 'repair.view', 'orders.view', 'reports.view',
  ],
};

export const ALL_PERMISSIONS = new Set<PermissionString>();
for (const perms of Object.values(ROLE_PERMISSION_SETS)) {
  for (const p of perms) ALL_PERMISSIONS.add(p);
}
for (const adminOnly of [
  'admin.view', 'admin.manage_staff', 'admin.manage_roles',
  'admin.manage_features', 'admin.view_logs', 'admin.view_sessions',
  'settings.workstation', 'settings.hardware',
  'integrations.zoho', 'integrations.ebay', 'integrations.ecwid',
  'fba.manage_fnskus', 'fba.stage_shipments',
  'reports.export', 'print.silent',
] as PermissionString[]) {
  ALL_PERMISSIONS.add(adminOnly);
}

const ROLE_PERMISSIONS_FULL: Record<CanonicalRole, ReadonlyArray<PermissionString>> = {
  ...ROLE_PERMISSION_SETS,
  admin: Array.from(ALL_PERMISSIONS),
};

const ACTION_NAMES = new Set<string>([
  'bin.adjust', 'bin.set', 'bin.rename', 'bin.swap', 'bin.remove', 'bin.add_sku', 'cycle_count.approve',
]);

function filterActions(perms: ReadonlyArray<PermissionString>): ReadonlyArray<PermissionAction> {
  return perms.filter((p): p is PermissionAction => ACTION_NAMES.has(p));
}

export const ROLE_PERMISSIONS: Record<Exclude<StaffRole, 'unknown'>, ReadonlyArray<PermissionAction>> = {
  packer:     filterActions(ROLE_PERMISSIONS_FULL.packer),
  receiving:  filterActions(ROLE_PERMISSIONS_FULL.receiver),
  receiver:   filterActions(ROLE_PERMISSIONS_FULL.receiver),
  technician: filterActions(ROLE_PERMISSIONS_FULL.technician),
  sales:      filterActions(ROLE_PERMISSIONS_FULL.sales),
  shipper:    filterActions(ROLE_PERMISSIONS_FULL.shipper),
  inventory_manager: filterActions(ROLE_PERMISSIONS_FULL.inventory_manager),
  viewer:     filterActions(ROLE_PERMISSIONS_FULL.viewer),
  readonly:   filterActions(ROLE_PERMISSIONS_FULL.viewer),
  admin:      filterActions(ROLE_PERMISSIONS_FULL.admin),
};

export function canonicalRole(role: StaffRole): CanonicalRole | 'unknown' {
  if (role === 'unknown') return 'unknown';
  const aliased = ROLE_ALIASES[role];
  return (aliased ?? role) as CanonicalRole;
}

export function permissionsForRole(role: StaffRole): ReadonlyArray<PermissionString> {
  const canonical = canonicalRole(role);
  if (canonical === 'unknown') return [];
  return ROLE_PERMISSIONS_FULL[canonical] ?? [];
}

export function permissionsSetForRole(role: StaffRole): Set<PermissionString> {
  return new Set(permissionsForRole(role));
}

/**
 * Effective permission set: role base ∪ added \ removed.
 *
 * - Admin always gets everything; overrides are ignored to prevent
 *   accidental self-lockout.
 * - Unknown strings in `added`/`removed` are silently dropped (the runtime
 *   shape stays narrow even if the DB row carries forward-compat values).
 */
export function effectivePermissions(
  role: StaffRole,
  added: ReadonlyArray<string> = [],
  removed: ReadonlyArray<string> = [],
): Set<PermissionString> {
  const canonical = canonicalRole(role);
  if (canonical === 'admin') return new Set(ROLE_PERMISSIONS_FULL.admin);

  const set = new Set(permissionsForRole(role));
  for (const raw of added) {
    if (ALL_PERMISSIONS.has(raw as PermissionString)) set.add(raw as PermissionString);
  }
  for (const raw of removed) {
    set.delete(raw as PermissionString);
  }
  return set;
}

/** Classifies a permission for the admin UI's "source" badge. */
export type PermissionSource = 'role' | 'granted' | 'revoked' | 'role-denies';

export function permissionSource(
  role: StaffRole,
  perm: PermissionString,
  added: ReadonlyArray<string> = [],
  removed: ReadonlyArray<string> = [],
): PermissionSource {
  const hasInRole = permissionsSetForRole(role).has(perm);
  const isAdded = added.includes(perm);
  const isRemoved = removed.includes(perm);
  if (hasInRole && isRemoved)   return 'revoked';
  if (hasInRole)                return 'role';
  if (isAdded)                  return 'granted';
  return 'role-denies';
}

export function hasPermissionString(role: StaffRole, perm: PermissionString): boolean {
  return permissionsSetForRole(role).has(perm);
}

export function requiresStepUp(perm: PermissionString): boolean {
  return STEP_UP_PERMISSIONS.has(perm);
}

/**
 * Pure helper: union the `permissions` arrays from a list of roles into a
 * typed Set, silently dropping any strings that aren't valid PermissionString
 * values. Used by both the server resolver and the admin UI (which computes
 * "effective permissions for staff" from a list of assigned-role rows
 * without round-tripping through the server).
 */
export function unionRolePermissions(
  roles: ReadonlyArray<{ permissions: ReadonlyArray<string> }>,
): Set<PermissionString> {
  const out = new Set<PermissionString>();
  for (const r of roles) {
    for (const p of r.permissions) {
      if (ALL_PERMISSIONS.has(p as PermissionString)) out.add(p as PermissionString);
    }
  }
  return out;
}

/**
 * Single source of truth for the role-editor UI grouping. The editor renders
 * one section per category in this order. New PermissionString values MUST
 * be added to a category here or they won't appear in the editor.
 */
export const PERMISSION_CATEGORIES: ReadonlyArray<{
  id: string;
  label: string;
  permissions: ReadonlyArray<PermissionString>;
}> = [
  { id: 'receiving', label: 'Receiving', permissions: [
    'receiving.view', 'receiving.scan_po', 'receiving.mark_received',
    'receiving.upload_photo', 'receiving.bin_assign',
  ] },
  { id: 'packing', label: 'Packing', permissions: [
    'packing.view', 'packing.start_session', 'packing.scan_order',
    'packing.print_label', 'packing.complete_order',
  ] },
  { id: 'tech', label: 'Tech & Repair', permissions: [
    'tech.view', 'tech.scan_serial', 'tech.qc_pass', 'tech.qc_fail', 'tech.assign_bin',
    'repair.view', 'repair.intake', 'repair.mark_repaired',
  ] },
  { id: 'shipping', label: 'Shipping & Orders', permissions: [
    'shipping.view', 'shipping.mark_shipped', 'shipping.void_order',
    'orders.view', 'orders.create', 'orders.void',
  ] },
  { id: 'fba', label: 'FBA', permissions: [
    'fba.view', 'fba.manage_fnskus', 'fba.stage_shipments',
  ] },
  { id: 'inventory', label: 'Inventory', permissions: [
    'sku_stock.view', 'sku_stock.adjust', 'sku_stock.manage',
    'bin.adjust', 'bin.set', 'bin.rename', 'bin.swap', 'bin.remove', 'bin.add_sku',
    'cycle_count.view', 'cycle_count.approve',
    'replenish.view', 'replenish.create_po', 'replenish.approve_po',
  ] },
  { id: 'ops', label: 'Operations & Reports', permissions: [
    'dashboard.view', 'operations.view',
    'work_orders.view', 'work_orders.claim', 'work_orders.complete',
    'walk_in.view', 'walk_in.intake',
    'reports.view', 'reports.export',
    'print.label', 'print.silent',
  ] },
  { id: 'integrations', label: 'Integrations', permissions: [
    'integrations.zoho', 'integrations.ebay', 'integrations.ecwid',
  ] },
  { id: 'admin', label: 'Admin', permissions: [
    'settings.workstation', 'settings.hardware',
    'admin.view', 'admin.manage_staff', 'admin.manage_roles',
    'admin.manage_features', 'admin.view_logs', 'admin.view_sessions',
  ] },
];

export function hasPermission(role: StaffRole, action: PermissionAction): boolean {
  if (role === 'unknown') return false;
  const canonical = canonicalRole(role);
  if (canonical === 'unknown' || canonical === 'viewer') return false;
  return ROLE_PERMISSIONS[canonical].includes(action);
}

export class PermissionDeniedError extends Error {
  constructor(
    public readonly action: PermissionAction,
    public readonly role: StaffRole,
    public readonly staffId: number | null,
  ) {
    super(`Role "${role}" cannot perform "${action}"`);
    this.name = 'PermissionDeniedError';
  }
}

export function permissionDeniedResponse(err: PermissionDeniedError) {
  return {
    error: 'FORBIDDEN',
    action: err.action,
    role: err.role,
    message: `Your role (${err.role}) cannot perform this action.`,
  };
}
