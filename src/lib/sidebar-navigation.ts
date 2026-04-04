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
  ShieldCheck,
  Tool,
  User,
  Wrench,
  Zap,
} from '@/components/Icons';

export type SidebarRouteKey =
  | 'dashboard'
  | 'operations'
  | 'fba'
  | 'receiving'
  | 'repair'
  | 'work-orders'
  | 'sku-stock'
  | 'tech'
  | 'packer'
  | 'support'
  | 'previous-quarters'
  | 'admin'
  | 'manuals'
  | 'ai'
  | 'unknown';

export type SidebarIconComponent = (props: { className?: string }) => JSX.Element;

export interface SidebarNavItem {
  id: string;
  label: string;
  href: string;
  icon: SidebarIconComponent;
  kind?: 'main' | 'station' | 'bottom';
}

const MOBILE_RESTRICTED_SIDEBAR_IDS = new Set<SidebarRouteKey>([
  'operations',
  'work-orders',
  'manuals',
  'support',
  'previous-quarters',
  'admin',
]);

export const APP_SIDEBAR_NAV: SidebarNavItem[] = [
  { id: 'operations', label: 'Operations', href: '/operations', icon: Monitor, kind: 'main' },
  { id: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, kind: 'main' },
  { id: 'fba', label: 'FBA', href: '/fba', icon: Package, kind: 'main' },
  { id: 'repair', label: 'Repair', href: '/repair', icon: Tool, kind: 'main' },
  { id: 'work-orders', label: 'Work Orders', href: '/work-orders', icon: PackageCheck, kind: 'main' },
  { id: 'receiving', label: 'Receiving', href: '/receiving', icon: ClipboardList, kind: 'station' },
  { id: 'tech', label: 'Technicians', href: '/tech?staffId=1', icon: Wrench, kind: 'station' },
  { id: 'packer', label: 'Packers', href: '/packer?staffId=4', icon: User, kind: 'station' },
  { id: 'sku-stock', label: 'Sku Stock', href: '/sku-stock', icon: Box, kind: 'station' },
  { id: 'ai', label: 'AI Chat', href: '/ai', icon: Zap, kind: 'bottom' },
  { id: 'manuals', label: 'Manuals', href: '/manuals', icon: FileText, kind: 'bottom' },
  { id: 'support', label: 'Support', href: '/support', icon: AlertCircle, kind: 'bottom' },
  { id: 'previous-quarters', label: 'Quarters', href: '/previous-quarters', icon: Calendar, kind: 'bottom' },
  { id: 'admin', label: 'Admin', href: '/admin', icon: ShieldCheck, kind: 'bottom' },
];

export function isSidebarRouteMobileRestricted(routeKey: SidebarRouteKey): boolean {
  return MOBILE_RESTRICTED_SIDEBAR_IDS.has(routeKey);
}

export function getSidebarNavItems({ mobileRestricted = false }: { mobileRestricted?: boolean } = {}): SidebarNavItem[] {
  if (!mobileRestricted) return APP_SIDEBAR_NAV;
  return APP_SIDEBAR_NAV.filter((item) => !isSidebarRouteMobileRestricted(item.id as SidebarRouteKey));
}

export function getSidebarRouteKey(pathname: string | null): SidebarRouteKey {
  if (!pathname) return 'unknown';
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) return 'dashboard';
  if (pathname === '/operations' || pathname.startsWith('/operations/')) return 'operations';
  if (pathname === '/fba' || pathname.startsWith('/fba/')) return 'fba';
  if (pathname === '/receiving' || pathname.startsWith('/receiving/')) return 'receiving';
  if (pathname === '/repair' || pathname.startsWith('/repair/')) return 'repair';
  if (pathname === '/work-orders' || pathname.startsWith('/work-orders/')) return 'work-orders';
  if (pathname === '/sku-stock' || pathname.startsWith('/sku-stock/')) return 'sku-stock';
  if (pathname === '/support' || pathname.startsWith('/support/')) return 'support';
  if (pathname === '/previous-quarters' || pathname.startsWith('/previous-quarters/')) return 'previous-quarters';
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
  if (pathname === '/tech' || pathname.startsWith('/tech/')) return 'tech';
  if (pathname === '/packer' || pathname.startsWith('/packer/')) return 'packer';
  if (pathname === '/manuals' || pathname.startsWith('/manuals/')) return 'manuals';
  if (pathname === '/ai' || pathname.startsWith('/ai/')) return 'ai';
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
