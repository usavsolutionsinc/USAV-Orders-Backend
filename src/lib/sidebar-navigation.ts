import {
  AlertCircle,
  Box,
  Calendar,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Package,
  ShieldCheck,
  Tool,
  User,
  Wrench,
} from '@/components/Icons';

export type SidebarRouteKey =
  | 'dashboard'
  | 'fba'
  | 'receiving'
  | 'repair'
  | 'sku-stock'
  | 'tech'
  | 'packer'
  | 'support'
  | 'previous-quarters'
  | 'admin'
  | 'manuals'
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
  { id: 'fba', label: 'FBA', href: '/fba', icon: Package, kind: 'main' },
  { id: 'repair', label: 'Repair', href: '/repair', icon: Tool, kind: 'main' },
  { id: 'sku-stock', label: 'Sku Stock', href: '/sku-stock', icon: Box, kind: 'main' },
  { id: 'receiving', label: 'Receiving', href: '/receiving', icon: ClipboardList, kind: 'station' },
  { id: 'tech', label: 'Technicians', href: '/tech?staffId=1', icon: Wrench, kind: 'station' },
  { id: 'packer', label: 'Packers', href: '/packer?staffId=4', icon: User, kind: 'station' },
  { id: 'support', label: 'Support', href: '/support', icon: AlertCircle, kind: 'bottom' },
  { id: 'previous-quarters', label: 'Quarters', href: '/previous-quarters', icon: Calendar, kind: 'bottom' },
  { id: 'admin', label: 'Admin', href: '/admin', icon: ShieldCheck, kind: 'bottom' },
  { id: 'manuals', label: 'Manuals', href: '/manuals', icon: FileText, kind: 'bottom' },
];

export function getSidebarRouteKey(pathname: string | null): SidebarRouteKey {
  if (!pathname) return 'unknown';
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) return 'dashboard';
  if (pathname === '/fba' || pathname.startsWith('/fba/')) return 'fba';
  if (pathname === '/receiving' || pathname.startsWith('/receiving/')) return 'receiving';
  if (pathname === '/repair' || pathname.startsWith('/repair/')) return 'repair';
  if (pathname === '/sku-stock' || pathname.startsWith('/sku-stock/')) return 'sku-stock';
  if (pathname === '/support' || pathname.startsWith('/support/')) return 'support';
  if (pathname === '/previous-quarters' || pathname.startsWith('/previous-quarters/')) return 'previous-quarters';
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
  if (pathname === '/tech' || pathname.startsWith('/tech/')) return 'tech';
  if (pathname === '/packer' || pathname.startsWith('/packer/')) return 'packer';
  if (pathname === '/manuals' || pathname.startsWith('/manuals/')) return 'manuals';
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
