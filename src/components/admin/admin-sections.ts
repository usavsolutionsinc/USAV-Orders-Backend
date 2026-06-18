import type { ComponentType } from 'react';
import {
  Activity,
  BarChart3,
  Camera,
  Cpu,
  FileText,
  Layers,
  LayoutDashboard,
  Link2,
  Mail,
  MapPin,
  Package,
  ShieldCheck,
  Share2,
  Star,
  User,
  Wrench,
} from '@/components/Icons';

export type AdminSection =
  | 'overview'
  | 'goals' | 'staff_schedule' | 'connections' | 'fba'
  | 'reason_codes' | 'locations' | 'repair_issues' | 'favorites'
  | 'quality'
  | 'bose_models' | 'compatibility' | 'suppliers'
  | 'station_photos' | 'po_mailbox'
  | 'logs' | 'architecture' | 'system_sync';

export type AdminGroup = 'Performance' | 'Operations' | 'Data & catalogs' | 'System';

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
  { value: 'quality',      label: 'Quality',      description: 'Condition grades, open failures, repair throughput & risk',    group: 'Performance', icon: ShieldCheck, requires: 'sku_stock.view' },

  { value: 'staff_schedule', label: 'Staff schedule', description: 'Weekly shifts, availability rules, and shop calendar',       group: 'Operations',  icon: User,         requires: 'admin.manage_staff' },
  { value: 'po_mailbox',   label: 'PO Mailbox',   description: 'Triage emailed POs not in Zoho, unmatched cartons, and exceptions', group: 'Operations', icon: Mail, requires: 'receiving.view' },
  { value: 'station_photos',label: 'Receiving Photos', description: 'Per-station NAS folder the photo picker opens to',          group: 'Operations', icon: Camera },

  { value: 'fba',          label: 'FBA',          description: 'FNSKU catalog rows and CSV imports',                           group: 'Data & catalogs', icon: Package },
  { value: 'locations',    label: 'Locations',    description: 'Edit bin name, barcode, type, and capacity',                   group: 'Data & catalogs', icon: MapPin,       requires: 'sku_stock.manage' },
  { value: 'repair_issues',label: 'Repair Issues',description: 'Global repair issue checklist templates',                       group: 'Data & catalogs', icon: Wrench,       requires: 'repair.intake' },
  { value: 'favorites',    label: 'Favorites',    description: 'Quick-pick SKU shortcuts per workspace',                       group: 'Data & catalogs', icon: Star,         requires: 'sku_stock.manage' },
  { value: 'bose_models',  label: 'Bose Models',  description: 'Model catalog + the parts compatible with each model',          group: 'Data & catalogs', icon: Cpu,         requires: 'sourcing.view' },
  { value: 'compatibility',label: 'Compatibility',description: 'Audit the model ↔ part compatibility edge table',               group: 'Data & catalogs', icon: Layers,      requires: 'sourcing.view' },
  { value: 'suppliers',    label: 'Suppliers',    description: 'Third-party sourcing vendors (eBay sellers, distributors, salvage)', group: 'Data & catalogs', icon: Link2,    requires: 'supplier.view' },

  { value: 'connections',  label: 'Sync tools',   description: 'Run marketplace syncs, Zoho tools, and connection activity',     group: 'System',      icon: Link2 },
  { value: 'logs',         label: 'Operations log', description: 'Bin, SKU & receiving changes across stations',               group: 'System',      icon: FileText,     requires: 'admin.view_logs' },
  { value: 'architecture', label: 'Operations',   description: 'Visual flow of how items move through the system — live audit board', group: 'System',  icon: Share2 },
  { value: 'system_sync',  label: 'Sync Activity', description: 'Cron job health, last runs, and history across every scheduled sync', group: 'System', icon: Activity },
];

/** Legacy section slugs kept for redirects from bookmarks and deep links. */
export const ADMIN_SECTION_ALIASES: Record<string, AdminSection | 'settings'> = {
  staff: 'staff_schedule',
  integrations: 'settings',
  access: 'settings',
  roles: 'settings',
};

export function getAdminSection(raw: string | null | undefined): AdminSection {
  const v = String(raw ?? '').toLowerCase();
  const aliased = ADMIN_SECTION_ALIASES[v];
  if (aliased === 'settings') return 'overview';
  const resolved = (aliased ?? v) as AdminSection;
  return ADMIN_SECTION_OPTIONS.some((s) => s.value === resolved) ? resolved : 'overview';
}
