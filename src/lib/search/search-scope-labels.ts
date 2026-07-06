/**
 * search-scope-labels — the single resolver from a canonical recents `scope`
 * key to its human label (docs/unified-global-search-consolidation-plan.md §8).
 *
 * Scope keys are `'global'` or `'<surface>[:<sub>]'` (e.g. `'inventory:skus'`,
 * `'dashboard:unshipped'`). Every recents chip label flows through here so the
 * strings live in ONE place — never inlined at a call site (§8 "do not
 * duplicate label strings inline").
 */

/** Top-level surface → label. */
const SURFACE_LABELS: Record<string, string> = {
  global: 'Everywhere',
  dashboard: 'Dashboard',
  shipped: 'Shipped',
  unshipped: 'Unshipped',
  inventory: 'Inventory',
  warehouse: 'Warehouse',
  receiving: 'Receiving',
  repair: 'Repairs',
  operations: 'Operations',
  products: 'Products',
  fba: 'FBA',
  audit: 'Audit',
  sourcing: 'Sourcing',
  photos: 'Media',
  warranty: 'Warranty',
  goals: 'Goals',
  admin: 'Admin',
};

/** Inventory sub-tab → label (mirrors the InventoryTab union). */
const INVENTORY_TAB_LABELS: Record<string, string> = {
  activity: 'Activity',
  bins: 'Bins',
  skus: 'SKUs',
  units: 'Units',
  alerts: 'Alerts',
  counts: 'Counts',
  triage: 'Triage',
  pulse: 'Pulse',
};

/** Dashboard sub-mode → label. */
const DASHBOARD_SUB_LABELS: Record<string, string> = {
  unshipped: 'Unshipped',
  pending: 'Pending',
};

function titleCase(segment: string): string {
  // Plain capitalize-first. Acronyms (SKU/FBA/QC) live in the curated maps, so
  // the generic fallback never needs to guess which short words are acronyms.
  return segment
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Resolve a scope key to its display label. Known surfaces/sub-tabs get curated
 * labels; anything unrecognized degrades to a title-cased `Surface · Sub`.
 */
export function resolveSearchScopeLabel(scope: string): string {
  if (!scope) return SURFACE_LABELS.global;
  const [surface, sub] = scope.split(':');

  if (!sub) return SURFACE_LABELS[surface] ?? titleCase(surface);

  // Curated sub-tab labels return the SUB label alone (it's the specific view).
  if (surface === 'inventory' && INVENTORY_TAB_LABELS[sub]) {
    return `Inventory · ${INVENTORY_TAB_LABELS[sub]}`;
  }
  if (surface === 'dashboard' && DASHBOARD_SUB_LABELS[sub]) {
    return DASHBOARD_SUB_LABELS[sub];
  }

  const surfaceLabel = SURFACE_LABELS[surface] ?? titleCase(surface);
  return `${surfaceLabel} · ${titleCase(sub)}`;
}
