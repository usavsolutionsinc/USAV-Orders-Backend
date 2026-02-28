import {
  Box,
  Calendar,
  ClipboardList,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Tool,
  User,
  Wrench,
} from '@/components/Icons';

export type SidebarRouteKey =
  | 'dashboard'
  | 'shipped'
  | 'receiving'
  | 'repair'
  | 'sku-stock'
  | 'tech'
  | 'packer'
  | 'sku'
  | 'previous-quarters'
  | 'admin'
  | 'unknown';

export type SidebarIconComponent = (props: { className?: string }) => JSX.Element;

export interface SidebarNavItem {
  id: string;
  label: string;
  href: string;
  icon: SidebarIconComponent;
  kind?: 'main' | 'station' | 'bottom';
}

export const APP_SIDEBAR_NAV: SidebarNavItem[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, kind: 'main' },
  { id: 'receiving', label: 'Receiving', href: '/receiving', icon: ClipboardList, kind: 'main' },
  { id: 'repair', label: 'Repair', href: '/repair', icon: Tool, kind: 'main' },
  { id: 'sku-stock', label: 'Sku Stock', href: '/sku-stock', icon: Box, kind: 'main' },
  { id: 'tech', label: 'Technicians', href: '/tech/1', icon: Wrench, kind: 'station' },
  { id: 'packer', label: 'Packers', href: '/packer/4', icon: User, kind: 'station' },
  { id: 'sku', label: 'Sku Manager', href: '/sku', icon: Settings, kind: 'bottom' },
  { id: 'previous-quarters', label: 'Quarters', href: '/previous-quarters', icon: Calendar, kind: 'bottom' },
  { id: 'admin', label: 'Admin', href: '/admin', icon: ShieldCheck, kind: 'bottom' },
];

export function getSidebarRouteKey(pathname: string | null): SidebarRouteKey {
  if (!pathname) return 'unknown';
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) return 'dashboard';
  if (pathname === '/shipped' || pathname.startsWith('/shipped/')) return 'shipped';
  if (pathname === '/receiving' || pathname.startsWith('/receiving/')) return 'receiving';
  if (pathname === '/repair' || pathname.startsWith('/repair/')) return 'repair';
  if (pathname === '/sku-stock' || pathname.startsWith('/sku-stock/')) return 'sku-stock';
  if (pathname === '/sku' || pathname.startsWith('/sku/')) return 'sku';
  if (pathname === '/previous-quarters' || pathname.startsWith('/previous-quarters/')) return 'previous-quarters';
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
  if (/^\/tech\/\d+/.test(pathname)) return 'tech';
  if (/^\/packer\/\d+/.test(pathname)) return 'packer';
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
