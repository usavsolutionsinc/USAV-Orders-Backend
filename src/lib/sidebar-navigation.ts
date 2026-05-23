import {
  AlertCircle,
  Box,
  Calendar,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Monitor,
  Package,
  PackageCheck,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Tool,
  User,
  Wrench,
  Zap,
  RefreshCw,
} from '@/components/Icons';

export type SidebarRouteKey =
  | 'dashboard'
  | 'operations'
  | 'fba'
  | 'receiving'
  | 'walk-in'
  | 'repair'
  | 'work-orders'
  | 'replenish'
  | 'inventory'
  | 'products'
  | 'warehouse'
  | 'tech'
  | 'packer'
  | 'support'
  | 'previous-quarters'
  | 'admin'
  | 'audit-log'
  | 'manuals'
  | 'manuals-library'
  | 'ai'
  | 'settings'
  | 'billing'
  | 'integrations'
  | 'staff'
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

/**
 * Sidebar items that should never appear in the mobile drawer. Used for
 * filtering the visible nav — actual route gating happens via the
 * pathname allowlist in {@link isMobileAllowedPath}.
 */
const MOBILE_RESTRICTED_SIDEBAR_IDS = new Set<SidebarRouteKey>([
  'operations',
  'work-orders',
  'manuals',
  'manuals-library',
  'support',
  'previous-quarters',
  'admin',
  'audit-log',
  'dashboard',
  'fba',
  'walk-in',
  'replenish',
  'products',
  'inventory',
  'warehouse',
  'ai',
  'billing',
  'integrations',
  'staff',
  'settings',
]);

/**
 * Mobile-allowed route prefixes. Mobile devices can only land on these —
 * everything else gets redirected to /m/home (the scan-first homepage)
 * by ResponsiveLayout. Intentionally narrow: a warehouse phone is a
 * dedicated scanning device, not a portal into the full back-office app.
 *
 * Allowlist (prefixes; trailing-slash and full-match both accepted):
 *   • `/m`            — mobile root + every /m/* page (home, scan, history, single-record detail)
 *   • `/signin`       — sign-in
 *   • `/receiving`    — receiving station (camera-first photo flow)
 *   • `/packer`       — packing station (camera-first photo flow)
 *   • `/tech`         — testing / technician station
 *   • `/01`, `/414`   — GS1 Digital Link landing pages (deep links from scans)
 *
 * To add a new mobile-allowed surface, extend MOBILE_ALLOWED_PREFIXES.
 */
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
  { id: 'fba',               label: 'Amazon FBA',  href: '/fba',                icon: Package,         kind: 'main',    requires: 'fba.view' },
  { id: 'walk-in',           label: 'Walk-In',     href: '/walk-in',            icon: ShoppingCart,    kind: 'main',    requires: 'walk_in.view' },
  { id: 'work-orders',       label: 'Work Orders', href: '/work-orders',        icon: PackageCheck,    kind: 'main',    requires: 'work_orders.view' },
  { id: 'replenish',         label: 'Replenish',   href: '/replenish',          icon: RefreshCw,       kind: 'main',    requires: 'replenish.view' },
  { id: 'receiving',         label: 'Receiving',   href: '/receiving',          icon: ClipboardList,   kind: 'station', requires: 'receiving.view' },
  { id: 'tech',              label: 'Testing',     href: '/tech',               icon: Wrench,          kind: 'station', requires: 'tech.view' },
  { id: 'packer',            label: 'Packing',     href: '/packer',             icon: User,            kind: 'station', requires: 'packing.view' },
  { id: 'products',          label: 'Products',    href: '/products',           icon: Box,             kind: 'station', requires: 'sku_stock.view' },
  { id: 'inventory',         label: 'Inventory',   href: '/inventory',          icon: Package,         kind: 'station', requires: 'sku_stock.view' },
  { id: 'warehouse',         label: 'Warehouse',   href: '/warehouse',          icon: Package,         kind: 'station', requires: 'sku_stock.view' },
  { id: 'ai',                label: 'AI Chat',     href: '/ai',                 icon: Zap,             kind: 'bottom' },
  // /manuals folded into /products as the default Manuals view. The /manuals
  // URL still resolves (it redirects to /products), so external links keep
  // working — but the standalone bottom-nav entry is gone.
  { id: 'support',           label: 'Support',     href: '/support',            icon: AlertCircle,     kind: 'bottom' },
  { id: 'previous-quarters', label: 'Quarters',    href: '/previous-quarters',  icon: Calendar,        kind: 'bottom', requires: 'reports.view' },
  { id: 'audit-log',         label: 'Audit Log',   href: '/settings/audit',     icon: FileText,        kind: 'bottom', requires: 'admin.view_logs' },
  { id: 'staff',             label: 'Team',         href: '/settings/staff',    icon: User,            kind: 'bottom', requires: 'admin.manage_staff' },
  { id: 'billing',           label: 'Billing',      href: '/settings/billing',   icon: ShieldCheck,     kind: 'bottom', requires: 'admin.view' },
  { id: 'integrations',      label: 'Integrations', href: '/settings/integrations', icon: Zap,         kind: 'bottom', requires: 'admin.view' },
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
  if (pathname === '/work-orders' || pathname.startsWith('/work-orders/')) return 'work-orders';
  if (pathname === '/replenish' || pathname.startsWith('/replenish/')) return 'replenish';
  if (pathname === '/products' || pathname.startsWith('/products/')) return 'products';
  if (pathname === '/warehouse' || pathname.startsWith('/warehouse/')) return 'warehouse';
  if (pathname === '/inventory' || pathname.startsWith('/inventory/')) return 'inventory';
  if (pathname === '/support' || pathname.startsWith('/support/')) return 'support';
  if (pathname === '/previous-quarters' || pathname.startsWith('/previous-quarters/')) return 'previous-quarters';
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
  if (pathname === '/audit-log' || pathname.startsWith('/audit-log/')) return 'audit-log';
  if (pathname === '/settings/audit' || pathname.startsWith('/settings/audit/')) return 'audit-log';
  if (pathname === '/tech' || pathname.startsWith('/tech/')) return 'tech';
  if (pathname === '/packer' || pathname.startsWith('/packer/')) return 'packer';
  if (pathname === '/manuals/library' || pathname.startsWith('/manuals/library/')) return 'manuals-library';
  // /manuals folded into /products — anyone landing on the legacy URL gets
  // the Products sidebar (the page-level redirect runs in parallel).
  if (pathname === '/manuals' || pathname.startsWith('/manuals/')) return 'products';
  if (pathname === '/ai' || pathname.startsWith('/ai/')) return 'ai';
  // /settings/billing and /settings/integrations are leaf-routes under settings
  // but should highlight their own sidebar entry, not the bare Settings link.
  if (pathname === '/settings/billing' || pathname.startsWith('/settings/billing/')) return 'billing';
  if (pathname === '/settings/integrations' || pathname.startsWith('/settings/integrations/')) return 'integrations';
  if (pathname === '/settings/staff' || pathname.startsWith('/settings/staff/')) return 'staff';
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
  { prefix: '/work-orders',        permission: 'work_orders.view' },
  { prefix: '/replenish',          permission: 'replenish.view' },
  { prefix: '/receiving',          permission: 'receiving.view' },
  { prefix: '/tech',               permission: 'tech.view' },
  { prefix: '/packer',             permission: 'packing.view' },
  { prefix: '/packers',            permission: 'packing.view' },
  { prefix: '/products',           permission: 'sku_stock.view' },
  { prefix: '/warehouse',          permission: 'sku_stock.view' },
  { prefix: '/inventory',          permission: 'sku_stock.view' },
  { prefix: '/previous-quarters',  permission: 'reports.view' },
  // /settings is intentionally NOT gated — every signed-in user can manage
  // their own workstation/appearance settings; admin tabs gate themselves.
  // /manuals, /support, /ai are always visible.
];

export function permissionForPath(pathname: string): string | null {
  for (const entry of ROUTE_PERMISSIONS) {
    if (pathname === entry.prefix || pathname.startsWith(entry.prefix + '/')) {
      return entry.permission;
    }
  }
  return null;
}
