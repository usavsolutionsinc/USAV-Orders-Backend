import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Archive,
  Barcode,
  BarChart3,
  Boxes,
  Images,
  DoorOpen,
  Check,
  Clipboard,
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
  PackageOpen,
  Printer,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Star,
  Tags,
  TrendingUp,
  Truck,
  Wrench,
  Zap,
  Warehouse,
  ShelvingUnit,
  Box,
  Phone,
  Voicemail,
} from '@/components/Icons';
import { ADMIN_SECTION_OPTIONS } from '@/components/admin/admin-sections';

export type SidebarRouteKey =
  | 'dashboard'
  | 'operations'
  | 'ops-photos'
  | 'studio'
  | 'fba'
  | 'receiving'
  | 'walk-in'
  | 'repair'
  | 'replenish'
  | 'inventory'
  | 'products'
  | 'warehouse'
  | 'sourcing'
  | 'tech'
  | 'packer'
  | 'outbound'
  | 'support'
  | 'ai-chat'
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
  /** Optional desktop-only icon override (master nav on lg+). */
  desktopIcon?: SidebarIconComponent;
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
  'studio',
  'manuals-library',
  'support',
  'admin',
  'audit-log',
]);

const MOBILE_ALLOWED_PREFIXES: ReadonlyArray<string> = [
  '/m',
  '/signin',
  '/receiving',
  '/unbox',
  '/triage',
  '/incoming',
  '/pickup',
  '/pack',
  '/packer',
  '/outbound',
  '/test',
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
  { id: 'sourcing',          label: 'Sourcing',    href: '/sourcing',           icon: Search,          kind: 'main',    requires: 'sourcing.view' },
  { id: 'products',          label: 'Products',    href: '/products',           icon: Tags,            kind: 'main',    requires: 'sku_stock.view' },
  { id: 'inventory',         label: 'Inventory',   href: '/inventory',          icon: ShelvingUnit,    kind: 'main',    requires: 'sku_stock.view' },
  { id: 'warehouse',         label: 'Warehouse',   href: '/warehouse',          icon: Warehouse,       kind: 'main',    requires: 'sku_stock.view' },
  // Points at the Unbox surface (`/unbox`) — the receiving station's default
  // surface — so the primary nav lands on the canonical URL without a redirect
  // hop. Route key still resolves to 'receiving', so the item stays active
  // across every receiving mode (/unbox, /triage, /receiving?mode=…).
  { id: 'receiving',         label: 'Receiving',   href: '/unbox',              icon: ClipboardList,   kind: 'station', requires: 'receiving.view' },
  { id: 'outbound',          label: 'Outbound',    href: '/outbound',           icon: Truck,           kind: 'station', requires: 'shipping.view' },
  // Points at the first-class Test surface (`/test`) so the primary nav lands on
  // the canonical URL without a redirect hop. Route key still resolves to 'tech'
  // (reuses the tech panel), so the item stays active on /test + /tech.
  { id: 'tech',              label: 'Testing',     href: '/test',               icon: Wrench,          kind: 'station', requires: 'tech.view' },
  // Data Wipe is temporarily absent from master nav — revisit when the station
  // UX is ready for general rollout. /wipe route + API remain live.
  { id: 'fba',               label: 'Amazon FBA',  href: '/fba',                icon: Boxes,           kind: 'main',    requires: 'fba.view' },
  { id: 'ops-photos',        label: 'Media library', href: '/ops/photos',       icon: Images,          kind: 'main',    requires: 'photos.view' },
  // Points at the first-class Pack surface (`/pack`) so the primary nav lands on
  // the canonical URL without a redirect hop. Route key still resolves to
  // 'packer' (reuses the packer panel), so the item stays active on /pack + /packer.
  { id: 'packer',            label: 'Packing',     href: '/pack',               icon: Box,             kind: 'station', requires: 'packing.view' },
  { id: 'support',           label: 'Support',     href: '/support',            icon: AlertCircle,     kind: 'bottom', requires: 'integrations.zendesk' },
  { id: 'studio',            label: 'Studio',      href: '/studio',             icon: Layers,          kind: 'bottom',  requires: 'studio.view' },
  { id: 'ai-chat',           label: 'AI Chat',     href: '/ai-chat',            icon: MessageSquare,   kind: 'bottom',  requires: 'dashboard.view' },
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
  } else {
    items = items.map((item) =>
      item.desktopIcon ? { ...item, icon: item.desktopIcon } : item,
    );
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
  if (pathname === '/signals' || pathname.startsWith('/signals/')) return 'operations';
  if (pathname === '/ops/photos' || pathname.startsWith('/ops/photos/')) return 'ops-photos';
  if (pathname === '/studio' || pathname.startsWith('/studio/')) return 'studio';
  if (pathname === '/fba' || pathname.startsWith('/fba/')) return 'fba';
  // `/unbox` + `/triage` are the first-class receiving surfaces — they reuse the
  // receiving sidebar panel + right pane, so they resolve to the `receiving` key.
  if (pathname === '/unbox' || pathname.startsWith('/unbox/')) return 'receiving';
  if (pathname === '/triage' || pathname.startsWith('/triage/')) return 'receiving';
  if (pathname === '/incoming' || pathname.startsWith('/incoming/')) return 'receiving';
  if (pathname === '/pickup' || pathname.startsWith('/pickup/')) return 'receiving';
  // `/receiving/history` (+ every other receiving sub-route) resolves here too.
  if (pathname === '/receiving' || pathname.startsWith('/receiving/')) return 'receiving';
  if (pathname === '/walk-in' || pathname.startsWith('/walk-in/')) return 'walk-in';
  if (pathname === '/repair' || pathname.startsWith('/repair/')) return 'walk-in';
  if (pathname === '/replenish' || pathname.startsWith('/replenish/')) return 'replenish';
  if (pathname === '/products' || pathname.startsWith('/products/')) return 'products';
  if (pathname === '/warehouse' || pathname.startsWith('/warehouse/')) return 'warehouse';
  if (pathname === '/sourcing' || pathname.startsWith('/sourcing/')) return 'sourcing';
  if (pathname === '/inventory' || pathname.startsWith('/inventory/')) return 'inventory';
  if (pathname === '/support' || pathname.startsWith('/support/')) return 'support';
  if (pathname === '/ai-chat' || pathname.startsWith('/ai-chat/')) return 'ai-chat';
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
  if (pathname === '/audit-log' || pathname.startsWith('/audit-log/')) return 'audit-log';
  if (pathname === '/settings/audit' || pathname.startsWith('/settings/audit/')) return 'audit-log';
  // `/test` is the first-class Testing surface; it reuses the `tech` sidebar
  // panel + station, so it resolves to the `tech` key (legacy `/tech` too).
  if (pathname === '/test' || pathname.startsWith('/test/')) return 'tech';
  if (pathname === '/tech' || pathname.startsWith('/tech/')) return 'tech';
  // `/pack` is the first-class Packing surface; it reuses the `packer` sidebar
  // panel + station, so it resolves to the `packer` key (legacy `/packer` too).
  if (pathname === '/pack' || pathname.startsWith('/pack/')) return 'packer';
  if (pathname === '/packer' || pathname.startsWith('/packer/')) return 'packer';
  if (pathname === '/outbound' || pathname.startsWith('/outbound/')) return 'outbound';
  if (pathname === '/manuals/library' || pathname.startsWith('/manuals/library/')) return 'manuals-library';
  // /manuals now redirects to /products (see src/app/manuals/page.tsx)
  if (pathname === '/manuals' || pathname.startsWith('/manuals/')) return 'products';
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return 'settings';
  return 'unknown';
}

function getFirstPathSegment(path: string): string {
  const [segment = ''] = path.split('/').filter(Boolean);
  // Normalize the Packing surface aliases (`/pack`, `/packer`, `/packers`) to a
  // single `pack` segment so the nav item stays active across the migration.
  if (segment === 'packers' || segment === 'packer') return 'pack';
  // Normalize the legacy Testing route (`/tech`) to the canonical `test` segment
  // so the nav item stays active across the migration.
  if (segment === 'tech') return 'test';
  return segment;
}

export function isSidebarNavActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;

  const hrefSegment = getFirstPathSegment(href);
  const pathnameSegment = getFirstPathSegment(pathname);

  if (hrefSegment === 'test' || hrefSegment === 'pack') {
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
  { prefix: '/ops/photos',           permission: 'photos.view' },
  { prefix: '/operations',         permission: 'operations.view' },
  { prefix: '/signals',            permission: 'operations.view' },
  { prefix: '/dashboard',          permission: 'dashboard.view' },
  { prefix: '/fba',                permission: 'fba.view' },
  { prefix: '/walk-in',            permission: 'walk_in.view' },
  { prefix: '/repair',             permission: 'repair.view' },
  { prefix: '/receiving',          permission: 'receiving.view' },
  // `/unbox` + `/triage` + `/incoming` are first-class receiving surfaces (same gate).
  { prefix: '/unbox',              permission: 'receiving.view' },
  { prefix: '/triage',             permission: 'receiving.view' },
  { prefix: '/incoming',           permission: 'receiving.view' },
  { prefix: '/pickup',             permission: 'receiving.view' },
  // `/test` is the first-class Testing surface (legacy `/tech`).
  { prefix: '/test',               permission: 'tech.view' },
  { prefix: '/tech',               permission: 'tech.view' },
  { prefix: '/wipe',               permission: 'tech.data_wipe' },
  // `/pack` is the first-class Packing surface (legacy `/packer` / `/packers`).
  { prefix: '/pack',               permission: 'packing.view' },
  { prefix: '/packer',             permission: 'packing.view' },
  { prefix: '/packers',            permission: 'packing.view' },
  { prefix: '/outbound',           permission: 'shipping.view' },
  { prefix: '/products',           permission: 'sku_stock.view' },
  { prefix: '/warehouse',          permission: 'sku_stock.view' },
  { prefix: '/sourcing',           permission: 'sourcing.view' },
  { prefix: '/inventory',          permission: 'sku_stock.view' },
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
const OPERATIONS = '/operations';
// Unbox + Triage graduated to their own first-class surface routes
// (operator-surfaces refactor Phases 1–2); those modes navigate to them. Pickup +
// History graduated in Phase 9 (`/pickup`, nested `/receiving/history`). The whole
// receiving family now navigates via first-class routes, so no bare `/receiving`
// const remains.
const UNBOX = '/unbox';
const TRIAGE = '/triage';
const PICKUP = '/pickup';
const RECEIVING_HISTORY = '/receiving/history';
const INCOMING = '/incoming';
const FBA = '/fba';
const INVENTORY = '/inventory';
const WAREHOUSE = '/warehouse';
const SOURCING = '/sourcing';
const PRODUCTS = '/products';
// Testing graduated to its own first-class surface route (`/test`,
// operator-surfaces refactor Phase 8); its modes navigate there (the `?view=`
// sub-mode rides along). Legacy `/tech` still resolves (proxy redirect + shared
// page). Renamed const so the page href + every mode `to()` land on `/test`.
const TECH = '/test';
const WALK_IN = '/walk-in';
const ADMIN = '/admin';
const OUTBOUND = '/outbound';
const SUPPORT = '/support';
// Packing graduated to its own first-class surface route (`/pack`,
// operator-surfaces refactor Phase 7); its modes navigate there. Legacy
// `/packer` still resolves (proxy redirect + shared page).
const PACK = '/pack';

export const SIDEBAR_PAGE_NAV: SidebarPageNav[] = [
  // ── Orders / Shipping ─────────────────────────────────────────────────────
  // Bare presence params (`?unshipped` / `?shipped` / `?warranty`); first match
  // wins in the reader, default `unshipped`. (FBA order-view is its own page.)
  // Rail order: Unshipped · Shipped · Warranty Logger. The former "Awaiting" +
  // "Pending" modes are merged into one "Unshipped" mode (the whole pre-ship
  // backlog); the legacy `?pending` param resolves here for back-compat.
  {
    id: 'dashboard', label: 'Orders / Shipping', href: DASHBOARD, icon: LayoutDashboard, kind: 'main', requires: 'dashboard.view',
    modes: [
      { id: 'unshipped', label: 'Unshipped',        icon: Inbox,        to: () => ({ pathname: DASHBOARD, params: { unshipped: '', pending: null, shipped: null, fba: null, warranty: null } }) },
      { id: 'shipped',   label: 'Shipped',          icon: PackageCheck, to: () => ({ pathname: DASHBOARD, params: { shipped: '', pending: null, unshipped: null, fba: null, warranty: null } }) },
      { id: 'warranty',  label: 'Warranty Logger',  icon: ShieldCheck,  to: () => ({ pathname: DASHBOARD, params: { warranty: '', pending: null, shipped: null, unshipped: null, fba: null } }) },
    ],
    resolveMode: ({ params }) => {
      if (params.has('shipped')) return 'shipped';
      if (params.has('warranty')) return 'warranty';
      // `?unshipped`, legacy `?pending`, or nothing → the merged Unshipped mode.
      return 'unshipped';
    },
  },
  // ── Operations ────────────────────────────────────────────────────────────
  // `?mode=analytics|insights|history|signals`; bare /operations = the Live
  // floor dashboard (default). The L2 rail mirrors the five right-pane modes
  // (OperationsWorkspace). Every switch clears the mode-scoped params (search,
  // selection, range, section…) so each mode opens clean — matches Inventory.
  {
    id: 'operations', label: 'Operations', href: OPERATIONS, icon: Monitor, kind: 'main', requires: 'operations.view',
    modes: [
      { id: 'live',      label: 'Live',      icon: Activity,  to: () => ({ pathname: OPERATIONS, params: { mode: null, signalsView: null, signalId: null, window: null, signalKind: null, q: null, open: null, section: null, range: null, segment: null, staffId: null, station: null } }) },
      { id: 'analytics', label: 'Analytics', icon: BarChart3, to: () => ({ pathname: OPERATIONS, params: { mode: 'analytics', signalsView: null, signalId: null, window: null, signalKind: null, q: null, open: null, section: null, range: null, segment: null, staffId: null, station: null } }) },
      { id: 'insights',  label: 'Insights',  icon: Sparkles,  to: () => ({ pathname: OPERATIONS, params: { mode: 'insights',  signalsView: null, signalId: null, window: null, signalKind: null, q: null, open: null, section: null, range: null, segment: null, staffId: null, station: null } }) },
      { id: 'history',   label: 'History',   icon: History,   to: () => ({ pathname: OPERATIONS, params: { mode: 'history',   signalsView: null, signalId: null, window: null, signalKind: null, q: null, open: null, section: null, range: null, segment: null, staffId: null, station: null } }) },
      { id: 'signals',   label: 'Signals',   icon: Zap,       to: () => ({ pathname: OPERATIONS, params: { mode: 'signals',   signalsView: null, signalId: null, window: null, signalKind: null, q: null, open: null, section: null, range: null, segment: null, staffId: null, station: null } }) },
    ],
    resolveMode: ({ params }) => {
      const m = params.get('mode');
      if (m === 'analytics') return 'analytics';
      if (m === 'insights') return 'insights';
      if (m === 'history') return 'history';
      if (m === 'signals') return 'signals';
      return 'live';
    },
  },
  // ── Receiving ─────────────────────────────────────────────────────────────
  // `?mode=incoming|triage|history|pickup`; bare /receiving = the Unbox
  // workspace (id `receive`) — kept as the default for deep-link + realtime
  // back-compat. `triage` (label "Receiving") is the scan/identify surface that
  // runs before unboxing; it's the 2nd pill and reachable at ?mode=triage. The
  // former `unfound` mode was relocated to Admin › PO Mailbox.
  {
    // href is the Unbox surface (the receiving station's default); keep it in
    // sync with APP_SIDEBAR_NAV so `getSidebarHref('receiving')` resolves there.
    id: 'receiving', label: 'Receiving', href: UNBOX, icon: ClipboardList, kind: 'station', requires: 'receiving.view',
    modes: [
      // Incoming now lives at its own route (`/incoming`).
      { id: 'incoming', label: 'Incoming',     icon: Inbox,          to: () => ({ pathname: INCOMING, params: { mode: null } }) },
      // Triage now lives at its own route (`/triage`); dropping `mode` avoids a
      // stale `?mode=` riding onto the surface path.
      { id: 'triage',   label: 'Receiving',    icon: ClipboardList,  to: () => ({ pathname: TRIAGE, params: { mode: null } }) },
      // Unbox now lives at its own route (`/unbox`); dropping `mode` avoids a
      // stale `?mode=` riding onto the surface path.
      { id: 'receive',  label: 'Unbox',        icon: PackageOpen,    to: () => ({ pathname: UNBOX, params: { mode: null } }) },
      // Pickup + History graduated to their own routes (`/pickup`,
      // `/receiving/history`); dropping `mode` avoids a stale `?mode=` riding on.
      { id: 'pickup',   label: 'Local Pickup', icon: ShoppingCart,   to: () => ({ pathname: PICKUP, params: { mode: null } }) },
      { id: 'history',  label: 'History',      icon: List,           to: () => ({ pathname: RECEIVING_HISTORY, params: { mode: null } }) },
    ],
    resolveMode: ({ pathname, params }) => {
      // The graduated surface routes resolve path-based (consistent with
      // Inventory's graph/triage/pulse), regardless of params. `/receiving/history`
      // is checked before the bare-route params fall-through.
      if (pathname === RECEIVING_HISTORY || pathname.startsWith(`${RECEIVING_HISTORY}/`)) return 'history';
      if (pathname === UNBOX || pathname.startsWith(`${UNBOX}/`)) return 'receive';
      if (pathname === TRIAGE || pathname.startsWith(`${TRIAGE}/`)) return 'triage';
      if (pathname === INCOMING || pathname.startsWith(`${INCOMING}/`)) return 'incoming';
      if (pathname === PICKUP || pathname.startsWith(`${PICKUP}/`)) return 'pickup';
      const m = params.get('mode');
      if (m === 'pickup') return 'pickup';
      if (m === 'history') return 'history';
      if (m === 'incoming') return 'incoming';
      if (m === 'triage') return 'triage';
      return 'receive';
    },
  },
  // ── Sourcing ──────────────────────────────────────────────────────────────
  // `?mode=scout|watchlist`; bare /sourcing = the Queue (demand) surface (default).
  // Legacy keys aliased: `alerts`→queue, `lookup`→scout.
  {
    id: 'sourcing', label: 'Sourcing', href: SOURCING, icon: Search, kind: 'main', requires: 'sourcing.view',
    modes: [
      { id: 'queue',     label: 'Queue',     icon: AlertCircle, to: () => ({ pathname: SOURCING, params: { mode: null, q: null, status: null } }) },
      { id: 'scout',     label: 'Scout',     icon: Search,      to: () => ({ pathname: SOURCING, params: { mode: 'scout', q: null, status: null } }) },
      { id: 'watchlist', label: 'Watchlist', icon: Star,        to: () => ({ pathname: SOURCING, params: { mode: 'watchlist', q: null, status: null } }) },
      { id: 'searches',  label: 'Searches',  icon: Clock,       to: () => ({ pathname: SOURCING, params: { mode: 'searches', q: null, status: null } }) },
      { id: 'suppliers', label: 'Suppliers', icon: Link2,       to: () => ({ pathname: SOURCING, params: { mode: 'suppliers', q: null, status: null } }) },
    ],
    resolveMode: ({ params }) => {
      const m = params.get('mode');
      if (m === 'scout' || m === 'lookup') return 'scout';
      if (m === 'watchlist') return 'watchlist';
      if (m === 'searches') return 'searches';
      if (m === 'suppliers') return 'suppliers';
      return 'queue';
    },
  },
  // ── Amazon FBA ────────────────────────────────────────────────────────────
  // `?mode=plan|combine|shipped`; default `combine` (param cleared).
  {
    id: 'fba', label: 'Amazon FBA', href: FBA, icon: Boxes, kind: 'main', requires: 'fba.view',
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
  // ── Outbound ──────────────────────────────────────────────────────────────
  // `?mode=labels|scan-out`; default `labels` (param cleared).
  {
    id: 'outbound', label: 'Outbound', href: OUTBOUND, icon: Truck, kind: 'station', requires: 'shipping.view',
    modes: [
      { id: 'labels',   label: 'Labels',   icon: Printer, to: () => ({ pathname: OUTBOUND, params: { mode: null, q: null, open: null, sort: null } }) },
      { id: 'scan-out', label: 'Scan out', icon: Barcode, to: () => ({ pathname: OUTBOUND, params: { mode: 'scan-out', q: null, open: null, sort: null } }) },
    ],
    resolveMode: ({ params }) => (params.get('mode') === 'scan-out' ? 'scan-out' : 'labels'),
  },
  // ── Packing ───────────────────────────────────────────────────────────────
  // `?packMode=fragile|multi`; default `standard` (param cleared). Mirrors the
  // panel's own `?packMode=` derivation so deep-links resolve identically.
  {
    id: 'packer', label: 'Packing', href: PACK, icon: Box, kind: 'station', requires: 'packing.view',
    modes: [
      { id: 'standard', label: 'Standard',   icon: Box,           to: () => ({ pathname: PACK, params: { packMode: null } }) },
      { id: 'fragile',  label: 'Fragile',    icon: AlertTriangle, to: () => ({ pathname: PACK, params: { packMode: 'fragile' } }) },
      { id: 'multi',    label: 'Multi-Item', icon: Boxes,         to: () => ({ pathname: PACK, params: { packMode: 'multi' } }) },
    ],
    resolveMode: ({ params }) => {
      const m = params.get('packMode');
      return m === 'fragile' || m === 'multi' ? m : 'standard';
    },
  },
  // ── Inventory ─────────────────────────────────────────────────────────────
  // `?mode=triage|pulse` or `?section=replenish`; default `ledger`.
  {
    id: 'inventory', label: 'Inventory', href: INVENTORY, icon: ShelvingUnit, kind: 'main', requires: 'sku_stock.view',
    modes: [
      // `open: null` on every switch so a selection (exception/unit id) from one
      // mode never leaks into another's right pane.
      { id: 'ledger',    label: 'Ledger',    icon: Clipboard,  to: () => ({ pathname: INVENTORY, params: { mode: null, section: null, open: null } }) },
      { id: 'triage',    label: 'Triage',    icon: Zap,        to: () => ({ pathname: `${INVENTORY}/triage`, params: { mode: null, section: null, open: null } }) },
      { id: 'pulse',     label: 'Pulse',     icon: TrendingUp, to: () => ({ pathname: `${INVENTORY}/pulse`, params: { mode: null, section: null, open: null } }) },
      { id: 'graph',     label: 'Graph',     icon: Layers,     to: () => ({ pathname: `${INVENTORY}/graph`, params: { mode: null, section: null, open: null } }) },
      { id: 'replenish', label: 'Replenish', icon: History,    to: () => ({ pathname: INVENTORY, params: { section: 'replenish', mode: null, open: null } }) },
    ],
    resolveMode: ({ pathname, params }) => {
      // Path-based modes (consistent with graph). Legacy `?mode=` still resolves.
      if (pathname.startsWith(`${INVENTORY}/graph`)) return 'graph';
      if (pathname.startsWith(`${INVENTORY}/triage`)) return 'triage';
      if (pathname.startsWith(`${INVENTORY}/pulse`)) return 'pulse';
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
    id: 'warehouse', label: 'Warehouse', href: WAREHOUSE, icon: Warehouse, kind: 'main', requires: 'sku_stock.view',
    modes: [
      { id: 'labels', label: 'Labels', icon: Printer,  to: () => ({ pathname: WAREHOUSE, params: { tab: null } }) },
      { id: 'racks',  label: 'Racks',  icon: Layers,   to: () => ({ pathname: WAREHOUSE, params: { tab: 'racks' } }) },
      { id: 'rooms',  label: 'Rooms',  icon: DoorOpen, to: () => ({ pathname: WAREHOUSE, params: { tab: 'rooms' } }) },
      { id: 'bins',   label: 'Bins',   icon: Archive,  to: () => ({ pathname: WAREHOUSE, params: { tab: 'bins' } }) },
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
    id: 'products', label: 'Products', href: PRODUCTS, icon: Tags, kind: 'main', requires: 'sku_stock.view',
    modes: [
      { id: 'manuals', label: 'Manuals', icon: FileText, to: () => ({ pathname: PRODUCTS, params: { view: null } }) },
      { id: 'labels',  label: 'Labels',  icon: Barcode,  to: () => ({ pathname: PRODUCTS, params: { view: 'labels' } }) },
      { id: 'pairing', label: 'Pairing', icon: Link2,    to: () => ({ pathname: PRODUCTS, params: { view: 'pairing' } }) },
      { id: 'qc',      label: 'QC',      icon: Check,     to: () => ({ pathname: PRODUCTS, params: { view: 'qc' } }) },
      { id: 'kit',     label: 'Kit Parts', icon: PackageOpen, to: () => ({ pathname: PRODUCTS, params: { view: 'kit' } }) },
    ],
    resolveMode: ({ params }) => {
      const v = params.get('view');
      return v === 'labels' || v === 'pairing' || v === 'qc' || v === 'kit' ? v : 'manuals';
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
  // Data Wipe (`/wipe`) is temporarily absent from master nav — revisit when the
  // station UX is ready for general rollout. Route + `tech.data_wipe` gate remain.
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
  // ── Support ───────────────────────────────────────────────────────────────
  // `?mode=voicemail|calls`; bare /support = the Zendesk Tickets console
  // (default, param cleared) for deep-link back-compat. Voicemail is a Workbench
  // (pick a follow-up → detail), Calls is a Monitor (observe the call stream).
  // Every switch clears the mode-scoped params (selection, search, filters) so
  // each mode opens clean.
  {
    id: 'support', label: 'Support', href: SUPPORT, icon: AlertCircle, kind: 'bottom', requires: 'integrations.zendesk',
    modes: [
      { id: 'tickets',   label: 'Tickets',   icon: Inbox,     to: () => ({ pathname: SUPPORT, params: { mode: null,        ticket: null, vm: null, q: null, status: null, assignee: null, direction: null, range: null } }) },
      { id: 'voicemail', label: 'Voicemail', icon: Voicemail, to: () => ({ pathname: SUPPORT, params: { mode: 'voicemail', ticket: null, vm: null, q: null, status: null, assignee: null, direction: null, range: null } }) },
      { id: 'calls',     label: 'Calls',     icon: Phone,     to: () => ({ pathname: SUPPORT, params: { mode: 'calls',     ticket: null, vm: null, q: null, status: null, assignee: null, direction: null, range: null } }) },
    ],
    resolveMode: ({ params }) => {
      const m = params.get('mode');
      if (m === 'voicemail') return 'voicemail';
      if (m === 'calls') return 'calls';
      return 'tickets';
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
 * modeless pages (operations, packer, support, ai-chat,
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
