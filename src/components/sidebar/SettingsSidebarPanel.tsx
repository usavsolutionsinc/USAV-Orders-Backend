'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { SidebarSectionList, type SidebarSection } from './SidebarSectionList';

export type SettingsSection =
  | 'hardware' | 'workstation' | 'quick-access' | 'appearance' | 'about'
  | 'security' | 'staff' | 'sessions' | 'audit' | 'operations-log';

const ICON_CLS = 'h-4 w-4 shrink-0';

const SECTIONS: Array<SidebarSection<SettingsSection>> = [
  {
    id: 'hardware',
    label: 'Hardware',
    description: 'Printer, scanner, scale',
    icon: (
      <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 6 2 18 2 18 9" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect x="6" y="14" width="12" height="8" rx="1" />
      </svg>
    ),
  },
  {
    id: 'workstation',
    label: 'Workstation',
    description: 'Station, role, location',
    icon: (
      <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <line x1="8" y1="20" x2="16" y2="20" />
        <line x1="12" y1="16" x2="12" y2="20" />
      </svg>
    ),
  },
  {
    id: 'quick-access',
    label: 'Quick Access',
    description: 'Bottom-right shortcuts & pins',
    icon: (
      <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'Density, text size',
    icon: (
      <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    ),
  },
  {
    id: 'security',
    label: 'Security',
    description: 'PIN and passkeys',
    icon: (
      <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
  {
    id: 'staff',
    label: 'Staff',
    description: 'Add staff, set roles, enrollment QRs',
    requires: 'admin.manage_staff',
    icon: (
      <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    id: 'sessions',
    label: 'Active sessions',
    description: 'See and revoke devices',
    requires: 'admin.view_sessions',
    icon: (
      <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
  {
    id: 'audit',
    label: 'Audit log',
    description: 'Sign-ins, permission denials, role changes',
    requires: 'admin.view_logs',
    icon: (
      <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    id: 'operations-log',
    label: 'Operations log',
    description: 'Bin, SKU & receiving changes by staff',
    requires: 'admin.view_logs',
    icon: (
      <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" />
        <path d="M7 14l4-4 4 4 5-5" />
      </svg>
    ),
  },
  {
    id: 'about',
    label: 'About',
    description: 'Version & diagnostics',
    icon: (
      <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
  },
];

export function getActiveSettingsSection(raw: string | null | undefined): SettingsSection {
  const v = String(raw ?? '').toLowerCase();
  return SECTIONS.some((s) => s.id === v) ? (v as SettingsSection) : 'hardware';
}

export function SettingsSidebarPanel(): ReactNode {
  const router = useRouter();
  const searchParams = useSearchParams();
  const active = getActiveSettingsSection(searchParams?.get('section'));
  const { has, isLoaded, user } = useAuth();

  const setSection = useCallback(
    (section: SettingsSection) => {
      const params = new URLSearchParams(searchParams?.toString());
      params.set('section', section);
      router.replace(`/settings?${params.toString()}`);
    },
    [router, searchParams],
  );

  const visible = SECTIONS.filter((s) => {
    if (s.id === 'security' && (!isLoaded || !user)) return false;
    if (!s.requires) return true;
    if (!isLoaded) return false;
    return has(s.requires);
  });

  return (
    <SidebarSectionList
      sections={visible}
      active={active}
      onSelect={setSection}
      ariaLabel="Settings sections"
    />
  );
}

export default SettingsSidebarPanel;
