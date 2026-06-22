import { ClipboardList, Package, FileText, Search, User, Activity } from '@/components/Icons';
import { type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';

// ─── Section nav ───────────────────────────────────────────────────────────

export interface AuditSection {
  id: string;
  label: string;
  href: string;
  icon: (props: { className?: string }) => JSX.Element;
  available: boolean;
}

export const AUDIT_SECTIONS: AuditSection[] = [
  { id: 'trace',     label: 'Trace',     href: '/audit-log/trace',     icon: Activity,      available: true  },
  { id: 'receiving', label: 'Receiving', href: '/audit-log/receiving', icon: ClipboardList, available: true },
  { id: 'packing',   label: 'Packing',   href: '/audit-log/packing',   icon: Package,       available: true  },
  { id: 'tech',      label: 'Tech',      href: '/audit-log/tech',      icon: FileText,      available: true  },
  { id: 'sku',       label: 'SKU',       href: '/audit-log/sku',       icon: Search,        available: true  },
  { id: 'staff',     label: 'Staff',     href: '/audit-log/staff',     icon: User,          available: true  },
];

// Params that are owned by individual section selections — stripped on
// section switch. The shared filter strip's params (day/start/end/staffId)
// persist across sections by design.
export const SECTION_OWNED_PARAMS = ['po', 'tracking', 'session', 'sku', 'serial'] as const;

export const AUDIT_SECTION_ITEMS: HorizontalSliderItem[] = AUDIT_SECTIONS.map((s) => ({
  id: s.id,
  label: s.label,
  icon: s.icon,
  disabled: !s.available,
}));

// ─── PO list types ─────────────────────────────────────────────────────────

export interface POSummary {
  po_id: string;
  po_number: string | null;
  vendor_name: string | null;
  line_count: number;
  carton_count: number;
  quantity_expected: number;
  quantity_received: number;
  latest_event_at: string | null;
  last_actor_name: string | null;
}

export function relTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '';
  const diff = Date.now() - d;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

// ─── Shared list-picker row ────────────────────────────────────────────────

export interface ListRow {
  key: string;
  title: string;
  subtitle?: string;
  meta?: string;
  trailing?: string;
}

// ─── Section summary types ─────────────────────────────────────────────────

export interface PackingTrackingSummary {
  tracking: string;
  packer_log_id: number;
  pack_date_time: string | null;
  packed_by_name: string | null;
  sku_summary: string | null;
  event_count: number;
}

export interface TechSessionSummary {
  session_key: string;
  tracking: string;
  tester_id: number | null;
  tester_name: string | null;
  serial_count: number;
  latest_event_at: string | null;
  sku_summary: string | null;
}

export interface SkuSummary {
  sku: string;
  item_name: string | null;
  event_count: number;
  latest_event_at: string | null;
}

export const TRACE_RECENTS_KEY = 'audit-log.trace.recents';
