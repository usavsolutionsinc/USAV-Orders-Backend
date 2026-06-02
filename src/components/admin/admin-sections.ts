import type { ComponentType } from 'react';
import {
  BarChart3,
  Box,
  Calendar,
  Camera,
  ClipboardList,
  Database,
  FileText,
  LayoutDashboard,
  Link2,
  Lock,
  Package,
  ShieldCheck,
  User,
  Zap,
} from '@/components/Icons';

export type AdminSection =
  | 'overview'
  | 'goals' | 'staff' | 'access' | 'roles' | 'connections' | 'integrations' | 'fba'
  | 'manuals' | 'reason_codes' | 'features' | 'logs' | 'jobs' | 'ai_chat' | 'architecture'
  | 'photo_backup' | 'billing';

export type AdminGroup = 'Performance' | 'People' | 'Data sources' | 'System' | 'Account';

export interface AdminSectionOption {
  value: AdminSection;
  label: string;
  description: string;
  /** Group heading shown above the first row of this group. Overview is ungrouped. */
  group?: AdminGroup;
  /** Permission required to see the row. Omitted = visible to anyone with admin.view. */
  requires?: string;
  icon: ComponentType<{ className?: string }>;
}

export const ADMIN_SECTION_OPTIONS: AdminSectionOption[] = [
  { value: 'overview',     label: 'Overview',     description: 'System health & quick links',                                                       icon: LayoutDashboard },

  { value: 'goals',        label: 'Goals',        description: 'Daily output targets and progress',                            group: 'Performance', icon: BarChart3 },
  { value: 'features',     label: 'Features',     description: 'Track features and bug fixes for the team',                    group: 'Performance', icon: Box },

  { value: 'staff',        label: 'Staff',        description: 'Team roles, status, and weekly schedule',                      group: 'People',      icon: User,         requires: 'admin.manage_staff' },
  { value: 'access',       label: 'Access',       description: 'Per-staff role + page-access matrix',                          group: 'People',      icon: Lock },
  { value: 'roles',        label: 'Roles',        description: 'Define what each role can do',                                 group: 'People',      icon: ShieldCheck,  requires: 'admin.manage_roles' },

  { value: 'connections',  label: 'Connections',  description: 'Marketplace, Zoho, and shipping sync tools',                   group: 'Data sources', icon: Link2 },
  { value: 'integrations', label: 'Integrations', description: 'Per-tenant credential vault and provider status',              group: 'Data sources', icon: Zap },
  { value: 'fba',          label: 'FBA',          description: 'FNSKU catalog rows and CSV imports',                           group: 'Data sources', icon: Package },
  { value: 'manuals',      label: 'Manuals',      description: 'Link product manuals to item numbers',                         group: 'Data sources', icon: FileText },
  { value: 'reason_codes', label: 'Reason Codes', description: 'Inventory adjustment / bin-edit reason codes',                  group: 'Data sources', icon: ClipboardList, requires: 'sku_stock.manage' },

  { value: 'photo_backup', label: 'Photo Backup', description: 'Mirror Vercel Blob photos into Google Photos albums',          group: 'System',      icon: Camera },
  { value: 'jobs',         label: 'Jobs',         description: 'QStash scheduled jobs and execution logs',                     group: 'System',      icon: Calendar },
  { value: 'logs',         label: 'Logs',         description: 'Unified audit + station activity logs',                        group: 'System',      icon: FileText,     requires: 'admin.view_logs' },
  { value: 'ai_chat',      label: 'AI Chat',      description: 'Ops assistant + Bose service manual lookup',                   group: 'System',      icon: Zap },
  { value: 'architecture', label: 'Architecture', description: 'Live codebase diagrams — module deps, routes, recent commits', group: 'System',      icon: Database },

  { value: 'billing',      label: 'Billing',      description: 'Plan, entitlements, and Stripe billing portal',                group: 'Account',     icon: ShieldCheck },
];

export function getAdminSection(raw: string | null | undefined): AdminSection {
  const v = String(raw ?? '').toLowerCase() as AdminSection;
  return ADMIN_SECTION_OPTIONS.some((s) => s.value === v) ? v : 'overview';
}
