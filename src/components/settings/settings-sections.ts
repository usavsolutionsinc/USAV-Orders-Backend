import type { ReactNode } from 'react';

export type SettingsSection =
  | 'hardware' | 'workstation' | 'quick-access' | 'appearance' | 'about'
  | 'security' | 'organization' | 'billing' | 'integrations' | 'team'
  | 'roles' | 'access' | 'sessions' | 'audit' | 'catalog' | 'legal';

export type SettingsGroup = 'Personal' | 'Organization';

export interface SettingsSectionOption {
  id: SettingsSection;
  label: string;
  description: string;
  group?: SettingsGroup;
  requires?: string;
  /** Dedicated route when the section is not rendered inline on /settings. */
  href?: string;
}

export const SETTINGS_SECTION_OPTIONS: SettingsSectionOption[] = [
  { id: 'hardware',      label: 'Hardware',      description: 'Printer, scanner, scale',                          group: 'Personal' },
  { id: 'workstation',   label: 'Workstation',   description: 'Station, role, location',                          group: 'Personal' },
  { id: 'quick-access',  label: 'Quick Access',  description: 'Bottom-right shortcuts & pins',                    group: 'Personal' },
  { id: 'appearance',    label: 'Appearance',    description: 'Density, text size',                               group: 'Personal' },
  { id: 'security',      label: 'Security',      description: 'PIN and passkeys',                                 group: 'Personal' },
  { id: 'about',         label: 'About',         description: 'Version & diagnostics',                            group: 'Personal' },
  { id: 'legal',         label: 'Legal & Policies', description: 'Terms, Privacy & DPA',                          group: 'Personal' },

  { id: 'organization',  label: 'Organization',  description: 'Timezone, locale, auth policies, warranty',        group: 'Organization', requires: 'admin.view', href: '/settings/organization' },
  { id: 'billing',       label: 'Billing',       description: 'Plan, entitlements & Stripe portal',               group: 'Organization', requires: 'admin.view', href: '/settings/billing' },
  { id: 'integrations',  label: 'Integrations',  description: 'Connect Amazon, eBay, Zoho, Stripe & more',        group: 'Organization', requires: 'admin.view', href: '/settings/integrations' },
  { id: 'catalog',       label: 'Platforms & Types', description: 'Sales channels & receiving flow types',          group: 'Organization', requires: 'admin.manage_features' },
  { id: 'team',          label: 'Team',          description: 'Invite teammates, roles, deactivate access',       group: 'Organization', requires: 'admin.manage_staff', href: '/settings/staff' },
  { id: 'roles',         label: 'Roles',         description: 'Define what each role can do',                     group: 'Organization', requires: 'admin.manage_roles', href: '/settings/roles' },
  { id: 'access',        label: 'Access',        description: 'Per-staff role + page-access matrix',              group: 'Organization', href: '/settings/access' },
  { id: 'sessions',      label: 'Active sessions', description: 'See and revoke devices',                         group: 'Organization', requires: 'admin.view_sessions' },
  { id: 'audit',         label: 'Audit log',     description: 'Sign-ins, permission denials, role changes',       group: 'Organization', requires: 'admin.view_logs', href: '/settings/audit' },
];

export function getActiveSettingsSection(raw: string | null | undefined): SettingsSection {
  const v = String(raw ?? '').toLowerCase();
  return SETTINGS_SECTION_OPTIONS.some((s) => s.id === v) ? (v as SettingsSection) : 'hardware';
}

export function resolveSettingsSectionFromPath(pathname: string | null | undefined): SettingsSection | null {
  if (!pathname) return null;
  if (pathname === '/settings/billing') return 'billing';
  if (pathname === '/settings/integrations') return 'integrations';
  if (pathname === '/settings/team' || pathname === '/settings/staff') return 'team';
  if (pathname === '/settings/roles') return 'roles';
  if (pathname === '/settings/access') return 'access';
  if (pathname === '/settings/audit') return 'audit';
  if (pathname === '/settings/organization') return 'organization';
  return null;
}

export type SettingsSectionIconFactory = (className: string) => ReactNode;
