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
  | 'sku-stock'
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
  | 'ai'
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
  'work-orders',
  'manuals',
  'support',
  'previous-quarters',
  'admin',
  'audit-log',
]);

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
  { id: 'manuals',           label: 'Manuals',     href: '/manuals',            icon: FileText,        kind: 'bottom' },
  { id: 'support',           label: 'Support',     href: '/support',            icon: AlertCircle,     kind: 'bottom' },
  { id: 'previous-quarters', label: 'Quarters',    href: '/previous-quarters',  icon: Calendar,        kind: 'bottom', requires: 'reports.view' },
  { id: 'audit-log',         label: 'Audit Log',   href: '/audit-log/receiving', icon: FileText,       kind: 'bottom', requires: 'admin.view_logs' },
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
  if (pathname === '/sku-stock' || pathname.startsWith('/sku-stock/')) return 'sku-stock';
  if (pathname === '/inventory' || pathname.startsWith('/inventory/')) return 'inventory';
  if (pathname === '/support' || pathname.startsWith('/support/')) return 'support';
  if (pathname === '/previous-quarters' || pathname.startsWith('/previous-quarters/')) return 'previous-quarters';
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
  if (pathname === '/audit-log' || pathname.startsWith('/audit-log/')) return 'audit-log';
  if (pathname === '/tech' || pathname.startsWith('/tech/')) return 'tech';
  if (pathname === '/packer' || pathname.startsWith('/packer/')) return 'packer';
  if (pathname === '/manuals' || pathname.startsWith('/manuals/')) return 'manuals';
  if (pathname === '/ai' || pathname.startsWith('/ai/')) return 'ai';
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
  { prefix: '/sku-stock',          permission: 'sku_stock.view' },
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
