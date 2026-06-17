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
  Lock,
  Mail,
  MapPin,
  Package,
  ShieldCheck,
  Share2,
  Star,
  User,
  Wrench,
  Zap,
} from '@/components/Icons';

export type AdminSection =
  | 'overview'
  | 'goals' | 'staff' | 'access' | 'roles' | 'connections' | 'integrations' | 'fba'
  | 'reason_codes' | 'locations' | 'repair_issues' | 'favorites'
  | 'quality'
  | 'bose_models' | 'compatibility' | 'suppliers'
  | 'station_photos' | 'po_mailbox'
  | 'logs' | 'architecture' | 'system_sync';

export type AdminGroup = 'Performance' | 'People' | 'Data sources' | 'System';

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

  { value: 'staff',        label: 'Staff',        description: 'Team roles, status, and weekly schedule',                      group: 'People',      icon: User,         requires: 'admin.manage_staff' },
  { value: 'access',       label: 'Access',       description: 'Per-staff role + page-access matrix',                          group: 'People',      icon: Lock },
  { value: 'roles',        label: 'Roles',        description: 'Define what each role can do',                                 group: 'People',      icon: ShieldCheck,  requires: 'admin.manage_roles' },

  { value: 'connections',  label: 'Connections',  description: 'Marketplace, Zoho, and shipping sync tools',                   group: 'Data sources', icon: Link2 },
  { value: 'integrations', label: 'Integrations', description: 'Per-tenant credential vault and provider status',              group: 'Data sources', icon: Zap },
  { value: 'fba',          label: 'FBA',          description: 'FNSKU catalog rows and CSV imports',                           group: 'Data sources', icon: Package },
  { value: 'locations',    label: 'Locations',    description: 'Edit bin name, barcode, type, and capacity',                   group: 'Data sources', icon: MapPin,       requires: 'sku_stock.manage' },
  { value: 'repair_issues',label: 'Repair Issues',description: 'Global repair issue checklist templates',                       group: 'Data sources', icon: Wrench,       requires: 'repair.intake' },
  { value: 'favorites',    label: 'Favorites',    description: 'Quick-pick SKU shortcuts per workspace',                       group: 'Data sources', icon: Star,         requires: 'sku_stock.manage' },
  { value: 'bose_models',  label: 'Bose Models',  description: 'Model catalog + the parts compatible with each model',          group: 'Data sources', icon: Cpu,         requires: 'sourcing.view' },
  { value: 'compatibility',label: 'Compatibility',description: 'Audit the model ↔ part compatibility edge table',               group: 'Data sources', icon: Layers,      requires: 'sourcing.view' },
  { value: 'suppliers',    label: 'Suppliers',    description: 'Third-party sourcing vendors (eBay sellers, distributors, salvage)', group: 'Data sources', icon: Link2,    requires: 'supplier.view' },
  { value: 'station_photos',label: 'NAS Photos', description: 'NAS address, workflow folders, and station picker defaults',       group: 'Data sources', icon: Camera },
  { value: 'po_mailbox',   label: 'PO Mailbox',   description: 'Triage emailed POs not in Zoho, unmatched cartons, and exceptions', group: 'Data sources', icon: Mail, requires: 'receiving.view' },

  { value: 'logs',         label: 'Logs',         description: 'Unified audit + station activity logs',                        group: 'System',      icon: FileText,     requires: 'admin.view_logs' },
  { value: 'architecture', label: 'Operations',   description: 'Visual flow of how items move through the system — live audit board', group: 'System',  icon: Share2 },
  { value: 'system_sync',  label: 'Sync Activity', description: 'Cron job health, last runs, and history across every scheduled sync', group: 'System', icon: Activity },
];

export function getAdminSection(raw: string | null | undefined): AdminSection {
  const v = String(raw ?? '').toLowerCase() as AdminSection;
  return ADMIN_SECTION_OPTIONS.some((s) => s.value === v) ? v : 'overview';
}
