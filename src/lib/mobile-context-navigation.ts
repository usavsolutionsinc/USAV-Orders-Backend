import type { ReadonlyURLSearchParams } from 'next/navigation';
import { APP_SIDEBAR_NAV, getSidebarRouteKey, type SidebarRouteKey } from '@/lib/sidebar-navigation';
import {
  getActiveSettingsSection,
  type SettingsSection,
} from '@/components/sidebar/SettingsSidebarPanel';
import {
  getDashboardOrderViewFromSearch,
  normalizeDashboardOrderViewParams,
  type DashboardOrderView,
} from '@/utils/dashboard-search-state';

export interface MobileContextOption {
  id: string;
  label: string;
  description?: string;
}

/** Row-1 app title from the current pathname (matches sidebar nav labels). */
export function getMobileAppTitle(pathname: string | null): string {
  if (pathname === '/m/home' || pathname?.startsWith('/m/home/')) return 'Home';
  const key = getSidebarRouteKey(pathname);
  const nav = APP_SIDEBAR_NAV.find((item) => item.id === key);
  return nav?.label || 'USAV';
}

export interface MobileContextRowConfig {
  /** Label for the active subsection (row 2 center). */
  activeLabel: string;
  options: MobileContextOption[];
  activeId: string;
  onSelect: (id: string) => void;
}

const DASHBOARD_VIEW_OPTIONS: MobileContextOption[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'unshipped', label: 'Awaiting' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'fba', label: 'FBA' },
];

const RECEIVING_MODE_OPTIONS: MobileContextOption[] = [
  { id: 'receive', label: 'Receiving' },
  { id: 'history', label: 'History' },
  { id: 'unfound', label: 'Unfound' },
  { id: 'pickup', label: 'Local Pick Up' },
];

const WALK_IN_MODE_OPTIONS: MobileContextOption[] = [
  { id: 'repairs', label: 'Repairs' },
  { id: 'sales', label: 'Sales' },
];

const SETTINGS_SECTION_OPTIONS: MobileContextOption[] = [
  { id: 'hardware', label: 'Hardware' },
  { id: 'quick-access', label: 'Quick Access' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'security', label: 'Security' },
  { id: 'staff', label: 'Staff' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'operations-log', label: 'Operations log' },
  { id: 'about', label: 'About' },
];

const SETTINGS_REQUIRES: Partial<Record<SettingsSection, string>> = {
  staff: 'admin.manage_staff',
  sessions: 'admin.view_sessions',
  'operations-log': 'admin.view_logs',
};

export function getMobileContextRowConfig(
  routeKey: SidebarRouteKey,
  searchParams: ReadonlyURLSearchParams,
  navigate: (href: string) => void,
  hasPermission: (perm: string) => boolean,
  isAuthLoaded: boolean,
  isSignedIn: boolean,
  pathname: string | null = null,
): MobileContextRowConfig | null {
  switch (routeKey) {
    case 'dashboard': {
      const activeId = getDashboardOrderViewFromSearch(searchParams);
      const active = DASHBOARD_VIEW_OPTIONS.find((o) => o.id === activeId);
      return {
        activeLabel: active?.label ?? 'Pending',
        activeId,
        options: DASHBOARD_VIEW_OPTIONS,
        onSelect: (id) => {
          const params = new URLSearchParams(searchParams.toString());
          normalizeDashboardOrderViewParams(params, id as DashboardOrderView);
          const qs = params.toString();
          navigate(qs ? `/dashboard?${qs}` : '/dashboard');
        },
      };
    }
    case 'settings': {
      const activeId = getActiveSettingsSection(searchParams.get('section'));
      const visible = SETTINGS_SECTION_OPTIONS.filter((opt) => {
        const requires = SETTINGS_REQUIRES[opt.id as SettingsSection];
        if (opt.id === 'security' && (!isAuthLoaded || !isSignedIn)) return false;
        if (!requires) return true;
        if (!isAuthLoaded) return false;
        return hasPermission(requires);
      });
      const active = visible.find((o) => o.id === activeId) ?? visible[0];
      return {
        activeLabel: active?.label ?? 'Settings',
        activeId: active?.id ?? activeId,
        options: visible,
        onSelect: (id) => {
          const params = new URLSearchParams(searchParams.toString());
          params.set('section', id);
          navigate(`/settings?${params.toString()}`);
        },
      };
    }
    case 'receiving': {
      const onUnfound =
        pathname === '/receiving/unfound' || pathname?.startsWith('/receiving/unfound/');
      const qsMode = searchParams.get('mode');
      const activeId = onUnfound
        ? 'unfound'
        : qsMode === 'pickup'
          ? 'pickup'
          : qsMode === 'history'
            ? 'history'
            : 'receive';
      const active = RECEIVING_MODE_OPTIONS.find((o) => o.id === activeId);
      return {
        activeLabel: active?.label ?? 'Receiving',
        activeId,
        options: RECEIVING_MODE_OPTIONS,
        onSelect: (id) => {
          if (id === 'unfound') {
            navigate('/receiving/unfound');
            return;
          }
          const params = new URLSearchParams(searchParams.toString());
          if (id === 'pickup') {
            params.set('mode', 'pickup');
          } else {
            params.set('mode', id);
          }
          navigate(`/receiving?${params.toString()}`);
        },
      };
    }
    case 'walk-in': {
      const activeId = searchParams.get('mode') === 'sales' ? 'sales' : 'repairs';
      const active = WALK_IN_MODE_OPTIONS.find((o) => o.id === activeId);
      return {
        activeLabel: active?.label ?? 'Repairs',
        activeId,
        options: WALK_IN_MODE_OPTIONS,
        onSelect: (id) => {
          const params = new URLSearchParams(searchParams.toString());
          params.set('mode', id);
          navigate(`/walk-in?${params.toString()}`);
        },
      };
    }
    default:
      return null;
  }
}

/** Routes that expose a second header row with in-page section switching. */
export function routeHasMobileContextRow(routeKey: SidebarRouteKey): boolean {
  return (
    routeKey === 'dashboard' ||
    routeKey === 'settings' ||
    routeKey === 'receiving' ||
    routeKey === 'walk-in'
  );
}
