/**
 * Shared types, constants, and pure helpers used across the receiving
 * sidebar surface and the right-pane workspace. Extracted from the
 * 3,943-line `ReceivingSidebarPanel.tsx` so subcomponents in both panes
 * can import from a single source.
 *
 * Pure data + functions only — no JSX. Anything with a React render
 * surface lives next to its consumer.
 */

import { COND_LABEL } from '@/components/station/receiving-constants';
import {
  ClipboardList,
  List,
  ShoppingCart,
} from '@/components/Icons';
import type { HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

// ── Sidebar mode switcher ───────────────────────────────────────────────────

export type ReceivingMode = 'receive' | 'history' | 'pickup';

export const RECEIVING_MODE_ITEMS: HorizontalSliderItem[] = [
  { id: 'receive', label: 'Receiving',    icon: ClipboardList },
  { id: 'history', label: 'History',      icon: List },
  { id: 'pickup',  label: 'Local Pickup', icon: ShoppingCart },
];

// ── Carton scratch (localStorage) ───────────────────────────────────────────

/**
 * Carton-level scratch (Zendesk, listing) for Receive; survives line-to-line
 * nav within the same carton. PO item notes live in DB (`receiving_lines.notes`)
 * per line, not here.
 */
export const RECEIVING_LINE_DETAILS_STORAGE_KEY = (receivingId: number) =>
  `receiving.sidebar.lineDetails.v1:${receivingId}`;

export type ReceivingLineDetailScratch = {
  zendesk: string;
  listing: string;
  /** Extra carrier refs for multi-piece POs; primary tracking still PATCHes shipment. */
  extra_trackings: string[];
};

export function readReceivingLineDetailsScratch(
  receivingId: number | null,
): ReceivingLineDetailScratch {
  if (receivingId == null || typeof window === 'undefined') {
    return { zendesk: '', listing: '', extra_trackings: [] };
  }
  try {
    const raw = window.localStorage.getItem(RECEIVING_LINE_DETAILS_STORAGE_KEY(receivingId));
    if (!raw) return { zendesk: '', listing: '', extra_trackings: [] };
    const o = JSON.parse(raw) as Partial<ReceivingLineDetailScratch>;
    const extrasRaw = o.extra_trackings;
    const extra_trackings = Array.isArray(extrasRaw)
      ? extrasRaw.filter((x): x is string => typeof x === 'string')
      : [];
    return {
      zendesk: typeof o.zendesk === 'string' ? o.zendesk : '',
      listing: typeof o.listing === 'string' ? o.listing : '',
      extra_trackings,
    };
  } catch {
    return { zendesk: '', listing: '', extra_trackings: [] };
  }
}

export function writeReceivingLineDetailsScratch(
  receivingId: number,
  d: ReceivingLineDetailScratch,
) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      RECEIVING_LINE_DETAILS_STORAGE_KEY(receivingId),
      JSON.stringify({
        zendesk: d.zendesk,
        listing: d.listing,
        extra_trackings: d.extra_trackings,
      }),
    );
  } catch {
    /* quota / private mode */
  }
}

// ── Carton + PO types ───────────────────────────────────────────────────────

export type PoLineSummary = {
  id: number;
  sku: string | null;
  item_name: string | null;
  image_url: string | null;
  quantity_expected: number | null;
  quantity_received: number;
  zoho_purchaseorder_id: string | null;
  zoho_purchaseorder_number: string | null;
  receiving_type: string | null;
  condition_grade: string | null;
};

export type ReceivingPackageMeta = {
  received_at: string | null;
  unboxed_at: string | null;
  created_at: string | null;
  return_platform: string | null;
  source_platform: string | null;
  is_return: boolean;
};

export type PoContext = {
  receiving_id: number;
  po_ids: string[];
  lines: PoLineSummary[];
  receiving_package: ReceivingPackageMeta | null;
};

// ── Platform + type labels ──────────────────────────────────────────────────

export const RETURN_PLATFORM_LABELS: Record<string, string> = {
  AMZ: 'Amazon',
  EBAY_DRAGONH: 'eBay (DH)',
  EBAY_USAV: 'eBay (USAV)',
  EBAY_MK: 'eBay (MK)',
  FBA: 'FBA',
  WALMART: 'Walmart',
  ECWID: 'Ecwid',
};

export const RECEIVING_TYPE_OPTS = [
  { value: 'PO', label: 'PO' },
  { value: 'RETURN', label: 'Return' },
  { value: 'TRADE_IN', label: 'Trade In' },
  { value: 'PICKUP', label: 'Pick Up' },
];

export const SOURCE_PLATFORM_OPTS: Array<{ value: string; label: string }> = [
  { value: '',           label: 'Unknown' },
  { value: 'ebay',       label: 'eBay' },
  { value: 'amazon',     label: 'Amazon' },
  { value: 'aliexpress', label: 'AliExp' },
  { value: 'walmart',    label: 'Walmart' },
  { value: 'goodwill',   label: 'Goodwill' },
  { value: 'other',      label: 'Other' },
];

export const SOURCE_PLATFORM_LABELS: Record<string, string> = {
  ebay: 'eBay',
  amazon: 'Amazon',
  aliexpress: 'AliExpress',
  walmart: 'Walmart',
  goodwill: 'Goodwill',
  other: 'Other',
};

// ── Carton helpers ──────────────────────────────────────────────────────────

export function parseReceivingPackage(raw: unknown): ReceivingPackageMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  return {
    received_at: o.received_at != null ? String(o.received_at) : null,
    unboxed_at: o.unboxed_at != null ? String(o.unboxed_at) : null,
    created_at: o.created_at != null ? String(o.created_at) : null,
    return_platform: o.return_platform != null ? String(o.return_platform) : null,
    source_platform: o.source_platform != null ? String(o.source_platform) : null,
    is_return: Boolean(o.is_return),
  };
}

export function mapApiLineToPoSummary(l: {
  id: number;
  sku: string | null;
  item_name: string | null;
  image_url: string | null;
  quantity_expected: number | null;
  quantity_received: number;
  zoho_purchaseorder_id?: string | null;
  zoho_purchaseorder_number?: string | null;
  receiving_type?: string | null;
  condition_grade?: string | null;
}): PoLineSummary {
  return {
    id: l.id,
    sku: l.sku,
    item_name: l.item_name,
    image_url: l.image_url ?? null,
    quantity_expected: l.quantity_expected,
    quantity_received: l.quantity_received,
    zoho_purchaseorder_id: l.zoho_purchaseorder_id ?? null,
    zoho_purchaseorder_number: l.zoho_purchaseorder_number ?? null,
    receiving_type: l.receiving_type ?? 'PO',
    condition_grade: l.condition_grade ?? 'USED_A',
  };
}

export function platformLabel(
  pkg: ReceivingPackageMeta | null,
  lineReceivingType: string | null | undefined,
): string {
  const override = (pkg?.source_platform || '').trim().toLowerCase();
  if (override) return SOURCE_PLATFORM_LABELS[override] ?? override;
  const t = String(lineReceivingType || 'PO').trim().toUpperCase();
  if (t === 'PICKUP') return 'Local pickup';
  if (pkg?.is_return && pkg.return_platform) {
    return RETURN_PLATFORM_LABELS[pkg.return_platform] ?? pkg.return_platform.replace(/_/g, ' ');
  }
  if (pkg?.is_return) return 'Return';
  return 'Unknown';
}

export function formatPackageUnboxDate(pkg: ReceivingPackageMeta | null): string {
  const raw = pkg?.unboxed_at || pkg?.received_at || pkg?.created_at;
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}

export function resolvePoScanValue(
  line: PoLineSummary | null | undefined,
  poIds: string[],
  receivingId?: number | null,
): string {
  const fromLine = (line?.zoho_purchaseorder_number || '').trim();
  if (fromLine) return fromLine;
  const fromIds = (poIds[0] || '').trim();
  if (fromIds) return fromIds;
  const fromLineId = (line?.zoho_purchaseorder_id || '').trim();
  if (fromLineId) return fromLineId;
  if (receivingId != null) return `RCV-${receivingId}`;
  return '';
}

export function conditionShort(code: string | null | undefined): string {
  const c = String(code || 'BRAND_NEW').trim().toUpperCase();
  if (c === 'BRAND_NEW') return 'New';
  if (c === 'PARTS') return 'Parts';
  if (c.startsWith('USED_')) {
    const letter = COND_LABEL[c] || c.replace('USED_', '');
    return `USED-${letter}`;
  }
  return c.replace(/_/g, ' ');
}

// ── Scan / exception types ──────────────────────────────────────────────────

export type PendingScan = {
  id: string;
  tracking: string;
  status: 'checking' | 'matched' | 'unmatched' | 'error';
  startedAt: number;
  receiving_id?: number;
  po_ids?: string[];
  scan_id?: number;
  exception_id?: number | null;
  exception_reason?: string | null;
  errorMessage?: string;
};

/**
 * Persistent row surfaced from the `tracking_exceptions` DB table. Mirrors
 * the subset of columns the sidebar cares about; full shape lives on the
 * triage page. Distinct from PendingScan (session-only, cleared on reload).
 */
export type OpenException = {
  id: number;
  tracking_number: string;
  exception_reason: string;
  created_at: string;
  last_zoho_check_at: string | null;
  zoho_check_count: number;
};

export function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Listing URL helpers ─────────────────────────────────────────────────────

/** Safe http(s) href for opening a pasted or typed listing URL. */
export function listingUrlForOpen(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    const u = new URL(withProto);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Desktop receiving page deep link (`/receiving?recvId=…&lineId=…`). */
export function receivingShareUrl(receivingId: number, lineId?: number): string {
  const path = '/receiving';
  if (typeof window !== 'undefined') {
    const u = new URL(path, window.location.origin);
    u.searchParams.set('recvId', String(receivingId));
    if (lineId != null && Number.isFinite(lineId) && lineId > 0) {
      u.searchParams.set('lineId', String(lineId));
    }
    return u.toString();
  }
  const params = new URLSearchParams({ recvId: String(receivingId) });
  if (lineId != null && Number.isFinite(lineId) && lineId > 0) {
    params.set('lineId', String(lineId));
  }
  return `${path}?${params.toString()}`;
}

/** Short human-facing label for a listing URL (host + clipped path); not for navigation. */
export function listingLinkPreview(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  try {
    const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    const u = new URL(withProto);
    const host = u.hostname.replace(/^www\./i, '');
    const path = `${u.pathname}${u.search}`;
    if (path && path !== '/') {
      const clipped = path.length > 22 ? `${path.slice(0, 18)}…` : path;
      return `${host}${clipped}`;
    }
    return host || t;
  } catch {
    return t.length > 32 ? `${t.slice(0, 28)}…` : t;
  }
}

// ── Select-line event payload ───────────────────────────────────────────────

/**
 * Shape of the `receiving-select-line` CustomEvent's detail. The table
 * currently dispatches just the row, while the sidebar also recognizes a
 * richer `{ row, expandFlowSections }` payload — accept both shapes so the
 * contract is forward/back compatible.
 */
export type ReceivingSelectLineDetail =
  | ReceivingLineRow
  | null
  | { row: ReceivingLineRow | null; expandFlowSections?: boolean };

export function readSelectLineDetail(
  detail: ReceivingSelectLineDetail,
): { row: ReceivingLineRow | null; expandFlowSections: boolean } {
  if (detail && typeof detail === 'object' && 'row' in detail) {
    return {
      row: detail.row ?? null,
      expandFlowSections: detail.expandFlowSections === true,
    };
  }
  return { row: (detail as ReceivingLineRow | null) ?? null, expandFlowSections: false };
}

// ── Form input class tokens ─────────────────────────────────────────────────

export const SELECT_CLASS =
  'w-full rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-gray-900 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10';
export const INPUT_CLASS =
  'w-full rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-gray-900 placeholder:text-gray-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10';

// ── Type scale (sidebar + workspace share this) ─────────────────────────────
/**
 * One source of truth for typography inside the receiving panel + workspace.
 *
 *   SECTION  10/black/upper      — dropdown header titles
 *   LABEL     9/black/upper      — field labels above inputs
 *   META      9/semibold         — header summary previews + meta chips
 *   INPUT    11/semibold         — every input + select value
 *   BODY     11/medium           — plain text (notes, descriptions)
 *   TITLE    14/extrabold/snug   — product title (visual anchor of Item lane)
 */

export const TYPE_PRODUCT_TITLE_CLASS =
  'text-[14px] font-extrabold leading-snug tracking-tight text-slate-900 break-words';

export const TYPE_PRODUCT_TITLE_COMPACT_CLASS =
  'text-[13px] font-extrabold leading-snug tracking-tight text-slate-900 break-words line-clamp-3';

export const TYPE_SECTION_TITLE_CLASS =
  'shrink-0 text-[10px] font-black uppercase tracking-wider';

export const TYPE_FIELD_LABEL_CLASS =
  'block text-[9px] font-black uppercase tracking-[0.14em] text-slate-500';

export const TYPE_HEADER_SUMMARY_CLASS =
  'inline-flex min-w-0 max-w-full flex-wrap items-center justify-end gap-x-1 gap-y-0.5 text-[9px] font-semibold leading-none tracking-wide text-gray-600';

export const TYPE_INPUT_INLINE_CLASS =
  'text-[11px] font-semibold text-gray-900 placeholder:font-medium placeholder:text-gray-400';

// ── Flow-section class + tone tokens ────────────────────────────────────────

export const FLOW_SECTION_BTN_CLASS =
  'flex min-h-[28px] w-full items-center gap-2 px-2 py-0.5 text-left transition-colors hover:bg-gray-50';

export const FLOW_SECTION_TITLE_CLASS = TYPE_SECTION_TITLE_CLASS;
export const FLOW_SECTION_SUMMARY_CLASS = TYPE_HEADER_SUMMARY_CLASS;
/** Back-compat alias — field labels above inputs. */
export const FLOW_SECTION_LABEL = TYPE_FIELD_LABEL_CLASS;

export const FLOW_SECTION_SUMMARY_SEP_CLASS = 'shrink-0 select-none font-normal text-gray-400';

export const RECEIVING_SCAN_RULE_LINE_CLASS =
  '-mx-3 h-px shrink-0 bg-slate-300 transition-colors group-focus-within:bg-blue-500';

export const RECEIVING_TRAIL_SLOT_CLASS =
  'flex h-[14px] w-[14px] shrink-0 items-center justify-center';

export const RECEIVING_TRAIL_BTN_CLASS =
  'flex h-full w-full items-center justify-center rounded-sm transition-colors duration-100 ease-out active:scale-95';

export const TRACKING_REMOVE_BTN_CLASS = `${RECEIVING_TRAIL_BTN_CLASS} text-gray-400 hover:text-gray-900`;
export const TRACKING_ADD_BTN_CLASS = `${RECEIVING_TRAIL_BTN_CLASS} text-slate-500 hover:text-slate-800`;

export const TRACKING_ROW_LEADING_ICON_CLASS =
  'shrink-0 text-gray-400 transition-colors duration-100 ease-out group-focus-within:text-gray-900';

export const RECEIVING_CHIP_EDIT_BTN_CLASS =
  'flex size-[22px] shrink-0 items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-800 active:scale-95';

// ── Section tone tokens ─────────────────────────────────────────────────────
/**
 * Per-section tone tokens. Color lives ONLY on the dropdown header (trigger
 * row) — body + container stay neutral white so the dense fields read clean.
 */

export type FlowSectionTone = 'shipment' | 'item' | 'support' | 'staff';

export const FLOW_SECTION_TONE_STYLES: Record<
  FlowSectionTone,
  { header: string; rail: string; title: string }
> = {
  shipment: {
    header: 'bg-red-50 hover:bg-red-100/70',
    rail: 'bg-red-500',
    title: 'text-red-900',
  },
  item: {
    header: 'bg-blue-50 hover:bg-blue-100/70',
    rail: 'bg-blue-500',
    title: 'text-blue-900',
  },
  support: {
    header: 'bg-orange-50 hover:bg-orange-100/70',
    rail: 'bg-orange-500',
    title: 'text-orange-900',
  },
  // Staff/Scanned/Received header — emerald rail signals an "actor + time"
  // record (who scanned, when received) versus the read/edit data lanes.
  staff: {
    header: 'bg-emerald-50 hover:bg-emerald-100/70',
    rail: 'bg-emerald-500',
    title: 'text-emerald-900',
  },
};

// ─── Receiving variant theme ─────────────────────────────────────────────────
// Drives accent color across the workspace surface: context-card chip,
// sticky-action-bar CTA tone, focus-ring tint on inputs. Sourced from
// `row.receiving_type` via `receivingVariantFromType`.

export type ReceivingVariant = 'PO' | 'RETURN' | 'TRADE_IN' | 'PICKUP' | 'OTHER';

export interface ReceivingVariantStyle {
  tone: 'blue' | 'red' | 'orange' | 'emerald' | 'gray';
  label: string;
  /** Chip pill — e.g. variant badge in the context card. */
  chip: string;
  /** Solid CTA background (with hover). */
  cta: string;
  /** Focus ring for inputs (cosmetic). */
  focusRing: string;
  /** Icon container background (header variant icon). */
  iconBg: string;
}

export const RECEIVING_VARIANT_THEME: Record<ReceivingVariant, ReceivingVariantStyle> = {
  PO: {
    tone: 'blue',
    label: 'PO',
    chip: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
    cta: 'bg-blue-600 hover:bg-blue-700',
    focusRing: 'focus:ring-blue-500/30 focus:border-blue-500',
    iconBg: 'bg-blue-600',
  },
  RETURN: {
    tone: 'red',
    label: 'Return',
    chip: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
    cta: 'bg-rose-600 hover:bg-rose-700',
    focusRing: 'focus:ring-rose-500/30 focus:border-rose-500',
    iconBg: 'bg-rose-600',
  },
  TRADE_IN: {
    tone: 'orange',
    label: 'Trade In',
    chip: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
    cta: 'bg-amber-600 hover:bg-amber-700',
    focusRing: 'focus:ring-amber-500/30 focus:border-amber-500',
    iconBg: 'bg-amber-600',
  },
  PICKUP: {
    tone: 'emerald',
    label: 'Pickup',
    chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
    cta: 'bg-emerald-600 hover:bg-emerald-700',
    focusRing: 'focus:ring-emerald-500/30 focus:border-emerald-500',
    iconBg: 'bg-emerald-600',
  },
  OTHER: {
    tone: 'gray',
    label: 'Other',
    chip: 'bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-200',
    cta: 'bg-gray-700 hover:bg-gray-800',
    focusRing: 'focus:ring-gray-400/30 focus:border-gray-400',
    iconBg: 'bg-gray-700',
  },
};

export function receivingVariantFromType(
  receivingType: string | null | undefined,
): ReceivingVariant {
  const v = String(receivingType ?? '').trim().toUpperCase();
  if (v === 'PO' || v === 'PURCHASE_ORDER' || v === 'PURCHASEORDER') return 'PO';
  if (v === 'RETURN' || v === 'RETURNS') return 'RETURN';
  if (v === 'TRADE_IN' || v === 'TRADEIN' || v === 'TRADE-IN') return 'TRADE_IN';
  if (v === 'PICKUP' || v === 'LOCAL_PICKUP' || v === 'LOCALPICKUP') return 'PICKUP';
  return 'OTHER';
}

// ─── Claim modal ────────────────────────────────────────────────────────────
// Used by `ReceivingClaimModal` + `POST /api/receiving/zendesk-claim` to file
// damage / missing-item / wrong-item / vendor-defect claims as Zendesk tickets
// (via the existing GAS bridge in src/lib/zendesk.ts).

export type ClaimType = 'damage' | 'missing' | 'wrong_item' | 'vendor_defect';
export type ClaimSeverity = 'low' | 'medium' | 'high';

export const CLAIM_TYPE_OPTIONS: ReadonlyArray<{
  value: ClaimType;
  label: string;
  /** Pill background + text color when selected. */
  active: string;
  /** Inactive pill color. */
  inactive: string;
}> = [
  { value: 'damage',        label: 'Damage',        active: 'bg-rose-600 text-white',    inactive: 'bg-rose-50 text-rose-700' },
  { value: 'missing',       label: 'Missing',       active: 'bg-amber-600 text-white',   inactive: 'bg-amber-50 text-amber-700' },
  { value: 'wrong_item',    label: 'Wrong item',    active: 'bg-violet-600 text-white',  inactive: 'bg-violet-50 text-violet-700' },
  { value: 'vendor_defect', label: 'Vendor defect', active: 'bg-orange-600 text-white',  inactive: 'bg-orange-50 text-orange-700' },
];

export const CLAIM_SEVERITY_OPTIONS: ReadonlyArray<{
  value: ClaimSeverity;
  label: string;
  active: string;
  inactive: string;
}> = [
  { value: 'low',    label: 'Low',    active: 'bg-emerald-600 text-white', inactive: 'bg-emerald-50 text-emerald-700' },
  { value: 'medium', label: 'Medium', active: 'bg-amber-600 text-white',   inactive: 'bg-amber-50 text-amber-700' },
  { value: 'high',   label: 'High',   active: 'bg-rose-600 text-white',    inactive: 'bg-rose-50 text-rose-700' },
];
