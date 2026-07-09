import type { ReadonlyURLSearchParams } from 'next/navigation';
import { APP_SIDEBAR_NAV, getSidebarRouteKey, type SidebarRouteKey } from '@/lib/sidebar-navigation';
import {
  getActiveSettingsSection,
  resolveSettingsSectionFromPath,
  SETTINGS_SECTION_OPTIONS as SETTINGS_REGISTRY,
  type SettingsSection,
} from '@/components/settings/settings-sections';
import {
  getDashboardOrderViewFromSearch,
  normalizeDashboardOrderViewParams,
  type DashboardOrderView,
} from '@/utils/dashboard-search-state';
import { PRODUCT_NAME } from '@/lib/branding/constants';

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
  return nav?.label || PRODUCT_NAME;
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
  { id: 'triage', label: 'Receiving' },
  { id: 'receive', label: 'Unbox' },
  { id: 'history', label: 'History' },
  { id: 'pickup', label: 'Local Pick Up' },
];

const WALK_IN_MODE_OPTIONS: MobileContextOption[] = [
  { id: 'repairs', label: 'Repairs' },
  { id: 'sales', label: 'Sales' },
];

const SETTINGS_SECTION_OPTIONS: MobileContextOption[] = SETTINGS_REGISTRY.map((s) => ({
  id: s.id,
  label: s.label,
}));

const SETTINGS_REQUIRES: Partial<Record<SettingsSection, string>> = {
  team: 'admin.manage_staff',
  roles: 'admin.manage_roles',
  organization: 'admin.view',
  billing: 'admin.view',
  integrations: 'admin.view',
  catalog: 'admin.manage_features',
  sessions: 'admin.view_sessions',
  audit: 'admin.view_logs',
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
      const activeId =
        resolveSettingsSectionFromPath(pathname)
        ?? getActiveSettingsSection(searchParams.get('section'));
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
          const def = SETTINGS_REGISTRY.find((s) => s.id === id);
          if (def?.href) {
            navigate(def.href);
            return;
          }
          const params = new URLSearchParams(searchParams.toString());
          params.set('section', id);
          navigate(`/settings?${params.toString()}`);
        },
      };
    }
    case 'receiving': {
      const qsMode = searchParams.get('mode');
      const activeId =
        qsMode === 'pickup'
          ? 'pickup'
          : qsMode === 'history'
            ? 'history'
            : qsMode === 'triage'
              ? 'triage'
              : 'receive';
      const active = RECEIVING_MODE_OPTIONS.find((o) => o.id === activeId);
      return {
        activeLabel: active?.label ?? 'Receiving',
        activeId,
        options: RECEIVING_MODE_OPTIONS,
        onSelect: (id) => {
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
