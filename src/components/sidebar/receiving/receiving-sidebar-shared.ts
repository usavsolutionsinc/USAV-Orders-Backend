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

export type FlowSectionTone = 'shipment' | 'item' | 'support';

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
};
