'use client';

import { useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { sidebarHeaderBandClass, SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { ChevronDown, Settings as SettingsIcon } from '@/components/Icons';
import { SidebarSectionList, type SidebarSection } from '@/components/sidebar/SidebarSectionList';
import { useAuth } from '@/contexts/AuthContext';
import {
  SETTINGS_SECTION_OPTIONS,
  resolveSettingsSectionFromPath,
  type SettingsSection,
} from '@/components/settings/settings-sections';
import { AccessSidebarPanel } from '@/components/admin/AccessSidebarPanel';
import { RolesSidebarPanel } from '@/components/admin/RolesSidebarPanel';

const ICON_CLS = 'h-4 w-4 shrink-0';

function sectionIcon(id: SettingsSection) {
  switch (id) {
    case 'hardware':
      return (
        <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 6 2 18 2 18 9" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" rx="1" />
        </svg>
      );
    case 'workstation':
      return (
        <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <line x1="8" y1="20" x2="16" y2="20" />
          <line x1="12" y1="16" x2="12" y2="20" />
        </svg>
      );
    case 'quick-access':
      return (
        <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      );
    case 'appearance':
      return (
        <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      );
    case 'security':
      return (
        <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      );
    case 'about':
      return (
        <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      );
    case 'legal':
      return (
        <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="9" y1="13" x2="15" y2="13" />
          <line x1="9" y1="17" x2="13" y2="17" />
        </svg>
      );
    case 'organization':
      return (
        <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 21h18" />
          <path d="M5 21V7l8-4v18" />
          <path d="M19 21V11l-6-4" />
        </svg>
      );
    case 'billing':
      return (
        <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <line x1="2" y1="10" x2="22" y2="10" />
        </svg>
      );
    case 'integrations':
      return (
        <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      );
    case 'ai':
      return (
        <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <path d="M11 8v6M8 11h6" />
        </svg>
      );
    case 'catalog':
      return (
        <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
      );
    case 'team':
      return (
        <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'roles':
      return (
        <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      );
    case 'access':
      return (
        <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      );
    case 'sessions':
      return (
        <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      );
    case 'audit':
      return (
        <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      );
    default:
      return null;
  }
}

type SettingsSidebarMode = 'overview' | 'roles' | 'access';

function resolveMode(pathname: string | null): SettingsSidebarMode {
  if (pathname === '/settings/roles') return 'roles';
  if (pathname === '/settings/access') return 'access';
  return 'overview';
}

export function SettingsSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { has, isLoaded, user } = useAuth();
  const mode = resolveMode(pathname);

  const active: SettingsSection =
    resolveSettingsSectionFromPath(pathname)
    ?? (searchParams?.get('section') as SettingsSection | null)
    ?? 'hardware';

  const visible = useMemo(() => {
    return SETTINGS_SECTION_OPTIONS
      .filter((s) => {
        if (s.id === 'security' && (!isLoaded || !user)) return false;
        if (!s.requires) return true;
        if (!isLoaded) return false;
        return has(s.requires);
      })
      .map((s): SidebarSection<SettingsSection> => ({
        id: s.id,
        label: s.label,
        description: s.description,
        group: s.group,
        requires: s.requires,
        icon: sectionIcon(s.id),
      }));
  }, [has, isLoaded, user]);

  const navigateSection = useCallback(
    (section: SettingsSection) => {
      const def = SETTINGS_SECTION_OPTIONS.find((s) => s.id === section);
      if (def?.href) {
        router.replace(def.href);
        return;
      }
      const params = new URLSearchParams(searchParams?.toString());
      params.set('section', section);
      router.replace(`/settings?${params.toString()}`);
    },
    [router, searchParams],
  );

  const sectionLabel = SETTINGS_SECTION_OPTIONS.find((s) => s.id === active)?.label ?? '';

  if (mode === 'overview') {
    return (
      <div className="h-full flex flex-col overflow-hidden bg-surface-card">
        <div className="min-h-0 flex-1 overflow-hidden">
          <SidebarSectionList
            sections={visible}
            active={active}
            onSelect={navigateSection}
            ariaLabel="Settings sections"
            gutterClassName="px-3"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-surface-card">
      <div className={`${sidebarHeaderBandClass} ${SIDEBAR_GUTTER} py-2`}>
        <button
          type="button"
          onClick={() => router.replace('/settings')}
          className="ds-raw-button group flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium text-text-muted hover:bg-surface-sunken transition-colors"
          aria-label="Back to settings overview"
        >
          <SettingsIcon className="h-5 w-5 text-blue-600" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black tracking-tight text-text-default uppercase tracking-wider">
              Settings{sectionLabel ? ` · ${sectionLabel}` : ''}
            </p>
          </div>
          <ChevronDown className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity text-text-faint" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === 'roles' ? <RolesSidebarPanel basePath="/settings/roles" /> : null}
        {mode === 'access' ? <AccessSidebarPanel basePath="/settings/access" /> : null}
      </div>
    </div>
  );
}

/** @deprecated Use SettingsSidebar — kept for imports that haven't migrated. */
export function SettingsSidebarPanel() {
  return <SettingsSidebar />;
}

export { getActiveSettingsSection, type SettingsSection } from '@/components/settings/settings-sections';
