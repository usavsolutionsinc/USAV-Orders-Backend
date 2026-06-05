import {
  AlertCircle,
  AlertTriangle,
  Barcode,
  Box,
  Calendar,
  Check,
  ClipboardList,
  Clock,
  DollarSign,
  FileText,
  History,
  Inbox,
  Layers,
  LayoutDashboard,
  Link2,
  List,
  MapPin,
  MessageSquare,
  Monitor,
  Package,
  PackageCheck,
  Printer,
  Settings,
  ShieldCheck,
  ShoppingCart,
  TrendingUp,
  Truck,
  User,
  Wrench,
  Zap,
} from '@/components/Icons';
import { ADMIN_SECTION_OPTIONS } from '@/components/admin/admin-sections';

export type SidebarRouteKey =
  | 'dashboard'
  | 'operations'
  | 'fba'
  | 'receiving'
  | 'walk-in'
  | 'repair'
  | 'replenish'
  | 'inventory'
  | 'products'
  | 'warehouse'
  | 'tech'
  | 'packer'
  | 'support'
  | 'ai-chat'
  | 'previous-quarters'
  | 'admin'
  | 'audit-log'
  | 'manuals-library'
  | 'settings'
  | 'unknown';

export type SidebarIconComponent = (props: { className?: string }) => JSX.Element;

export interface SidebarNavItem {
  id: string;
  label: string;
  href: string;
  icon: SidebarIconComponent;
  kind?: 'main' | 'station' | 'bottom';
  /**
   * Permission required to see this item. If omitted, the item is visible
   * to anyone signed in (and to unauthenticated callers during rollout —
   * see filtering rules in getSidebarNavItems).
   */
  requires?: string;
}

const MOBILE_RESTRICTED_SIDEBAR_IDS = new Set<SidebarRouteKey>([
  'operations',
  'manuals-library',
  'support',
  'previous-quarters',
  'admin',
  'audit-log',
]);

const MOBILE_ALLOWED_PREFIXES: ReadonlyArray<string> = [
  '/m',
  '/signin',
  '/receiving',
  '/packer',
  '/tech',
  '/01',
  '/414',
];

export function isMobileAllowedPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return MOBILE_ALLOWED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export const APP_SIDEBAR_NAV: SidebarNavItem[] = [
  { id: 'operations',        label: 'Operations',  href: '/operations',         icon: Monitor,         kind: 'main',    requires: 'operations.view' },
  { id: 'dashboard',         label: 'Orders / Shipping', href: '/dashboard',    icon: LayoutDashboard, kind: 'main',    requires: 'dashboard.view' },
  { id: 'walk-in',           label: 'Walk-In',     href: '/walk-in',            icon: ShoppingCart,    kind: 'main',    requires: 'walk_in.view' },
  { id: 'products',          label: 'Products',    href: '/products',           icon: Box,             kind: 'main',    requires: 'sku_stock.view' },
  { id: 'inventory',         label: 'Inventory',   href: '/inventory',          icon: Package,         kind: 'main',    requires: 'sku_stock.view' },
  { id: 'warehouse',         label: 'Warehouse',   href: '/warehouse',          icon: MapPin,          kind: 'main',    requires: 'sku_stock.view' },
  { id: 'receiving',         label: 'Receiving',   href: '/receiving',          icon: ClipboardList,   kind: 'station', requires: 'receiving.view' },
  { id: 'fba',               label: 'Amazon FBA',  href: '/fba',                icon: Package,         kind: 'station', requires: 'fba.view' },
  { id: 'tech',              label: 'Testing',     href: '/tech',               icon: Wrench,          kind: 'station', requires: 'tech.view' },
  { id: 'packer',            label: 'Packing',     href: '/packer',             icon: User,            kind: 'station', requires: 'packing.view' },
  { id: 'support',           label: 'Support',     href: '/support',            icon: AlertCircle,     kind: 'station', requires: 'integrations.zendesk' },
  { id: 'ai-chat',           label: 'AI Chat',     href: '/ai-chat',            icon: MessageSquare,   kind: 'bottom',  requires: 'dashboard.view' },
  { id: 'previous-quarters', label: 'Quarters',    href: '/previous-quarters',  icon: Calendar,        kind: 'bottom', requires: 'reports.view' },
  // Audit Log is no longer a top-level sidebar row — it lives under Admin › Logs
  // (AdminLogsTab, with the Audit filter). The /settings/audit and /audit-log/*
  // routes still resolve directly; only the nav row was removed.
  { id: 'admin',             label: 'Admin',       href: '/admin',              icon: ShieldCheck,     kind: 'bottom', requires: 'admin.view' },
  { id: 'settings',          label: 'Settings',    href: '/settings',           icon: Settings,        kind: 'bottom' },
];

export function isSidebarRouteMobileRestricted(routeKey: SidebarRouteKey): boolean {
  return MOBILE_RESTRICTED_SIDEBAR_IDS.has(routeKey);
}

export interface GetSidebarNavItemsOpts {
  mobileRestricted?: boolean;
  /**
   * Set of permission strings the current user holds. When provided, items
   * whose `requires` is not in the set are filtered out. When undefined
   * (unauthenticated, or pre-sign-in shadow mode), no permission filtering
   * is applied — preserves legacy behavior for the rollout window.
   */
  permissions?: ReadonlySet<string>;
}

export function getSidebarNavItems(opts: GetSidebarNavItemsOpts = {}): SidebarNavItem[] {
  const { mobileRestricted = false, permissions } = opts;
  let items: SidebarNavItem[] = APP_SIDEBAR_NAV;
  if (mobileRestricted) {
    items = items.filter((item) => !isSidebarRouteMobileRestricted(item.id as SidebarRouteKey));
  }
  if (permissions) {
    items = items.filter((item) => !item.requires || permissions.has(item.requires));
  }
  return items;
}

export function getSidebarRouteKey(pathname: string | null): SidebarRouteKey {
  if (!pathname) return 'unknown';
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) return 'dashboard';
  if (pathname === '/operations' || pathname.startsWith('/operations/')) return 'operations';
  if (pathname === '/fba' || pathname.startsWith('/fba/')) return 'fba';
  if (pathname === '/receiving' || pathname.startsWith('/receiving/')) return 'receiving';
  if (pathname === '/walk-in' || pathname.startsWith('/walk-in/')) return 'walk-in';
  if (pathname === '/repair' || pathname.startsWith('/repair/')) return 'walk-in';
  if (pathname === '/replenish' || pathname.startsWith('/replenish/')) return 'replenish';
  if (pathname === '/products' || pathname.startsWith('/products/')) return 'products';
  if (pathname === '/warehouse' || pathname.startsWith('/warehouse/')) return 'warehouse';
  if (pathname === '/inventory' || pathname.startsWith('/inventory/')) return 'inventory';
  if (pathname === '/support' || pathname.startsWith('/support/')) return 'support';
  if (pathname === '/ai-chat' || pathname.startsWith('/ai-chat/')) return 'ai-chat';
  if (pathname === '/previous-quarters' || pathname.startsWith('/previous-quarters/')) return 'previous-quarters';
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
  if (pathname === '/audit-log' || pathname.startsWith('/audit-log/')) return 'audit-log';
  if (pathname === '/settings/audit' || pathname.startsWith('/settings/audit/')) return 'audit-log';
  if (pathname === '/tech' || pathname.startsWith('/tech/')) return 'tech';
  if (pathname === '/packer' || pathname.startsWith('/packer/')) return 'packer';
  if (pathname === '/manuals/library' || pathname.startsWith('/manuals/library/')) return 'manuals-library';
  // /manuals now redirects to /products (see src/app/manuals/page.tsx)
  if (pathname === '/manuals' || pathname.startsWith('/manuals/')) return 'products';
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return 'settings';
  return 'unknown';
}

function getFirstPathSegment(path: string): string {
  const [segment = ''] = path.split('/').filter(Boolean);
  return segment === 'packers' ? 'packer' : segment;
}

export function isSidebarNavActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;

  const hrefSegment = getFirstPathSegment(href);
  const pathnameSegment = getFirstPathSegment(pathname);

  if (hrefSegment === 'tech' || hrefSegment === 'packer') {
    return pathnameSegment === hrefSegment;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Route → required permission map. Used by middleware to redirect users to
 * `/not-authorized` if they navigate (via URL) to an area they can't access,
 * and by per-page guards as a single source of truth.
 *
 * Entries are checked in order; the first prefix match wins. Add new entries
 * with the longest path first (e.g. `/admin/staff` before `/admin`).
 */
export const ROUTE_PERMISSIONS: ReadonlyArray<{ prefix: string; permission: string }> = [
  { prefix: '/audit-log',          permission: 'admin.view_logs' },
  { prefix: '/admin',              permission: 'admin.view' },
  { prefix: '/operations',         permission: 'operations.view' },
  { prefix: '/dashboard',          permission: 'dashboard.view' },
  { prefix: '/fba',                permission: 'fba.view' },
  { prefix: '/walk-in',            permission: 'walk_in.view' },
  { prefix: '/repair',             permission: 'repair.view' },
  { prefix: '/receiving',          permission: 'receiving.view' },
  { prefix: '/tech',               permission: 'tech.view' },
  { prefix: '/packer',             permission: 'packing.view' },
  { prefix: '/packers',            permission: 'packing.view' },
  { prefix: '/products',           permission: 'sku_stock.view' },
  { prefix: '/warehouse',          permission: 'sku_stock.view' },
  { prefix: '/inventory',          permission: 'sku_stock.view' },
  { prefix: '/previous-quarters',  permission: 'reports.view' },
  // /support is the native Zendesk ticket console — gated by the same
  // permission as the /api/zendesk/* routes it calls.
  { prefix: '/support',            permission: 'integrations.zendesk' },
  { prefix: '/ai-chat',            permission: 'dashboard.view' },
  // /settings is intentionally NOT gated — every signed-in user can manage
  // their own workstation/appearance settings; admin tabs gate themselves.
  // (/manuals now redirects into /products)
];

export function permissionForPath(pathname: string): string | null {
  for (const entry of ROUTE_PERMISSIONS) {
    if (pathname === entry.prefix || pathname.startsWith(entry.prefix + '/')) {
      return entry.permission;
    }
  }
  return null;
}

/* ════════════════════ MASTER SIDEBAR NAV — page + mode ════════════════════
 *
 * Single source of truth for the "master nav dropdown" (see
 * docs/design-system/master-sidebar-nav-migration-plan.md). Each page that has
 * an L2 mode row declares its modes here, plus the two halves of its URL
 * contract:
 *   • `to()`   — how navigating to a mode mutates the URL (the WRITE path).
 *   • `resolveMode()` — how the active mode is read back from a location (the
 *     READ path). This MIRRORS the panel's own derivation today so deep-links
 *     resolve identically; panels will eventually import this instead of
 *     re-implementing `getReceivingModeFromLocation` / `resolveFbaMode` / etc.
 *
 * P0 (this file) is pure data + pure functions — no components, no router.
 * The round-trip invariant `resolveMode(apply(to(mode))) === mode` is enforced
 * by sidebar-navigation.test.ts so the two halves can never silently diverge.
 */

/** A search-param delta map: value to set, or `null` to delete the key. */
export type SearchParamDelta = Record<string, string | null>;

export interface ModeNavTarget {
  /** Absolute pathname to land on (a mode may live on a sub-path, e.g. unfound). */
  pathname: string;
  /** Search-param mutations applied on top of the current params. */
  params?: SearchParamDelta;
}

export interface ModeLocation {
  pathname: string;
  params: Pick<URLSearchParams, 'get' | 'has'>;
}

export interface SidebarModeItem {
  id: string;
  label: string;
  icon: SidebarIconComponent;
  /** Build the nav target for this mode (relative to the page's base href). */
  to: () => ModeNavTarget;
  /** Optional per-mode permission gate (e.g. admin sub-sections). */
  requires?: string;
  /**
   * Optional group heading shown above this mode's row in the dropdown (e.g. the
   * admin sections' People / Data sources / System). Omitted = no header.
   */
  group?: string;
}

export interface SidebarPageNav extends SidebarNavItem {
  /** L2 modes. Omitted for single-surface pages (no mode row). */
  modes?: SidebarModeItem[];
  /**
   * Read the active mode id from a location. Always returns an id present in
   * `modes` (defaulting to the page's leftmost/default mode). Only defined for
   * pages that have `modes`.
   */
  resolveMode?: (loc: ModeLocation) => string;
}

// Page hrefs are repeated from APP_SIDEBAR_NAV so each mode's `to()` is a pure,
// self-contained literal (no closure over the array).
const DASHBOARD = '/dashboard';
const RECEIVING = '/receiving';
const FBA = '/fba';
const INVENTORY = '/inventory';
const WAREHOUSE = '/warehouse';
const PRODUCTS = '/products';
const TECH = '/tech';
const WALK_IN = '/walk-in';
const ADMIN = '/admin';

export const SIDEBAR_PAGE_NAV: SidebarPageNav[] = [
  // ── Orders / Shipping ─────────────────────────────────────────────────────
  // Bare presence params (`?pending` / `?shipped` / `?unshipped`); first match
  // wins in the reader, default `pending`. (FBA order-view is its own page.)
  {
    id: 'dashboard', label: 'Orders / Shipping', href: DASHBOARD, icon: LayoutDashboard, kind: 'main', requires: 'dashboard.view',
    modes: [
      { id: 'pending',   label: 'Pending',  icon: Clock,        to: () => ({ pathname: DASHBOARD, params: { pending: '', shipped: null, unshipped: null, fba: null } }) },
      { id: 'shipped',   label: 'Shipped',  icon: PackageCheck, to: () => ({ pathname: DASHBOARD, params: { shipped: '', pending: null, unshipped: null, fba: null } }) },
      { id: 'unshipped', label: 'Awaiting', icon: AlertCircle,  to: () => ({ pathname: DASHBOARD, params: { unshipped: '', pending: null, shipped: null, fba: null } }) },
    ],
    resolveMode: ({ params }) => {
      if (params.has('shipped')) return 'shipped';
      if (params.has('unshipped')) return 'unshipped';
      return 'pending';
    },
  },
  // ── Receiving ─────────────────────────────────────────────────────────────
  // `?mode=incoming|history|pickup`; `unfound` lives on the /receiving/unfound
  // sub-path; default `receive` on the bare /receiving path.
  {
    id: 'receiving', label: 'Receiving', href: RECEIVING, icon: ClipboardList, kind: 'station', requires: 'receiving.view',
    modes: [
      { id: 'receive',  label: 'Receiving',    icon: ClipboardList,  to: () => ({ pathname: RECEIVING, params: { mode: null } }) },
      { id: 'incoming', label: 'Incoming',     icon: Inbox,          to: () => ({ pathname: RECEIVING, params: { mode: 'incoming' } }) },
      { id: 'history',  label: 'History',      icon: List,           to: () => ({ pathname: RECEIVING, params: { mode: 'history' } }) },
      { id: 'pickup',   label: 'Local Pickup', icon: ShoppingCart,   to: () => ({ pathname: RECEIVING, params: { mode: 'pickup' } }) },
      { id: 'unfound',  label: 'Unfound',      icon: AlertTriangle,  to: () => ({ pathname: `${RECEIVING}/unfound`, params: { mode: null } }) },
    ],
    resolveMode: ({ pathname, params }) => {
      if (pathname.startsWith(`${RECEIVING}/unfound`)) return 'unfound';
      const m = params.get('mode');
      if (m === 'pickup') return 'pickup';
      if (m === 'history') return 'history';
      if (m === 'incoming') return 'incoming';
      return 'receive';
    },
  },
  // ── Amazon FBA ────────────────────────────────────────────────────────────
  // `?mode=plan|combine|shipped`; default `combine` (param cleared).
  {
    id: 'fba', label: 'Amazon FBA', href: FBA, icon: Package, kind: 'station', requires: 'fba.view',
    modes: [
      { id: 'plan',    label: 'Plan',    icon: ClipboardList, to: () => ({ pathname: FBA, params: { mode: 'plan' } }) },
      { id: 'combine', label: 'Combine', icon: Package,       to: () => ({ pathname: FBA, params: { mode: null } }) },
      { id: 'shipped', label: 'Shipped', icon: Truck,         to: () => ({ pathname: FBA, params: { mode: 'shipped' } }) },
    ],
    resolveMode: ({ params }) => {
      const v = String(params.get('mode') || '').trim().toLowerCase();
      return v === 'plan' || v === 'shipped' ? v : 'combine';
    },
  },
  // ── Inventory ─────────────────────────────────────────────────────────────
  // `?mode=triage|pulse` or `?section=replenish`; default `ledger`.
  {
    id: 'inventory', label: 'Inventory', href: INVENTORY, icon: Package, kind: 'main', requires: 'sku_stock.view',
    modes: [
      { id: 'ledger',    label: 'Ledger',    icon: Package,    to: () => ({ pathname: INVENTORY, params: { mode: null, section: null } }) },
      { id: 'triage',    label: 'Triage',    icon: Zap,        to: () => ({ pathname: INVENTORY, params: { mode: 'triage', section: null } }) },
      { id: 'pulse',     label: 'Pulse',     icon: TrendingUp, to: () => ({ pathname: INVENTORY, params: { mode: 'pulse', section: null } }) },
      { id: 'graph',     label: 'Graph',     icon: Layers,     to: () => ({ pathname: `${INVENTORY}/graph`, params: { mode: null, section: null } }) },
      { id: 'replenish', label: 'Replenish', icon: History,    to: () => ({ pathname: INVENTORY, params: { section: 'replenish', mode: null } }) },
    ],
    resolveMode: ({ pathname, params }) => {
      if (pathname.startsWith(`${INVENTORY}/graph`)) return 'graph';
      if (params.get('section') === 'replenish') return 'replenish';
      const m = params.get('mode');
      if (m === 'triage') return 'triage';
      if (m === 'pulse') return 'pulse';
      return 'ledger';
    },
  },
  // ── Warehouse ─────────────────────────────────────────────────────────────
  // `?tab=labels|racks|rooms|bins|map`; default `labels` (param cleared).
  {
    id: 'warehouse', label: 'Warehouse', href: WAREHOUSE, icon: MapPin, kind: 'main', requires: 'sku_stock.view',
    modes: [
      { id: 'labels', label: 'Labels', icon: Printer,  to: () => ({ pathname: WAREHOUSE, params: { tab: null } }) },
      { id: 'racks',  label: 'Racks',  icon: Layers,   to: () => ({ pathname: WAREHOUSE, params: { tab: 'racks' } }) },
      { id: 'rooms',  label: 'Rooms',  icon: Box,      to: () => ({ pathname: WAREHOUSE, params: { tab: 'rooms' } }) },
      { id: 'bins',   label: 'Bins',   icon: Package,  to: () => ({ pathname: WAREHOUSE, params: { tab: 'bins' } }) },
      { id: 'map',    label: 'Map',    icon: MapPin,   to: () => ({ pathname: WAREHOUSE, params: { tab: 'map' } }) },
    ],
    resolveMode: ({ params }) => {
      const t = params.get('tab');
      return t === 'rooms' || t === 'bins' || t === 'racks' || t === 'map' ? t : 'labels';
    },
  },
  // ── Products ──────────────────────────────────────────────────────────────
  // `?view=manuals|labels|pairing|qc`; default `manuals` (param cleared).
  {
    id: 'products', label: 'Products', href: PRODUCTS, icon: Box, kind: 'main', requires: 'sku_stock.view',
    modes: [
      { id: 'manuals', label: 'Manuals', icon: FileText, to: () => ({ pathname: PRODUCTS, params: { view: null } }) },
      { id: 'labels',  label: 'Labels',  icon: Barcode,  to: () => ({ pathname: PRODUCTS, params: { view: 'labels' } }) },
      { id: 'pairing', label: 'Pairing', icon: Link2,    to: () => ({ pathname: PRODUCTS, params: { view: 'pairing' } }) },
      { id: 'qc',      label: 'QC',      icon: Check,     to: () => ({ pathname: PRODUCTS, params: { view: 'qc' } }) },
    ],
    resolveMode: ({ params }) => {
      const v = params.get('view');
      return v === 'labels' || v === 'pairing' || v === 'qc' ? v : 'manuals';
    },
  },
  // ── Testing ───────────────────────────────────────────────────────────────
  // Top-mode switch — Shipping / Testing / History (matches TECH_TOP_MODE_ITEMS).
  // `?view=testing` → Testing; `?view=testing-history` → the tested-lines feed;
  // everything else is Shipping (whose right pane is the shipping History feed).
  {
    id: 'tech', label: 'Testing', href: TECH, icon: Wrench, kind: 'station', requires: 'tech.view',
    modes: [
      { id: 'shipping', label: 'Shipping', icon: Truck,       to: () => ({ pathname: TECH, params: { view: null } }) },
      { id: 'testing',  label: 'Testing',  icon: ShieldCheck, to: () => ({ pathname: TECH, params: { view: 'testing' } }) },
      { id: 'history',  label: 'History',  icon: History,     to: () => ({ pathname: TECH, params: { view: 'testing-history' } }) },
    ],
    resolveMode: ({ params }) =>
      params.get('view') === 'testing'
        ? 'testing'
        : params.get('view') === 'testing-history'
          ? 'history'
          : 'shipping',
  },
  // ── Walk-In (Repair queue tabs + Sales) ───────────────────────────────────
  // `?tab=active|done` drives the repair-queue status (default `active`);
  // `?mode=sales` flips the panel to the Sales surface. The status tabs clear
  // `mode` so switching off Sales lands back in Repairs. /repair routes onto this
  // page key too (see getSidebarRouteKey). Incoming repairs now live in the
  // Receiving incoming display, so there's no longer an Incoming tab here.
  {
    id: 'walk-in', label: 'Walk-In', href: WALK_IN, icon: ShoppingCart, kind: 'main', requires: 'walk_in.view',
    modes: [
      { id: 'active',   label: 'Active',   icon: Wrench,     to: () => ({ pathname: WALK_IN, params: { tab: null, mode: null } }) },
      { id: 'done',     label: 'Done',     icon: Check,      to: () => ({ pathname: WALK_IN, params: { tab: 'done', mode: null } }) },
      { id: 'sales',    label: 'Sales',    icon: DollarSign, to: () => ({ pathname: WALK_IN, params: { mode: 'sales', tab: null } }) },
    ],
    resolveMode: ({ params }) => {
      if (params.get('mode') === 'sales') return 'sales';
      const t = params.get('tab');
      return t === 'done' ? t : 'active';
    },
  },
  // ── Admin (grouped section rows — dropdown only, NO L2 rail) ───────────────
  // 20+ sections derived from ADMIN_SECTION_OPTIONS (single source of truth), so
  // every section is ≤2 taps from the header dropdown and the closed header shows
  // the active section name. The AdminSidebar body keeps its own grouped/described
  // list (not gated) — admin is intentionally absent from MASTER_NAV_RAIL_PAGES
  // because 20+ icons don't fit the flush horizontal rail. `?section=<value>`;
  // `overview` clears the param so deep-links land cleanly on overview.
  {
    id: 'admin', label: 'Admin', href: ADMIN, icon: ShieldCheck, kind: 'bottom', requires: 'admin.view',
    modes: ADMIN_SECTION_OPTIONS.map((section) => ({
      id: section.value,
      label: section.label,
      icon: section.icon as SidebarIconComponent,
      group: section.group,
      requires: section.requires,
      to: () => ({ pathname: ADMIN, params: { section: section.value === 'overview' ? null : section.value } }),
    })),
    resolveMode: ({ params }) => {
      const v = params.get('section');
      return v && ADMIN_SECTION_OPTIONS.some((section) => section.value === v) ? v : 'overview';
    },
  },
];

/** Lookup a page's nav entry (modes + resolver) by its route/page id. */
export function getSidebarPageNav(pageId: string): SidebarPageNav | undefined {
  return SIDEBAR_PAGE_NAV.find((page) => page.id === pageId);
}

/**
 * Canonical href for a page id. Modeful pages carry it in `SIDEBAR_PAGE_NAV`;
 * modeless pages (operations, packer, support, ai-chat, previous-quarters,
 * audit-log, admin, settings) live only in `APP_SIDEBAR_NAV`. Navigation must
 * resolve through here so EVERY page — not just the eight modeful ones — lands
 * on its real route. Returns null for an unknown id.
 */
export function getSidebarHref(pageId: string): string | null {
  return (
    getSidebarPageNav(pageId)?.href ??
    APP_SIDEBAR_NAV.find((item) => item.id === pageId)?.href ??
    null
  );
}

/**
 * Apply a mode's `ModeNavTarget` to the current location, returning the next
 * `{ pathname, search }`. `search` has no leading `?`. Pure — does not touch the
 * router. The eventual nav hook decides push-vs-replace around this.
 */
export function applyModeTarget(
  current: { pathname: string; params: Pick<URLSearchParams, 'toString'> },
  target: ModeNavTarget,
): { pathname: string; search: string } {
  const params = new URLSearchParams(current.params.toString());
  for (const [key, value] of Object.entries(target.params ?? {})) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  return { pathname: target.pathname, search: params.toString() };
}

/**
 * Read the active mode id for a page from a location. Returns `null` for
 * single-surface pages (no modes). Mirrors each panel's own derivation.
 */
export function resolveSidebarMode(pageId: string, loc: ModeLocation): string | null {
  const page = getSidebarPageNav(pageId);
  if (!page?.resolveMode) return null;
  return page.resolveMode(loc);
}
