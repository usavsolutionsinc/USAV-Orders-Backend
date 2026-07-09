/**
 * Single source of truth for all permissions the application knows about.
 *
 * Every other shape — the `PermissionString` union, `ALL_PERMISSIONS` set,
 * `STEP_UP_PERMISSIONS` set, the `PERMISSION_CATEGORIES` UI grouping —
 * derives from this array. Adding a new permission anywhere requires only
 * appending a row here.
 *
 * Why this exists (replaces the previous split between PermissionString,
 * ROLE_PERMISSION_SETS, ALL_PERMISSIONS, and PERMISSION_CATEGORIES):
 *
 *   - The old `ALL_PERMISSIONS` set was built by iterating the seed role
 *     matrix. Permissions registered in `PermissionString` but never granted
 *     by any role were silently absent from `ALL_PERMISSIONS`, and any DB
 *     row referencing them would be dropped at request time with no warning.
 *
 *   - `PERMISSION_CATEGORIES` was a third hand-curated list. Adding a new
 *     permission required touching three places, and the editor would skip
 *     unregistered permissions silently.
 *
 * Now: one array, derived everywhere. Drift between the type and the runtime
 * is impossible.
 *
 * Conventions:
 *   - `id`         : the wire/permission string (also the literal in the type union).
 *   - `category`   : maps to the section in the Roles editor UI; group leaves with the same id.
 *   - `label`      : human-readable name shown in the editor.
 *   - `destructive`: hint for UI confirm dialogs and the future audit script.
 *   - `stepUp`     : if true, withAuth() requires a fresh PIN/passkey grant before the handler runs.
 */

// ─── Categories (UI grouping order is preserved) ────────────────────────────

export const PERMISSION_CATEGORY_DEFS = [
  { id: 'receiving',    label: 'Receiving' },
  { id: 'packing',      label: 'Packing' },
  { id: 'tech',         label: 'Tech & Repair' },
  { id: 'shipping',     label: 'Shipping & Orders' },
  { id: 'fba',          label: 'FBA' },
  { id: 'inventory',    label: 'Inventory' },
  { id: 'sourcing',     label: 'Sourcing' },
  { id: 'ops',          label: 'Operations & Reports' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'admin',        label: 'Admin' },
] as const;

export type PermissionCategoryId = (typeof PERMISSION_CATEGORY_DEFS)[number]['id'];

// ─── The single registry ────────────────────────────────────────────────────

interface PermissionDef<T extends string = string> {
  id: T;
  category: PermissionCategoryId;
  label: string;
  destructive?: boolean;
  stepUp?: boolean;
}

/**
 * Order within each category sets the order shown in the Roles editor. To
 * add a new permission: append a row with the right category. To make it
 * step-up-protected, set `stepUp: true`.
 */
export const PERMISSIONS = [
  // ─ Receiving ─
  { id: 'receiving.view',           category: 'receiving', label: 'View receiving' },
  { id: 'receiving.scan_po',        category: 'receiving', label: 'Scan PO' },
  { id: 'receiving.mark_received',  category: 'receiving', label: 'Mark received' },
  { id: 'receiving.upload_photo',   category: 'receiving', label: 'Upload receiving photo' },
  { id: 'receiving.bin_assign',     category: 'receiving', label: 'Assign bin from receiving' },
  { id: 'handling_unit.view',       category: 'receiving', label: 'View handling units (boxes / LPN)' },
  { id: 'handling_unit.manage',     category: 'receiving', label: 'Manage handling units (mint, assign, move)' },

  // ─ Packing ─
  { id: 'packing.view',             category: 'packing', label: 'View packing' },
  { id: 'packing.start_session',    category: 'packing', label: 'Start packing session' },
  { id: 'packing.scan_order',       category: 'packing', label: 'Scan order to pack' },
  { id: 'packing.print_label',      category: 'packing', label: 'Print packing label' },
  { id: 'packing.complete_order',   category: 'packing', label: 'Complete packed order' },
  { id: 'packing.substitute_unit',  category: 'packing', label: 'Substitute fulfilled unit' },
  { id: 'packing.approve_amendment', category: 'packing', label: 'Approve substitution amendment' },

  // ─ Tech & Repair ─
  { id: 'tech.view',                category: 'tech', label: 'View tech station' },
  { id: 'tech.scan_serial',         category: 'tech', label: 'Scan serial' },
  { id: 'tech.qc_pass',             category: 'tech', label: 'QC pass' },
  { id: 'tech.qc_fail',             category: 'tech', label: 'QC fail' },
  { id: 'tech.data_wipe',           category: 'tech', label: 'Data wipe (secure erase)' },
  { id: 'tech.assign_bin',          category: 'tech', label: 'Assign bin from tech' },
  { id: 'serial_units.grade',       category: 'tech', label: 'Grade serial unit (condition)' },
  { id: 'repair.view',              category: 'tech', label: 'View repair queue' },
  { id: 'repair.intake',            category: 'tech', label: 'Intake repair' },
  { id: 'repair.mark_repaired',     category: 'tech', label: 'Mark repaired' },
  { id: 'repair.pickup_sign',       category: 'tech', label: 'Sign for repair pickup' },

  // ─ Shipping & Orders ─
  { id: 'shipping.view',            category: 'shipping', label: 'View shipping' },
  { id: 'shipping.mark_shipped',    category: 'shipping', label: 'Mark shipped' },
  { id: 'shipping.void_order',      category: 'shipping', label: 'Void shipment', destructive: true, stepUp: true },
  { id: 'shipping.buy_label',       category: 'shipping', label: 'Buy shipping label (rate-shop + purchase)' },
  { id: 'shipping.void_label',      category: 'shipping', label: 'Void shipping label', destructive: true, stepUp: true },
  { id: 'orders.view',              category: 'shipping', label: 'View orders' },
  { id: 'orders.create',            category: 'shipping', label: 'Create orders' },
  { id: 'orders.import',            category: 'shipping', label: 'Import orders (Google Sheets + Ecwid)' },
  { id: 'inventory.list_unit',      category: 'shipping', label: 'List a unit on a sales channel' },
  { id: 'orders.void',              category: 'shipping', label: 'Void order', destructive: true, stepUp: true },
  { id: 'warranty.view',            category: 'shipping', label: 'View warranty claims' },
  { id: 'warranty.manage',          category: 'shipping', label: 'Manage warranty claims (log / lifecycle / quote)' },
  { id: 'warranty.repair',          category: 'shipping', label: 'Log warranty repair attempts' },
  { id: 'rma.view',                 category: 'shipping', label: 'View RMA authorizations' },
  { id: 'rma.manage',               category: 'shipping', label: 'Manage RMA authorizations (issue / receive / disposition / close / cancel)' },

  // ─ FBA ─
  { id: 'fba.view',                 category: 'fba', label: 'View FBA' },
  { id: 'fba.manage_fnskus',        category: 'fba', label: 'Manage FNSKUs' },
  { id: 'fba.stage_shipments',      category: 'fba', label: 'Stage FBA shipments' },

  // ─ Inventory ─
  { id: 'sku_stock.view',           category: 'inventory', label: 'View SKU stock' },
  { id: 'sku_stock.adjust',         category: 'inventory', label: 'Adjust SKU stock' },
  { id: 'sku_stock.manage',         category: 'inventory', label: 'Manage SKU stock' },
  { id: 'bin.adjust',               category: 'inventory', label: 'Adjust bin' },
  { id: 'bin.set',                  category: 'inventory', label: 'Set bin' },
  { id: 'bin.rename',               category: 'inventory', label: 'Rename bin' },
  { id: 'bin.swap',                 category: 'inventory', label: 'Swap bins', destructive: true, stepUp: true },
  { id: 'bin.remove',               category: 'inventory', label: 'Remove bin', destructive: true, stepUp: true },
  { id: 'bin.add_sku',              category: 'inventory', label: 'Add SKU to bin' },
  { id: 'cycle_count.view',         category: 'inventory', label: 'View cycle counts' },
  { id: 'cycle_count.approve',      category: 'inventory', label: 'Approve cycle count', destructive: true, stepUp: true },
  // 'replenish.view' was collapsed into 'sku_stock.view' when replenish moved
  // into the inventory page. The create/approve PO actions below stay distinct.
  { id: 'replenish.create_po',      category: 'inventory', label: 'Create replenishment PO' },
  { id: 'replenish.approve_po',     category: 'inventory', label: 'Approve replenishment PO', destructive: true, stepUp: true },
  { id: 'stock_alerts.ack',          category: 'inventory', label: 'Acknowledge stock alerts' },

  // ─ Sourcing (Bose parts compatibility + alternative sourcing engine) ─
  { id: 'sourcing.view',            category: 'sourcing', label: 'View sourcing & compatibility' },
  { id: 'sourcing.manage',          category: 'sourcing', label: 'Edit compatibility, models & alerts' },
  { id: 'sourcing.search',          category: 'sourcing', label: 'Run secondary-market searches' },
  { id: 'sourcing.import',          category: 'sourcing', label: 'Import a sourcing candidate into inventory', destructive: true },
  { id: 'supplier.view',            category: 'sourcing', label: 'View suppliers' },
  { id: 'supplier.manage',          category: 'sourcing', label: 'Manage suppliers' },

  // ─ Operations & Reports ─
  { id: 'dashboard.view',           category: 'ops', label: 'View dashboard' },
  { id: 'operations.view',          category: 'ops', label: 'View operations' },
  { id: 'operations.plans.view',    category: 'ops', label: 'View strategic ops plans & inbox' },
  { id: 'operations.plans.manage',  category: 'ops', label: 'Create and manage ops plans' },
  { id: 'operations.plans.claim',   category: 'ops', label: 'Claim and complete assigned plan tasks' },
  { id: 'ai.search',                category: 'ops', label: 'AI search retrieval (⌘K hybrid search + Ask AI)' },
  { id: 'assistant.chat',           category: 'ops', label: 'Use the operations assistant (global AI dock)' },
  { id: 'photos.view',              category: 'ops', label: 'View media library' },
  { id: 'photos.share',             category: 'ops', label: 'Create media share links' },
  { id: 'photos.manage',            category: 'ops', label: 'Manage media library (labels, folders, organize)' },
  { id: 'work_orders.view',         category: 'ops', label: 'View work orders' },
  { id: 'work_orders.claim',        category: 'ops', label: 'Claim work order' },
  { id: 'work_orders.complete',     category: 'ops', label: 'Complete work order' },
  { id: 'walk_in.view',             category: 'ops', label: 'View walk-ins' },
  { id: 'walk_in.intake',           category: 'ops', label: 'Intake walk-in' },
  { id: 'stations.manage',          category: 'ops', label: 'Customize station pages (blocks, publish)' },
  { id: 'studio.view',              category: 'ops', label: 'View Operations Studio' },
  // Step-up is enforced on the PUBLISH route only (withAuth stepUp: true) so
  // ordinary draft edits don't prompt for a PIN every five minutes.
  { id: 'studio.manage',            category: 'ops', label: 'Edit & publish Operations Studio workflows' },
  // Item-level recovery is distinct from graph authoring: a floor lead can
  // unpark a stuck unit (blocked/error → active) without being able to edit or
  // publish workflows. Non-destructive + reversible (a re-park is one scan away),
  // so it's friction-free — no stepUp.
  { id: 'studio.recover',           category: 'ops', label: 'Recover stuck workflow items (unpark)' },
  { id: 'reports.view',             category: 'ops', label: 'View reports' },
  { id: 'reports.export',           category: 'ops', label: 'Export reports' },
  { id: 'print.label',              category: 'ops', label: 'Print labels' },
  { id: 'print.silent',             category: 'ops', label: 'Silent print' },
  { id: 'label.manifest.manage',    category: 'ops', label: 'Create / seal / dissolve label manifests' },

  // ─ Integrations ─
  { id: 'integrations.zoho',        category: 'integrations', label: 'Manage Zoho integration' },
  { id: 'integrations.ebay',        category: 'integrations', label: 'Manage eBay integration' },
  { id: 'integrations.amazon',      category: 'integrations', label: 'Manage Amazon integration' },
  { id: 'integrations.ecwid',       category: 'integrations', label: 'Manage Ecwid integration' },
  { id: 'integrations.sheets',      category: 'integrations', label: 'Trigger Google Sheets sync' },
  { id: 'integrations.google_drive', category: 'integrations', label: 'Manage Google Drive photo backup' },
  { id: 'integrations.zendesk',     category: 'integrations', label: 'Manage Zendesk tickets' },

  // ─ Product manuals (cross-cutting, lives under "data sources" admin tab) ─
  { id: 'product_manuals.manage',   category: 'integrations', label: 'Manage product manuals (assign, upsert, sync)' },

  // ─ Admin ─
  { id: 'settings.workstation',     category: 'admin', label: 'Workstation settings' },
  { id: 'settings.hardware',        category: 'admin', label: 'Hardware settings' },
  { id: 'admin.view',               category: 'admin', label: 'View admin' },
  { id: 'admin.manage_staff',       category: 'admin', label: 'Manage staff' },
  { id: 'admin.manage_roles',       category: 'admin', label: 'Manage roles' },
  { id: 'admin.manage_features',    category: 'admin', label: 'Manage features' },
  { id: 'admin.view_logs',          category: 'admin', label: 'View admin logs' },
  { id: 'admin.view_sessions',      category: 'admin', label: 'View active sessions' },
] as const satisfies ReadonlyArray<PermissionDef>;

// ─── Derived shapes ─────────────────────────────────────────────────────────

/** The wire/runtime permission string. Derived from the registry — adding to PERMISSIONS automatically widens this union. */
export type RegistryPermissionString = (typeof PERMISSIONS)[number]['id'];

/** Runtime set used by mergePermissions / route validators to drop unknown strings. */
export const REGISTRY_ALL_PERMISSIONS: ReadonlySet<RegistryPermissionString> = new Set(
  PERMISSIONS.map((p) => p.id),
);

/** Permissions that require a fresh step-up grant before the handler runs. */
export const REGISTRY_STEP_UP_PERMISSIONS: ReadonlySet<RegistryPermissionString> = new Set(
  PERMISSIONS.filter((p): p is typeof p & { stepUp: true } => (p as PermissionDef).stepUp === true).map((p) => p.id),
);

/** Permissions that touch destructive state (used for UI confirm prompts). */
export const REGISTRY_DESTRUCTIVE_PERMISSIONS: ReadonlySet<RegistryPermissionString> = new Set(
  PERMISSIONS.filter((p): p is typeof p & { destructive: true } => (p as PermissionDef).destructive === true).map((p) => p.id),
);

/** UI grouping for the Roles editor. */
export const REGISTRY_PERMISSION_CATEGORIES = PERMISSION_CATEGORY_DEFS.map((cat) => ({
  id: cat.id,
  label: cat.label,
  permissions: PERMISSIONS.filter((p) => p.category === cat.id).map((p) => p.id),
}));

export function permissionLabel(id: RegistryPermissionString): string {
  return PERMISSIONS.find((p) => p.id === id)?.label ?? id;
}

export function isKnownPermission(id: string): id is RegistryPermissionString {
  return REGISTRY_ALL_PERMISSIONS.has(id as RegistryPermissionString);
}
