'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { renderToStaticMarkup } from 'react-dom/server';
import QRCode from 'react-qr-code';
import {
  sidebarHeaderBandClass,
  sidebarHeaderControlClass,
  sidebarHeaderRowClass,
} from '@/components/layout/header-shell';
import { Barcode, ChevronDown, ChevronUp, Clipboard, ExternalLink, Plus, Printer, RefreshCw, X } from '@/components/Icons';
import { useUIModeOptional } from '@/design-system/providers/UIModeProvider';
import { MobileReceivingActionsPane } from '@/components/sidebar/MobileReceivingActionsPane';
import { toast } from '@/lib/toast';
import { receivingLabelPoCornerDisplay } from '@/lib/print/printReceivingLabel';
import { TrackingChip, OrderIdChip, getLast4 } from '@/components/ui/CopyChip';
import { SearchBar } from '@/components/ui/SearchBar';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
import StaffSelector from '@/components/StaffSelector';
import {
  ReceivingReturnBanner,
  type ReturnEvent,
} from '@/components/sidebar/ReceivingReturnBanner';
import { ScanStatusChip } from '@/components/sidebar/ScanStatusChip';
import { ReceivingPhotoStrip } from '@/components/sidebar/ReceivingPhotoStrip';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { useAblyClient } from '@/contexts/AblyContext';
import { printProductLabel } from '@/lib/print/printProductLabel';
import { mobileQrUrl } from '@/lib/barcode-routing';
import { loadBarcodeLibrary, renderBarcode } from '@/utils/barcode';
import { LocalPickupIntakeForm } from '@/components/work-orders/LocalPickupIntakeForm';
import {
  CONDITION_OPTS,
  COND_LABEL,
} from '@/components/station/receiving-constants';
import {
  dispatchLineUpdated,
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';

/**
 * Shape of the `receiving-select-line` CustomEvent's detail. Defined here
 * because the table currently dispatches just the row, while the sidebar
 * also recognizes a richer `{ row, expandFlowSections }` payload — accept
 * both shapes so the contract is forward/back compatible.
 */
type ReceivingSelectLineDetail =
  | ReceivingLineRow
  | null
  | { row: ReceivingLineRow | null; expandFlowSections?: boolean };

function readSelectLineDetail(
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
import {
  parseSerialFromLineDescription,
  parseZendeskListingFromPoNotes,
} from '@/lib/zoho-po-prefill';

/** Carton-level scratch (Zendesk, listing, notes) for Receive; survives line-to-line nav. */
const RECEIVING_LINE_DETAILS_STORAGE_KEY = (receivingId: number) =>
  `receiving.sidebar.lineDetails.v1:${receivingId}`;

type ReceivingLineDetailScratch = {
  zendesk: string;
  listing: string;
  notes: string;
  /** Extra carrier refs for multi-piece POs; primary tracking still PATCHes shipment. */
  extra_trackings: string[];
};

function readReceivingLineDetailsScratch(receivingId: number | null): ReceivingLineDetailScratch {
  if (receivingId == null || typeof window === 'undefined') {
    return { zendesk: '', listing: '', notes: '', extra_trackings: [] };
  }
  try {
    const raw = window.localStorage.getItem(RECEIVING_LINE_DETAILS_STORAGE_KEY(receivingId));
    if (!raw) return { zendesk: '', listing: '', notes: '', extra_trackings: [] };
    const o = JSON.parse(raw) as Partial<ReceivingLineDetailScratch>;
    const extrasRaw = o.extra_trackings;
    const extra_trackings = Array.isArray(extrasRaw)
      ? extrasRaw.filter((x): x is string => typeof x === 'string')
      : [];
    return {
      zendesk: typeof o.zendesk === 'string' ? o.zendesk : '',
      listing: typeof o.listing === 'string' ? o.listing : '',
      notes: typeof o.notes === 'string' ? o.notes : '',
      extra_trackings,
    };
  } catch {
    return { zendesk: '', listing: '', notes: '', extra_trackings: [] };
  }
}

function writeReceivingLineDetailsScratch(receivingId: number, d: ReceivingLineDetailScratch) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      RECEIVING_LINE_DETAILS_STORAGE_KEY(receivingId),
      JSON.stringify({
        zendesk: d.zendesk,
        listing: d.listing,
        notes: d.notes,
        extra_trackings: d.extra_trackings,
      }),
    );
  } catch {
    /* quota / private mode */
  }
}

const RECEIVING_MODE_OPTIONS = [
  { value: 'receive', label: 'Receiving' },
  { value: 'pickup', label: 'Local Pickup' },
];

type ReceivingMode = 'receive' | 'pickup';

type PoLineSummary = {
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

type ReceivingPackageMeta = {
  received_at: string | null;
  unboxed_at: string | null;
  created_at: string | null;
  return_platform: string | null;
  source_platform: string | null;
  is_return: boolean;
};

type PoContext = {
  receiving_id: number;
  po_ids: string[];
  lines: PoLineSummary[];
  receiving_package: ReceivingPackageMeta | null;
};

const RETURN_PLATFORM_LABELS: Record<string, string> = {
  AMZ: 'Amazon',
  EBAY_DRAGONH: 'eBay (DH)',
  EBAY_USAV: 'eBay (USAV)',
  EBAY_MK: 'eBay (MK)',
  FBA: 'FBA',
  WALMART: 'Walmart',
  ECWID: 'Ecwid',
};

const RECEIVING_TYPE_OPTS = [
  { value: 'PO', label: 'PO' },
  { value: 'RETURN', label: 'Return' },
  { value: 'TRADE_IN', label: 'Trade In' },
  { value: 'PICKUP', label: 'Pick Up' },
];

const SOURCE_PLATFORM_OPTS: Array<{ value: string; label: string }> = [
  { value: '',           label: 'Unknown' },
  { value: 'ebay',       label: 'eBay' },
  { value: 'amazon',     label: 'Amazon' },
  { value: 'aliexpress', label: 'AliExp' },
  { value: 'walmart',    label: 'Walmart' },
  { value: 'goodwill',   label: 'Goodwill' },
  { value: 'other',      label: 'Other' },
];

const SOURCE_PLATFORM_LABELS: Record<string, string> = {
  ebay: 'eBay',
  amazon: 'Amazon',
  aliexpress: 'AliExpress',
  walmart: 'Walmart',
  goodwill: 'Goodwill',
  other: 'Other',
};

function parseReceivingPackage(raw: unknown): ReceivingPackageMeta | null {
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

function mapApiLineToPoSummary(l: {
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

function platformLabel(
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

function formatPackageUnboxDate(pkg: ReceivingPackageMeta | null): string {
  const raw = pkg?.unboxed_at || pkg?.received_at || pkg?.created_at;
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}

function resolvePoScanValue(
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

function conditionShort(code: string | null | undefined): string {
  const c = String(code || 'BRAND_NEW').trim().toUpperCase();
  if (c === 'BRAND_NEW') return 'New';
  if (c === 'PARTS') return 'Parts';
  if (c.startsWith('USED_')) {
    const letter = COND_LABEL[c] || c.replace('USED_', '');
    return `USED-${letter}`;
  }
  return c.replace(/_/g, ' ');
}

function ConditionHeaderDisplay({ code }: { code: string }) {
  const c = String(code || 'BRAND_NEW').trim().toUpperCase();
  if (c === 'BRAND_NEW') {
    return <span className="font-black text-gray-900">New</span>;
  }
  if (c === 'PARTS') {
    return <span className="font-black text-gray-900">Parts</span>;
  }
  if (c.startsWith('USED_')) {
    const letter = COND_LABEL[c] || c.replace('USED_', '');
    return (
      <span className="font-black tracking-tight text-gray-900">
        USED-{letter}
      </span>
    );
  }
  return <span className="font-semibold text-gray-800">{c.replace(/_/g, ' ')}</span>;
}

type PendingScan = {
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

// Persistent row surfaced from the tracking_exceptions DB table. Mirrors the
// subset of columns the sidebar cares about; full shape lives on the triage
// page. Distinct from PendingScan (session-only, cleared on reload).
type OpenException = {
  id: number;
  tracking_number: string;
  exception_reason: string;
  created_at: string;
  last_zoho_check_at: string | null;
  zoho_check_count: number;
};

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const SELECT_CLASS =
  'w-full rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-gray-900 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10';
const INPUT_CLASS =
  'w-full rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-gray-900 placeholder:text-gray-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10';

/** Safe http(s) href for opening a pasted or typed listing URL. */
function listingUrlForOpen(raw: string): string | null {
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

const FLOW_SECTION_LABEL =
  'block text-[8px] font-black uppercase tracking-[0.14em] text-slate-500';

/** Sidebar collapsible triggers: tightened to reduce wasted vertical space. */
const FLOW_SECTION_BTN_CLASS =
  'flex min-h-[28px] w-full items-center gap-2 px-2 py-0.5 text-left transition-colors hover:bg-gray-50';

const FLOW_SECTION_TITLE_CLASS =
  'shrink-0 text-[9px] font-black uppercase tracking-wider text-gray-700';

/** Tracking · platform · notes preview (and plain string summaries) — one size/weight/color. */
const FLOW_SECTION_SUMMARY_CLASS =
  'inline-flex min-w-0 max-w-full flex-wrap items-center justify-end gap-x-1 gap-y-0.5 text-[8px] font-semibold leading-none tracking-wide text-gray-600';

/** Middot separators in flow summaries; stays subtle at 9px. */
const FLOW_SECTION_SUMMARY_SEP_CLASS = 'shrink-0 select-none font-normal text-gray-400';

/**
 * Hairline under scan strips: separate block so the rule stays full-bleed in FlowSection
 * (parent has px-3; -mx-3 negates it) — avoids short/offset borders vs flex children.
 */
const RECEIVING_SCAN_RULE_LINE_CLASS =
  '-mx-3 h-px shrink-0 bg-slate-300 transition-colors group-focus-within:bg-blue-500';

/**
 * Matches {@link SearchField} trailing slot geometry (paste / clear / spinner)
 * so header actions (+), row removes (×), and section chevrons share one vertical
 * alignment column with scan rows.
 */
const RECEIVING_TRAIL_SLOT_CLASS =
  'flex h-[14px] w-[14px] shrink-0 items-center justify-center';

/** Tap target fills the 14×14 trail column; icon centers like paste/clear. */
const RECEIVING_TRAIL_BTN_CLASS =
  'flex h-full w-full items-center justify-center rounded-sm transition-colors duration-100 ease-out active:scale-95';

const TRACKING_REMOVE_BTN_CLASS = `${RECEIVING_TRAIL_BTN_CLASS} text-gray-400 hover:text-gray-900`;

const TRACKING_ADD_BTN_CLASS = `${RECEIVING_TRAIL_BTN_CLASS} text-slate-500 hover:text-slate-800`;

/** Matches SearchField leading icon: muted until row is focused. */
const TRACKING_ROW_LEADING_ICON_CLASS =
  'shrink-0 text-gray-400 transition-colors duration-100 ease-out group-focus-within:text-gray-900';

function FlowSection({
  title,
  summary,
  open,
  onToggle,
  bodyClassName = 'px-2 py-1.5',
  children,
}: {
  title: string;
  summary?: ReactNode;
  open: boolean;
  onToggle: () => void;
  /** Wrapping paddings around section body when open (default matches other panels). */
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={FLOW_SECTION_BTN_CLASS}
      >
        <span className={FLOW_SECTION_TITLE_CLASS}>{title}</span>
        {summary != null && summary !== '' ? (
          <span className="min-w-0 flex-1 text-right">
            <span className={FLOW_SECTION_SUMMARY_CLASS}>{summary}</span>
          </span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        <span className={RECEIVING_TRAIL_SLOT_CLASS}>
          <ChevronDown
            className={`h-[14px] w-[14px] shrink-0 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>
      {open ? (
        <>
          <div className="border-t border-slate-100" aria-hidden />
          <div className={bodyClassName}>{children}</div>
        </>
      ) : null}
    </div>
  );
}

type ReceivingLabelPayload = {
  /** Numeric receiving id — used to build the phone-scannable QR URL. */
  receivingId?: number | null;
  /** Human-readable PO/RCV identifier shown as the "last 4" on the label face. */
  scanValue: string;
  platform: string;
  zendeskTicket?: string;
  /** Support / carton notes printed in the label center — any free text. */
  notes: string;
  conditionCode: string;
  date: string;
};

/**
 * The string actually encoded into the printed QR. When we know the
 * receiving id we encode the full mobile URL so a phone scanning the label
 * opens the carton page natively. Falls back to the human-readable
 * scanValue for legacy callers (no receivingId provided).
 */
function resolveReceivingLabelQrValue(payload: ReceivingLabelPayload): string {
  if (payload.receivingId != null && Number.isFinite(payload.receivingId)) {
    return mobileQrUrl('r', payload.receivingId);
  }
  return payload.scanValue.trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function printReceivingLabel(payload: ReceivingLabelPayload) {
  if (typeof window === 'undefined') return;
  const scanValue = payload.scanValue.trim();
  const qrPayload = resolveReceivingLabelQrValue(payload);
  if (!qrPayload) return;

  const qrSvg = renderToStaticMarkup(
    <QRCode
      value={qrPayload}
      size={80}
      level="M"
      fgColor="#000000"
      bgColor="#ffffff"
    />,
  );

  const condShort = conditionShort(payload.conditionCode);
  const condHtml = escapeHtml(condShort);

  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Label</title>
<style>
  @page{size:2in 1in;margin:0}
  *,*::before,*::after{box-sizing:border-box}
  html,body{width:2in;height:1in;padding:0;margin:0;font-family:Arial,sans-serif;color:#111}
  .wrap{width:2in;height:1in;display:flex;align-items:stretch;gap:4px;padding:4px 5px}
  .info{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;justify-content:space-between;height:100%}
  .row{display:flex;justify-content:space-between;align-items:baseline;gap:4px;line-height:1}
  .platform{font-size:11px;font-weight:700;color:#374151;text-transform:capitalize;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .notes{flex:1 1 auto;min-height:0;font-size:10px;font-weight:600;color:#111;text-transform:none;letter-spacing:0;text-align:center;line-height:1.12;overflow:hidden;padding:0 1px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow-wrap:anywhere;word-break:break-word;align-self:stretch;-webkit-hyphens:auto;hyphens:auto}
  .cond{font-size:13px;font-weight:900;color:#111;white-space:nowrap}
  .po{font-size:12px;font-weight:900;letter-spacing:0.3px;line-height:1.05;color:#111;white-space:nowrap;font-variant-numeric:tabular-nums}
  .date{font-size:11px;font-weight:700;color:#4b5563;white-space:nowrap;font-variant-numeric:tabular-nums}
  .qr{flex:0 0 auto;width:0.86in;height:0.86in;display:flex;align-items:center;justify-content:center}
  .qr svg{width:100%;height:100%;display:block}
</style></head><body>
<div class="wrap">
  <div class="info">
    <div class="row">
      <span class="platform">${escapeHtml(payload.platform)}</span>
      <span class="date">${escapeHtml(payload.date)}</span>
    </div>
    <div class="notes">${escapeHtml((payload.notes || '').trim())}</div>
    <div class="row">
      <span class="cond">${condHtml}</span>
      <span class="po">${escapeHtml(receivingLabelPoCornerDisplay(payload))}</span>
    </div>
  </div>
  <div class="qr">${qrSvg}</div>
</div>
<script>
window.onload=function(){
  setTimeout(function(){window.focus();window.print();},120);
};
window.onafterprint=function(){setTimeout(function(){window.close();},80);};
</script>
</body></html>`;

  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) {
    console.warn('printReceivingLabel: popup blocked');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function ReceivingPoLabelPreview({
  receivingId,
  scanValue,
  platform,
  notes,
  zendeskTicket,
  conditionCode,
  date,
  embedded,
}: ReceivingLabelPayload & { embedded?: boolean }) {
  const safe = scanValue.trim();
  const qrPayload = resolveReceivingLabelQrValue({
    receivingId,
    scanValue,
    platform,
    notes,
    zendeskTicket,
    conditionCode,
    date,
  });
  if (!qrPayload) return null;
  const innerShell = embedded
    ? 'w-full bg-white'
    : 'w-full rounded-lg border border-gray-200/80 bg-white px-3 py-3 shadow-sm';
  const inner = (
    <div className={innerShell}>
      <div className="flex min-h-[6.5rem] flex-nowrap items-stretch gap-4">
        <div className="min-w-0 flex flex-1 flex-col justify-between py-1">
          <div className="flex items-baseline justify-between gap-2 text-[14px] leading-none">
            <span className="truncate font-bold text-gray-700">{platform}</span>
            <span className="shrink-0 tabular-nums font-semibold text-gray-600">{date}</span>
          </div>
          <div className="flex min-h-0 flex-1 min-w-0 items-center justify-center px-0.5">
            <span className="line-clamp-3 w-full text-center text-[11px] font-semibold leading-tight tracking-normal text-gray-900 normal-case">
              {notes.trim()}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2 text-[15px] leading-none">
            <ConditionHeaderDisplay code={conditionCode} />
            <span className="shrink-0 tabular-nums font-black text-gray-900">
              {receivingLabelPoCornerDisplay({
                receivingId,
                scanValue: safe,
                platform,
                notes,
                zendeskTicket,
                conditionCode,
                date,
              })}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center [&_svg]:block">
          <QRCode value={qrPayload} size={96} level="M" fgColor="#000000" bgColor="#ffffff" />
        </div>
      </div>
    </div>
  );
  if (embedded) {
    return inner;
  }
  return (
    <div className="border-t border-gray-200 bg-gray-50">
      <div className="flex items-center gap-3 px-3 pt-3 pb-2">
        <span className="text-[9px] font-black tabular-nums text-gray-500 tracking-widest">03</span>
        <span className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-600">
          Review &amp; print
        </span>
      </div>
      <div className="px-3 pb-3">{inner}</div>
    </div>
  );
}

function ReceivingProductLabelPreview({
  sku,
  title,
  serialNumber,
  embedded,
}: {
  sku: string;
  title: string;
  serialNumber: string;
  embedded?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [libReady, setLibReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadBarcodeLibrary()
      .then(() => {
        if (!cancelled) setLibReady(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!libReady || !sku.trim()) return;
    renderBarcode(canvasRef.current, sku.trim(), {
      format: 'CODE128',
      lineColor: '#000',
      width: 2,
      height: 50,
      displayValue: false,
    });
  }, [libReady, sku]);

  if (!sku.trim()) return null;

  const innerShell = embedded
    ? 'flex w-full flex-nowrap items-start justify-between gap-3 bg-white'
    : 'flex flex-nowrap items-start justify-between gap-3 rounded-lg border border-gray-200/80 bg-white px-3 py-3 shadow-sm';
  const inner = (
    <div className={innerShell}>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-base font-black tracking-tight text-gray-900">{sku.trim()}</p>
        {title.trim() ? (
          <p className="mt-1 line-clamp-3 text-[11px] text-gray-500 leading-snug">{title}</p>
        ) : null}
        {serialNumber.trim() ? (
          <p className="mt-1 text-[10px] font-mono text-gray-500">SN: {serialNumber.trim()}</p>
        ) : null}
      </div>
      <div className="shrink-0 self-center">
        <canvas ref={canvasRef} className="max-w-[min(100%,9rem)]" />
      </div>
    </div>
  );
  if (embedded) {
    return inner;
  }
  return (
    <div className="border-t border-gray-200 bg-gray-50">
      <div className="flex items-center gap-3 px-3 pt-3 pb-2">
        <span className="text-[9px] font-black tabular-nums text-gray-500 tracking-widest">03</span>
        <span className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-600">
          Review & print
        </span>
      </div>
      <div className="px-3 pb-3">{inner}</div>
    </div>
  );
}

function LineEditPanel({
  row,
  staffId,
  compact = false,
  accordionBootstrap = 'default',
  onClose,
  onPrev,
  onNext,
  canPrev = false,
  canNext = false,
  itemIndex,
  itemTotal,
}: {
  row: ReceivingLineRow;
  staffId: string;
  compact?: boolean;
  /** `'all'` opens Shipment PO, Item, and Support sections (table row selection). */
  accordionBootstrap?: 'default' | 'all';
  onPrev?: () => void;
  onNext?: () => void;
  canPrev?: boolean;
  canNext?: boolean;
  /** 0-based index of the current item within the PO */
  itemIndex?: number;
  /** Total number of items in the PO */
  itemTotal?: number;
  onClose: () => void;
}) {
  const [receivingType, setReceivingType] = useState(row.receiving_type || 'PO');
  const [qa, setQa] = useState(
    !row.qa_status || row.qa_status === 'PENDING' ? 'PASSED' : row.qa_status,
  );
  const [disp, setDisp] = useState(
    !row.disposition_code || row.disposition_code === 'HOLD' ? 'ACCEPT' : row.disposition_code,
  );
  const [cond, setCond] = useState(row.condition_grade || 'USED_A');
  const [notes, setNotes] = useState('');
  const [trackingEdit, setTrackingEdit] = useState(row.tracking_number || '');
  const [zendesk, setZendesk] = useState('');
  const [serialInput, setSerialInput] = useState('');
  const [listingLink, setListingLink] = useState('');
  const [saving, setSaving] = useState(false);
  const [serialSubmitting, setSerialSubmitting] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [sourcePlatform, setSourcePlatform] = useState<string>('');
  const [platformSaving, setPlatformSaving] = useState(false);
  type FlowSecKey = 'shipment' | 'item' | 'support';
  const [flowOpen, setFlowOpen] = useState<Record<FlowSecKey, boolean>>(() =>
    accordionBootstrap === 'all'
      ? { shipment: true, item: true, support: true }
      : {
          shipment: true,
          item: !compact,
          support: false,
        },
  );
  const [extraTrackings, setExtraTrackings] = useState<string[]>([]);
  const [extraSerials, setExtraSerials] = useState<string[]>([]);
  const [zohoSyncing, setZohoSyncing] = useState(false);
  const serialRef = useRef<HTMLInputElement>(null);
  const listingRef = useRef<HTMLInputElement>(null);

  const persistZendeskRef = useRef(zendesk);
  const persistListingRef = useRef(listingLink);
  const persistNotesRef = useRef(notes);
  const persistExtraTrackingsRef = useRef(extraTrackings);
  persistZendeskRef.current = zendesk;
  persistListingRef.current = listingLink;
  persistNotesRef.current = notes;
  persistExtraTrackingsRef.current = extraTrackings;

  const toggleFlow = useCallback((key: FlowSecKey) => {
    setFlowOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  useEffect(() => {
    setFlowOpen(
      accordionBootstrap === 'all'
        ? { shipment: true, item: true, support: true }
        : {
            shipment: true,
            item: !compact,
            support: false,
          },
    );
  }, [compact, row.id, accordionBootstrap]);

  useEffect(() => {
    setReceivingType(row.receiving_type || 'PO');
    setQa(!row.qa_status || row.qa_status === 'PENDING' ? 'PASSED' : row.qa_status);
    setDisp(!row.disposition_code || row.disposition_code === 'HOLD' ? 'ACCEPT' : row.disposition_code);
    setCond(row.condition_grade || 'USED_A');
    setTrackingEdit(row.tracking_number || '');
  }, [row.id, row.qa_status, row.disposition_code, row.condition_grade, row.tracking_number, row.receiving_type]);

  // When the carton changes, flush scratch for the previous receiving_id
  // so localStorage is not lost before loading the next carton’s scratch.
  const prevReceivingIdForFlushRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevReceivingIdForFlushRef.current;
    const next = row.receiving_id;
    if (prev != null && prev !== next) {
      writeReceivingLineDetailsScratch(prev, {
        zendesk: persistZendeskRef.current,
        listing: persistListingRef.current,
        notes: persistNotesRef.current,
        extra_trackings: persistExtraTrackingsRef.current.filter((t) => t.trim().length > 0),
      });
    }
    prevReceivingIdForFlushRef.current = next ?? null;
  }, [row.receiving_id]);

  // Restore Zendesk, listing, notes from localStorage when switching cartons (layout phase
  // so persist effect sees hydrated values). Same carton + different line: unchanged.
  useLayoutEffect(() => {
    if (row.receiving_id == null) {
      setZendesk('');
      setListingLink('');
      setNotes('');
      setExtraTrackings([]);
      return;
    }
    const d = readReceivingLineDetailsScratch(row.receiving_id);
    setZendesk(d.zendesk);
    setListingLink(d.listing);
    setNotes(d.notes);
    setExtraTrackings(d.extra_trackings.length > 0 ? d.extra_trackings : []);
  }, [row.receiving_id]);

  // Serial is per line; when moving between lines, prefill from the row's
  // already-recorded serials (most recent wins) so the sidebar reflects what
  // the table chip shows. Falls back to empty when the line has none.
  useEffect(() => {
    const localSerials = (row.serials ?? []) as Array<{ serial_number?: string | null }>;
    const latest = localSerials.length > 0
      ? String(localSerials[localSerials.length - 1]?.serial_number || '').trim()
      : '';
    setSerialInput(latest);
  }, [row.id, row.serials]);

  // Prefill Zendesk, listing, and serial from Zoho PO notes + line description.
  useEffect(() => {
    const poId = (row.zoho_purchaseorder_id || '').trim();
    if (!poId) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/zoho/purchase-orders?purchaseorder_id=${encodeURIComponent(poId)}`,
        );
        const data = await res.json();
        if (cancelled || !data?.success || !data.purchaseorder) return;

        const po = data.purchaseorder as {
          notes?: string | null;
          line_items?: Array<{ line_item_id?: string; description?: string | null }>;
        };

        const rid = row.receiving_id;
        const scratch = readReceivingLineDetailsScratch(rid);
        const { zendesk: zPo, listing: lPo } = parseZendeskListingFromPoNotes(po.notes ?? '');
        if (!scratch.zendesk.trim() && zPo) setZendesk(zPo);
        if (!scratch.listing.trim() && lPo) setListingLink(lPo);

        const lineItemId = (row.zoho_line_item_id || '').trim();
        if (!lineItemId || !Array.isArray(po.line_items)) return;
        const li = po.line_items.find(
          (l) => String(l.line_item_id || '').trim() === lineItemId,
        );
        // Local serials (from serial_units via receiving-lines `include=serials`)
        // win over the Zoho PO description. Only fall back to Zoho when the
        // line has no local serial on file yet.
        const hasLocalSerial = (row.serials ?? []).some((s) => (s.serial_number || '').trim());
        if (hasLocalSerial) return;
        const sn = parseSerialFromLineDescription(li?.description ?? null);
        if (sn) setSerialInput(sn);
      } catch {
        /* Zoho unavailable — fields stay empty */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [row.id, row.receiving_id, row.zoho_purchaseorder_id, row.zoho_line_item_id]);

  // Persist scratch per carton. Skip one write right after receiving_id
  // changes (flush already saved the previous carton; load will hydrate this one).
  const previousReceivingIdForPersistRef = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    const prev = previousReceivingIdForPersistRef.current;
    const cur = row.receiving_id;

    if (cur == null) {
      previousReceivingIdForPersistRef.current = cur;
      return;
    }

    const transitioned = prev !== cur && prev !== undefined;
    previousReceivingIdForPersistRef.current = cur;

    if (transitioned) {
      return;
    }

    writeReceivingLineDetailsScratch(cur, {
      zendesk,
      listing: listingLink,
      notes,
      extra_trackings: extraTrackings.map((t) => t.trim()).filter(Boolean),
    });
  }, [zendesk, listingLink, notes, extraTrackings, row.receiving_id]);

  // Load the parent receiving row's source_platform so the dropdown reflects
  // the current shipment-level override (platform is per-carton, not per-line).
  useEffect(() => {
    if (row.receiving_id == null) {
      setSourcePlatform('');
      return;
    }
    let cancelled = false;
    fetch(`/api/receiving-lines?receiving_id=${row.receiving_id}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const pkg = parseReceivingPackage(data?.receiving_package);
        setSourcePlatform((pkg?.source_platform || '').toLowerCase());
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [row.receiving_id]);

  const savePlatform = useCallback(async (next: string) => {
    if (row.receiving_id == null) return;
    setPlatformSaving(true);
    try {
      await fetch(`/api/receiving/${row.receiving_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_platform: next || null }),
      });
      window.dispatchEvent(new CustomEvent('receiving-package-updated', {
        detail: { receiving_id: row.receiving_id, source_platform: next || null },
      }));
    } catch {
      /* silent */
    } finally {
      setPlatformSaving(false);
    }
  }, [row.receiving_id]);

  // Keep this inspector in sync when the platform is changed elsewhere
  // (top PO card, another open inspector for the same receiving row).
  useEffect(() => {
    if (row.receiving_id == null) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ receiving_id?: number; source_platform?: string | null }>).detail;
      if (!detail || detail.receiving_id !== row.receiving_id) return;
      setSourcePlatform((detail.source_platform || '').toLowerCase());
    };
    window.addEventListener('receiving-package-updated', handler);
    return () => window.removeEventListener('receiving-package-updated', handler);
  }, [row.receiving_id]);

  const patch = useCallback(async (fields: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch('/api/receiving-lines', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, ...fields }),
      });
      const data = await res.json();
      if (data?.success && data.receiving_line) {
        dispatchLineUpdated(data.receiving_line);
      }
    } catch { /* silent */ } finally {
      setSaving(false);
    }
  }, [row.id]);

  const refreshLineWithSerials = useCallback(async () => {
    try {
      const res = await fetch(`/api/receiving-lines?id=${row.id}&include=serials`);
      const data = await res.json();
      if (data?.success && data.receiving_line) {
        dispatchLineUpdated(data.receiving_line as ReceivingLineRow);
      }
    } catch {
      /* silent */
    }
  }, [row.id]);

  const submitSerial = useCallback(async (raw?: string) => {
    const serial = (raw ?? serialInput).trim();
    if (!serial || !row.receiving_id || serialSubmitting) return;
    setSerialSubmitting(true);
    try {
      const res = await fetch('/api/receiving/scan-serial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiving_id: row.receiving_id,
          receiving_line_id: row.id,
          serial_number: serial,
          staff_id: Number(staffId),
        }),
      });
      const data = await res.json();
      if (data?.success && data.line_state && typeof data.line_state.id === 'number') {
        setSerialInput('');
        const ls = data.line_state;
        dispatchLineUpdated({
          id: ls.id,
          quantity_received: ls.quantity_received,
          quantity_expected: ls.quantity_expected,
          workflow_status: ls.workflow_status ?? undefined,
        });
        window.dispatchEvent(new CustomEvent('receiving-serial-scanned', {
          detail: {
            line_id: row.id,
            new_qty: ls.quantity_received,
            serial_unit: data.serial_unit,
            is_return: !!data.is_return,
            is_complete: !!ls.is_complete,
          },
        }));
        setTimeout(() => serialRef.current?.focus(), 40);
        void refreshLineWithSerials();
      }
    } catch { /* silent */ } finally {
      setSerialSubmitting(false);
    }
  }, [serialInput, row.receiving_id, row.id, staffId, serialSubmitting, refreshLineWithSerials]);

  const submitExtraSerial = useCallback(async (idx: number) => {
    const serial = (extraSerials[idx] ?? '').trim();
    if (!serial) return;
    await submitSerial(serial);
    setExtraSerials((xs) => xs.filter((_, j) => j !== idx));
  }, [extraSerials, submitSerial]);

  const handleReceive = useCallback(async () => {
    if (receiving || row.receiving_id == null) return;
    setReceiving(true);
    try {
      const perLineNotes = notes.trim() || null;

      const markRes = await fetch('/api/receiving/mark-received-po', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiving_id: row.receiving_id,
          receiving_line_id: row.id,
          qa_status: qa,
          disposition_code: disp,
          condition_grade: cond,
          serial_number: serialInput.trim() || undefined,
          zendesk_ticket: zendesk.trim() || undefined,
          listing_link: listingLink.trim() || undefined,
          notes: perLineNotes || undefined,
          staff_id: Number(staffId),
        }),
      });
      const markData = await markRes.json().catch(() => null);
      if (markRes.ok && markData?.success) {
        try {
          const linesRes = await fetch(`/api/receiving-lines?receiving_id=${row.receiving_id}`);
          const lineData = await linesRes.json();
          const rows = Array.isArray(lineData?.receiving_lines) ? lineData.receiving_lines : [];
          for (const r of rows) {
            dispatchLineUpdated(r as ReceivingLineRow);
          }
        } catch { /* table may still reflect partial state */ }
      }

      if (!markRes.ok || !markData?.success) {
        console.error('receiving/mark-received-po failed', { status: markRes.status, error: markData?.error });
        toast.error(markData?.error || `Receive failed (HTTP ${markRes.status})`);
      } else {
        const zoho = markData?.zoho as
          | {
              attempted?: number;
              ok?: boolean;
              rate_limited?: boolean;
              error?: string | null;
              results?: Array<{ receive_id: string | null; error: string | null; error_kind?: string | null }>;
            }
          | undefined;
        if (zoho?.attempted) {
          if (zoho.rate_limited) {
            toast.error('Zoho daily API quota exhausted — PO was NOT marked received in Zoho. Local DB updated.', {
              description: 'Wait for the daily reset or reduce other Zoho-touching workflows for now.',
              duration: 8000,
            });
          } else if (!zoho.ok) {
            toast.error(`Zoho receive failed: ${zoho.error || 'unknown error'}`, { duration: 6000 });
          } else {
            const firstId = zoho.results?.find((r) => r.receive_id)?.receive_id;
            toast.success(`PO marked received in Zoho${firstId ? ` (receive ${firstId})` : ''}`);
          }
        } else {
          toast.success('Line received');
        }
      }

      window.dispatchEvent(new CustomEvent('receiving-entry-added'));
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch (err) {
      console.error('receiving/mark-received-po threw', err);
      toast.error(err instanceof Error ? err.message : 'Receive failed');
    } finally {
      setReceiving(false);
    }
  }, [receiving, row.receiving_id, row.id, qa, disp, cond, notes, zendesk, listingLink, serialInput, staffId]);

  const poNumber = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
  const scanValue = poNumber || (row.receiving_id != null ? `RCV-${row.receiving_id}` : '');
  const trackingHint = (row.tracking_number || trackingEdit || '').trim();
  const labelPlatform = sourcePlatform
    ? (SOURCE_PLATFORM_LABELS[sourcePlatform] ?? sourcePlatform)
    : String(receivingType || 'PO').toUpperCase() === 'PICKUP' ? 'Local pickup' : 'Unknown';
  const labelDate = new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
  const labelPayload: ReceivingLabelPayload = {
    receivingId: row.receiving_id ?? null,
    scanValue,
    platform: labelPlatform,
    zendeskTicket: zendesk.trim() || undefined,
    notes: notes.trim(),
    conditionCode: cond,
    date: labelDate,
  };

  const notesPreview = notes.trim();
  const inboundSummary = (
    <>
      <span className="min-w-0 truncate" title={trackingHint || undefined}>
        {trackingHint ? getLast4(trackingHint) : '—'}
      </span>
      <span className={FLOW_SECTION_SUMMARY_SEP_CLASS} aria-hidden>
        ·
      </span>
      <span className="min-w-0 max-w-full break-words text-right">{labelPlatform}</span>
      {notesPreview ? (
        <>
          <span className={FLOW_SECTION_SUMMARY_SEP_CLASS} aria-hidden>
            ·
          </span>
          <span className="min-w-0 max-w-[min(11rem,50%)] truncate text-right" title={notesPreview}>
            {notesPreview}
          </span>
        </>
      ) : null}
    </>
  );

  const runPrintLabel = useCallback(() => {
    if (scanValue.trim()) {
      printReceivingLabel(labelPayload);
      return;
    }
    const skuTrim = (row.sku || '').trim();
    if (skuTrim) {
      printProductLabel({
        sku: skuTrim,
        title: row.item_name ?? undefined,
        serialNumber: serialInput.trim() || undefined,
      });
    }
  }, [scanValue, labelPayload, row.sku, row.item_name, serialInput]);

  const handlePrintAndReceive = useCallback(async () => {
    runPrintLabel();
    await handleReceive();
  }, [runPrintLabel, handleReceive]);

  const canPrintReview = Boolean(scanValue.trim() || (row.sku || '').trim());
  const canReceiveReview = row.receiving_id != null && !receiving;
  const combinedReviewDisabled = receiving || (!canPrintReview && !canReceiveReview);

  const recordedSerials = row.serials ?? [];

  const listingOpenHref = listingUrlForOpen(listingLink);

  // Refresh ↔ Zoho. Always searches by tracking# (PO# search is a future upd).
  // Flow:
  //   1. find-po by tracking# — Zoho is the source of truth.
  //   2. Reconcile the line: if Zoho's purchaseorder_id or number differs
  //      from the local line, PATCH /api/receiving-lines. No-op on match.
  //   3. Reconcile the carton (receiving row): PATCH with PO# + tracking#
  //      when `receiving_id` is set. Otherwise fall back to /api/receiving/
  //      lookup-po which creates/links a carton from the tracking#.
  const syncWithZoho = useCallback(async () => {
    if (zohoSyncing) return;
    const tracking = (row.tracking_number || '').trim();
    if (!tracking) return;
    setZohoSyncing(true);
    try {
      const knownPoId = (row.zoho_purchaseorder_id || '').trim();

      // Fast path: PO ID already known — skip the slow find-po search and
      // go straight to the single-PO fetch for notes/listing prefill.
      if (knownPoId) {
        // Re-fetch the line to pick up any server-side changes.
        const lineRes = await fetch(`/api/receiving-lines?id=${row.id}`);
        const lineData = await lineRes.json();
        if (lineData?.success && lineData.receiving_line) {
          dispatchLineUpdated(lineData.receiving_line as ReceivingLineRow);
        }

        // Fetch full PO for notes → prefill listing / zendesk.
        try {
          const poRes = await fetch(
            `/api/zoho/purchase-orders?purchaseorder_id=${encodeURIComponent(knownPoId)}`,
          );
          const poData = await poRes.json();
          if (poData?.success && poData.purchaseorder) {
            const poNotes = (poData.purchaseorder as { notes?: string | null }).notes ?? '';
            const parsed = parseZendeskListingFromPoNotes(poNotes);
            if (!listingLink.trim() && parsed.listing) setListingLink(parsed.listing);
            if (!zendesk.trim() && parsed.zendesk) setZendesk(parsed.zendesk);
          }
        } catch { /* PO fetch failed — fields stay as-is */ }
        return;
      }

      // Slow path: no PO ID yet — search Zoho by tracking number.
      const findRes = await fetch('/api/zoho/find-po', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingNumber: tracking }),
      });
      const findData = await findRes.json();
      const po = findData?.success && findData.matched ? findData.purchase_order : null;

      // Reconcile the line's PO#/number only if Zoho disagrees.
      if (po) {
        const zohoId = (po.zoho_purchaseorder_id || '').trim() || null;
        const zohoNum = (po.zoho_purchaseorder_number || '').trim() || null;
        const localId = (row.zoho_purchaseorder_id || '').trim() || null;
        const localNum = (row.zoho_purchaseorder_number || '').trim() || null;
        const patchBody: Record<string, unknown> = { id: row.id };
        if (zohoId && zohoId !== localId) patchBody.zoho_purchaseorder_id = zohoId;
        if (zohoNum && zohoNum !== localNum) patchBody.zoho_purchaseorder_number = zohoNum;
        if (Object.keys(patchBody).length > 1) {
          await fetch('/api/receiving-lines', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patchBody),
          });
        }
      }

      // Reconcile the carton.
      if (row.receiving_id) {
        if (po) {
          await fetch(`/api/receiving/${row.receiving_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              zoho_purchaseorder_id: po.zoho_purchaseorder_id || null,
              zoho_purchaseorder_number: po.zoho_purchaseorder_number || null,
              reference_number: po.reference_number || tracking,
            }),
          });
        }
      } else {
        await fetch('/api/receiving/lookup-po', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackingNumber: tracking, staffId: Number(staffId) }),
        });
        window.dispatchEvent(new CustomEvent('usav-refresh-data'));
      }

      // Re-fetch the line so sidebar + table pick up every change.
      const lineRes = await fetch(`/api/receiving-lines?id=${row.id}`);
      const lineData = await lineRes.json();
      if (lineData?.success && lineData.receiving_line) {
        dispatchLineUpdated(lineData.receiving_line as ReceivingLineRow);
      }

      // Prefill listing / zendesk from PO notes if still empty.
      const resolvedPoId = (po?.zoho_purchaseorder_id || '').trim();
      if (resolvedPoId) {
        try {
          const poRes = await fetch(
            `/api/zoho/purchase-orders?purchaseorder_id=${encodeURIComponent(resolvedPoId)}`,
          );
          const poData = await poRes.json();
          if (poData?.success && poData.purchaseorder) {
            const poNotes = (poData.purchaseorder as { notes?: string | null }).notes ?? '';
            const parsed = parseZendeskListingFromPoNotes(poNotes);
            if (!listingLink.trim() && parsed.listing) setListingLink(parsed.listing);
            if (!zendesk.trim() && parsed.zendesk) setZendesk(parsed.zendesk);
          }
        } catch { /* PO fetch failed — fields stay as-is */ }
      }
    } catch {
      /* silent — user can retry */
    } finally {
      setZohoSyncing(false);
    }
  }, [zohoSyncing, row.id, row.receiving_id, row.tracking_number,
      row.zoho_purchaseorder_id, row.zoho_purchaseorder_number, staffId,
      listingLink, zendesk]);

  const hasItemNav = typeof itemIndex === 'number' && typeof itemTotal === 'number' && itemTotal > 0;
  const itemCountSummary = hasItemNav && (itemTotal ?? 0) > 1
    ? `${itemTotal} items`
    : undefined;

  return (
    <div className="border-b border-slate-200 bg-slate-50">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-2 py-0.5">
        <button
          type="button"
          onClick={syncWithZoho}
          disabled={zohoSyncing}
          aria-label="Sync with Zoho by tracking number"
          title="Sync with Zoho by tracking number"
          className="text-slate-400 transition-colors hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${zohoSyncing ? 'animate-spin' : ''}`} />
        </button>
        {(zohoSyncing || saving || platformSaving) && (
          <span className="text-[9px] font-black uppercase tracking-[0.18em] text-blue-600" aria-live="polite">
            {zohoSyncing ? 'Syncing' : 'Saving'}
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('receiving-navigate-table', { detail: 'prev' }))}
          aria-label="Previous row in table"
          title="Previous row"
          className="text-slate-400 transition-colors hover:text-slate-700"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('receiving-navigate-table', { detail: 'next' }))}
          aria-label="Next row in table"
          title="Next row"
          className="text-slate-400 transition-colors hover:text-slate-700"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <div className="divide-y divide-slate-200 border-t border-slate-200">
        {/* ── SHIPMENT PO ── */}
        <FlowSection
          title="Shipment PO"
          summary={inboundSummary}
          open={flowOpen.shipment}
          onToggle={() => toggleFlow('shipment')}
        >
          <div className="space-y-1.5">
            <div>
              <div className="flex items-center gap-2">
                <span className={`${FLOW_SECTION_LABEL} mb-0 min-w-0 flex-1 leading-none`}>
                  Tracking numbers
                </span>
                <span className={RECEIVING_TRAIL_SLOT_CLASS}>
                  <button
                    type="button"
                    onClick={() => setExtraTrackings((xs) => [...xs, ''])}
                    aria-label="Add tracking number row"
                    title="Add tracking number"
                    className={TRACKING_ADD_BTN_CLASS}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </span>
              </div>
              <div className="group mt-0.5">
                <SearchBar
                  value={trackingEdit}
                  onChange={setTrackingEdit}
                  onSearch={(v) => {
                    const trimmed = v.trim();
                    if (trimmed !== (row.tracking_number || '').trim()) {
                      patch({ zoho_reference_number: trimmed || null });
                    }
                  }}
                  placeholder="Tracking"
                  variant="blue"
                  size="compact"
                  hideUnderline
                  hideClear
                  leadingIcon={<Barcode className="h-[14px] w-[14px]" />}
                  className="w-full"
                />
                <div className={RECEIVING_SCAN_RULE_LINE_CLASS} aria-hidden />
              </div>
              {extraTrackings.map((t, i) => (
                <div key={i} className="group mt-1 w-full min-w-0">
                  <div className="flex w-full min-w-0 items-center gap-2 pb-1">
                    <span className={TRACKING_ROW_LEADING_ICON_CLASS} aria-hidden>
                      <Barcode className="h-[14px] w-[14px]" />
                    </span>
                    <input
                      type="text"
                      value={t}
                      onChange={(e) => {
                        const v = e.target.value;
                        setExtraTrackings((xs) => xs.map((x, j) => (j === i ? v : x)));
                      }}
                      placeholder="Tracking"
                      className="h-5 min-w-0 flex-1 border-0 bg-transparent px-0 text-[11px] font-bold text-gray-900 outline-none placeholder:font-medium placeholder:text-gray-400"
                    />
                    <span className={RECEIVING_TRAIL_SLOT_CLASS}>
                      <button
                        type="button"
                        onClick={() => setExtraTrackings((xs) => xs.filter((_, j) => j !== i))}
                        aria-label="Remove this tracking row"
                        title="Remove"
                        className={TRACKING_REMOVE_BTN_CLASS}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  </div>
                  <div className={RECEIVING_SCAN_RULE_LINE_CLASS} aria-hidden />
                </div>
              ))}
            </div>

            <div>
              <span className={FLOW_SECTION_LABEL}>Listing URL</span>
              <div className="group mt-0.5">
                <SearchBar
                  value={listingLink}
                  onChange={setListingLink}
                  onClear={() => setListingLink('')}
                  inputRef={listingRef}
                  placeholder="Listing URL"
                  variant="blue"
                  size="compact"
                  hideUnderline
                  leadingIcon={
                    <button
                      type="button"
                      onClick={() => {
                        if (listingOpenHref) {
                          window.open(listingOpenHref, '_blank', 'noopener,noreferrer');
                        }
                      }}
                      disabled={listingOpenHref == null}
                      aria-label="Open listing URL in new tab"
                      title={listingOpenHref ? 'Open link' : 'Enter a valid URL'}
                      className="-m-0.5 rounded p-0.5 text-inherit transition-colors hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <ExternalLink className="h-[14px] w-[14px]" />
                    </button>
                  }
                  className="w-full"
                />
                <div className={RECEIVING_SCAN_RULE_LINE_CLASS} aria-hidden />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className={FLOW_SECTION_LABEL}>Platform</span>
                <select
                  value={sourcePlatform}
                  onChange={(e) => {
                    const next = e.target.value;
                    setSourcePlatform(next);
                    void savePlatform(next);
                  }}
                  disabled={row.receiving_id == null}
                  className={`${SELECT_CLASS} mt-0.5`}
                >
                  {SOURCE_PLATFORM_OPTS.map((opt) => (
                    <option key={opt.value || 'auto'} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <span className={FLOW_SECTION_LABEL}>Type</span>
                <select
                  value={receivingType}
                  onChange={(e) => {
                    setReceivingType(e.target.value);
                    patch({ receiving_type: e.target.value });
                  }}
                  className={`${SELECT_CLASS} mt-0.5`}
                >
                  {RECEIVING_TYPE_OPTS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </FlowSection>

        {/* ── ITEM ── */}
        <FlowSection
          title="Item"
          summary={itemCountSummary}
          open={flowOpen.item}
          onToggle={() => toggleFlow('item')}
          bodyClassName="px-2 pt-1.5 pb-0"
        >
          <div className="space-y-1.5">
            {/* Item position nav: only shown when multiple items */}
            {hasItemNav && (itemTotal ?? 0) > 1 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-black tabular-nums tracking-wider text-slate-500">
                  {(itemIndex ?? 0) + 1}/{itemTotal}
                </span>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={onPrev}
                  disabled={!onPrev || !canPrev}
                  aria-label="Previous item in PO"
                  title="Previous item"
                  className="shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={onNext}
                  disabled={!onNext || !canNext}
                  aria-label="Next item in PO"
                  title="Next item"
                  className="shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Product title */}
            <div>
              <span className={FLOW_SECTION_LABEL}>Product title</span>
              <p
                className={`mt-0.5 font-bold leading-snug text-slate-900 break-words ${compact ? 'text-[10px] line-clamp-3' : 'text-[11px]'}`}
              >
                {row.item_name || row.sku || `Line #${row.id}`}
              </p>
            </div>

            <div>
              <label htmlFor={`cond-${row.id}`} className={FLOW_SECTION_LABEL}>
                Condition
              </label>
              <select
                id={`cond-${row.id}`}
                value={cond}
                onChange={(e) => {
                  const v = e.target.value;
                  setCond(v);
                  void patch({ condition_grade: v });
                }}
                className={`${SELECT_CLASS} mt-0.5`}
                aria-label="Condition grade for this line item"
              >
                {CONDITION_OPTS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className={`${FLOW_SECTION_LABEL} mb-0 min-w-0 flex-1 leading-none`}>
                  Serial numbers
                </span>
                <span className={RECEIVING_TRAIL_SLOT_CLASS}>
                  <button
                    type="button"
                    onClick={() => setExtraSerials((xs) => [...xs, ''])}
                    aria-label="Add serial number row"
                    title="Add serial number"
                    className={TRACKING_ADD_BTN_CLASS}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </span>
              </div>
              <div className="group mt-0.5">
                <SearchBar
                  value={serialInput}
                  onChange={setSerialInput}
                  onSearch={(v) => submitSerial(v)}
                  onClear={() => setSerialInput('')}
                  inputRef={serialRef}
                  placeholder="Serial"
                  variant="blue"
                  size="compact"
                  hideUnderline
                  isSearching={serialSubmitting}
                  leadingIcon={<Barcode className="w-[14px] h-[14px]" />}
                  className="w-full"
                />
                <div className={RECEIVING_SCAN_RULE_LINE_CLASS} aria-hidden />
              </div>
              {extraSerials.map((s, i) => (
                <div key={i} className="group mt-1 w-full min-w-0">
                  <div className="flex w-full min-w-0 items-center gap-2 pb-1">
                    <span className={TRACKING_ROW_LEADING_ICON_CLASS} aria-hidden>
                      <Barcode className="h-[14px] w-[14px]" />
                    </span>
                    <input
                      type="text"
                      value={s}
                      onChange={(e) => {
                        const v = e.target.value;
                        setExtraSerials((xs) => xs.map((x, j) => (j === i ? v : x)));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); void submitExtraSerial(i); }
                      }}
                      placeholder="Serial"
                      className="h-5 min-w-0 flex-1 border-0 bg-transparent px-0 text-[11px] font-bold text-gray-900 outline-none placeholder:font-medium placeholder:text-gray-400"
                    />
                    <span className={RECEIVING_TRAIL_SLOT_CLASS}>
                      <button
                        type="button"
                        onClick={() => setExtraSerials((xs) => xs.filter((_, j) => j !== i))}
                        aria-label="Remove this serial row"
                        title="Remove"
                        className={TRACKING_REMOVE_BTN_CLASS}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  </div>
                  <div className={RECEIVING_SCAN_RULE_LINE_CLASS} aria-hidden />
                </div>
              ))}
            </div>
          </div>
        </FlowSection>

        <FlowSection
          title="Support"
          summary={zendesk.trim() ? 'Zendesk' : undefined}
          open={flowOpen.support}
          onToggle={() => toggleFlow('support')}
        >
          <div className="space-y-1.5">
            <div>
              <span className={FLOW_SECTION_LABEL}>Zendesk</span>
              <div className="mt-0.5 flex gap-1">
                <input
                  type="text"
                  value={zendesk}
                  onChange={(e) => setZendesk(e.target.value)}
                  placeholder="Ticket # or URL"
                  className={`${INPUT_CLASS} flex-1 min-w-0`}
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const t = await navigator.clipboard.readText();
                      if (t) setZendesk(t.trim());
                    } catch { /* */ }
                  }}
                  title="Paste"
                  className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-slate-500 transition-colors hover:bg-slate-50"
                >
                  <Clipboard className="h-3 w-3" />
                </button>
              </div>
            </div>
            <div>
              <span className={FLOW_SECTION_LABEL}>Notes</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => {
                  if (notes !== (row.notes || '')) patch({ notes });
                }}
                rows={2}
                placeholder="Notes"
                className="mt-0.5 w-full resize-none border border-slate-200 bg-white px-2 py-1 text-[10px] leading-snug text-slate-900 placeholder:text-slate-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
              />
            </div>
          </div>
        </FlowSection>

        <div className="space-y-1.5 bg-white px-2 py-1.5">
          <div className="relative z-20 flex w-full overflow-visible rounded border border-emerald-600 bg-emerald-600">
            <div className="group/split-menu relative flex shrink-0 self-stretch">
              <button
                type="button"
                aria-haspopup="menu"
                aria-label="Print only or receive all (no print)"
                title="Hover for print-only or receive-all (no print) actions"
                className="flex h-auto min-h-[28px] items-center justify-center border-r border-emerald-500/50 px-2 text-white outline-none transition-colors hover:bg-emerald-700 focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-emerald-600"
              >
                <ChevronDown className="h-4 w-4 opacity-95" aria-hidden />
              </button>
              <div
                className="
                    invisible absolute left-0 top-full z-50 pt-1.5 opacity-0
                    transition-opacity duration-75
                    group-hover/split-menu:pointer-events-auto group-hover/split-menu:visible group-hover/split-menu:opacity-100
                    group-focus-within/split-menu:pointer-events-auto group-focus-within/split-menu:visible group-focus-within/split-menu:opacity-100
                  "
                role="presentation"
              >
                <ul
                  role="menu"
                  aria-label="Single-action review controls"
                  className="min-w-[11rem] rounded-lg border border-slate-200 bg-white py-1 shadow-xl ring-1 ring-slate-200/80"
                >
                  <li role="none">
                    <button
                      role="menuitem"
                      type="button"
                      disabled={!canPrintReview}
                      onClick={(e) => {
                        e.stopPropagation();
                        runPrintLabel();
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[10px] font-black uppercase tracking-wider text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <Printer className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      Print only
                    </button>
                  </li>
                  <li role="none">
                    <button
                      role="menuitem"
                      type="button"
                      disabled={!canReceiveReview}
                      title={
                        row.receiving_id == null
                          ? 'Line must be linked to a shipment'
                          : undefined
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleReceive();
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[10px] font-black uppercase tracking-wider text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      {receiving ? 'Receiving…' : 'Receive all'}
                    </button>
                  </li>
                </ul>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handlePrintAndReceive()}
              disabled={combinedReviewDisabled}
              title={
                row.receiving_id == null && !scanValue.trim() && !(row.sku || '').trim()
                  ? 'Need a shipment link or SKU to continue'
                  : 'Print label (if available), then receive every open line on this PO in Zoho'
              }
              className="inline-flex min-h-[28px] min-w-0 flex-1 items-center justify-center gap-2 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-white outline-none transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-emerald-600"
            >
              <Printer className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {receiving ? 'Receiving…' : 'Print · receive all'}
            </button>
          </div>
          {scanValue || row.sku ? (
            <div className="-mx-2 border-t border-slate-200 px-2 py-1.5">
              {scanValue ? (
                <ReceivingPoLabelPreview {...labelPayload} embedded />
              ) : row.sku ? (
                <ReceivingProductLabelPreview
                  sku={row.sku}
                  title={row.item_name ?? ''}
                  serialNumber={serialInput.trim()}
                  embedded
                />
              ) : null}
            </div>
          ) : null}
          {row.receiving_id != null ? (
            <div className="-mx-3 border-t border-slate-200">
              <ReceivingPhotoStrip
                receivingId={row.receiving_id}
                staffId={Number(staffId) || 0}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ReceivingSidebarPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isMobile } = useUIModeOptional();
  const rawMode = searchParams.get('mode');
  const mode: ReceivingMode = rawMode === 'pickup' ? 'pickup' : 'receive';
  const staffId = searchParams.get('staffId') || '7';
  const staffIdNum = Number(staffId) || 0;

  // Ably handles are needed both for the existing phone-scan bridge (later in
  // this file) and the new photo-request publisher below. Hoisting the client
  // + channel names up here keeps the publisher's closure honest.
  const { getClient: getAblyClient } = useAblyClient();
  const phoneChannelName = `phone:${staffIdNum}`;
  const stationChannelName = `station:${staffIdNum}`;

  /**
   * Publish a `receiving_photo_request` on `station:{staffId}` so a phone
   * loaded on the same staff id auto-navigates to the photo capture page.
   * Implicit pairing: the channel name is the gate — no claim flow required.
   */
  const publishPhotoRequestFor = useCallback(
    async (receivingId: number, tracking: string) => {
      if (!Number.isFinite(receivingId) || receivingId <= 0 || staffIdNum <= 0) return;
      try {
        const client = await getAblyClient();
        if (!client) return;
        const ch = client.channels.get(stationChannelName);
        await ch.publish('receiving_photo_request', {
          receiving_id: receivingId,
          tracking,
          request_id: randomId(),
          requested_by_staff_id: staffIdNum,
        });
      } catch (err) {
        console.warn('receiving-sidebar: photo request publish failed', err);
      }
    },
    [getAblyClient, staffIdNum, stationChannelName],
  );

  useEffect(() => {
    if (mode === 'pickup') {
      window.dispatchEvent(new CustomEvent('receiving-clear-line'));
    }
  }, [mode]);

  const [bulkTracking, setBulkTracking] = useState('');
  const [scanBarKey, setScanBarKey] = useState(0);
  const [pendingScans, setPendingScans] = useState<PendingScan[]>([]);
  const anyScanChecking = pendingScans.some((s) => s.status === 'checking');
  const [openExceptions, setOpenExceptions] = useState<OpenException[]>([]);
  const [refreshingExceptionIds, setRefreshingExceptionIds] = useState<Set<number>>(new Set());

  const fetchOpenExceptions = useCallback(async () => {
    try {
      const res = await fetch('/api/tracking-exceptions?domain=receiving&status=open&limit=50', {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!data?.success) return;
      const rows = Array.isArray(data.rows) ? data.rows : [];
      setOpenExceptions(
        rows.map((r: Record<string, unknown>) => ({
          id: Number(r.id),
          tracking_number: String(r.tracking_number || ''),
          exception_reason: String(r.exception_reason || 'not_found'),
          created_at: String(r.created_at || ''),
          last_zoho_check_at: r.last_zoho_check_at ? String(r.last_zoho_check_at) : null,
          zoho_check_count: Number(r.zoho_check_count || 0),
        })),
      );
    } catch {
      /* silent — sidebar keeps prior list */
    }
  }, []);

  useEffect(() => {
    void fetchOpenExceptions();
  }, [fetchOpenExceptions]);

  const refreshException = useCallback(
    async (exceptionId: number) => {
      setRefreshingExceptionIds((prev) => {
        const next = new Set(prev);
        next.add(exceptionId);
        return next;
      });
      try {
        const res = await fetch(`/api/tracking-exceptions/${exceptionId}/refresh`, {
          method: 'POST',
        });
        await res.json().catch(() => null);
      } catch {
        /* ignore — fetchOpenExceptions below reflects whatever state is real */
      } finally {
        setRefreshingExceptionIds((prev) => {
          const next = new Set(prev);
          next.delete(exceptionId);
          return next;
        });
        await fetchOpenExceptions();
      }
    },
    [fetchOpenExceptions],
  );
  const [selectedLine, setSelectedLine] = useState<ReceivingLineRow | null>(null);
  /** `'all'` when the line was chosen from the main table — expands sidebar FlowSections. */
  const [lineAccordionBootstrap, setLineAccordionBootstrap] = useState<'default' | 'all'>(
    'default',
  );
  // `scanDriven` flips the LineEditPanel into compact mode; scans open it,
  // row-clicks open it in full mode. Cleared on close / filter change.
  const [scanDriven, setScanDriven] = useState(false);
  // Full ReceivingLineRow[] fetched after a tracking scan matches multiple
  // lines — rendered as a picker above LineEditPanel until one is chosen.
  const [scanMatchedRows, setScanMatchedRows] = useState<ReceivingLineRow[]>([]);

  // ─── Unboxing mode state ─────────────────────────────────────────────────
  const [poContext, setPoContext] = useState<PoContext | null>(null);
  const [armedLineId, setArmedLineId] = useState<number | null>(null);
  const [serialInput, setSerialInput] = useState('');
  const [serialSubmitting, setSerialSubmitting] = useState(false);
  const [returns, setReturns] = useState<ReturnEvent[]>([]);
  const [pendingCandidates, setPendingCandidates] = useState<PoLineSummary[]>([]);
  const [printOnScan, setPrintOnScan] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem('receiving.printOnScan');
    return stored === null ? true : stored === 'true';
  });
  const serialInputRef = useRef<HTMLInputElement>(null);

  const armedLine = useMemo<PoLineSummary | null>(() => {
    if (armedLineId == null || !poContext) return null;
    return poContext.lines.find((l) => l.id === armedLineId) ?? null;
  }, [armedLineId, poContext]);

  // When the user row-clicks a line in the dashboard table, scanMatchedRows
  // is empty — which would disable the up/down nav. Populate it lazily by
  // fetching all sibling lines for the same receiving_id. Skipped when
  // scanMatchedRows already contains the selected line (scan-driven entry
  // or a prior fetch).
  useEffect(() => {
    const receivingId = selectedLine?.receiving_id;
    if (!receivingId) return;
    if (scanMatchedRows.some((r) => r.id === selectedLine.id)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/receiving-lines?receiving_id=${receivingId}`);
        const data = await res.json();
        if (cancelled) return;
        const rows = Array.isArray(data?.receiving_lines)
          ? (data.receiving_lines as ReceivingLineRow[])
          : [];
        if (rows.length > 0) setScanMatchedRows(rows);
      } catch { /* silent — nav stays disabled if fetch fails */ }
    })();
    return () => { cancelled = true; };
  }, [selectedLine, scanMatchedRows]);

  // Navigation + progress derived from the full sibling-line list. Counter
  // sums *units* across every matched line (received vs expected) so the pill
  // mirrors the table row's quantityText (e.g. 0/5) instead of a line count
  // (0/1). A line with workflow_status=DONE is treated as fully received even
  // if quantity_received lags behind the expectation.
  const { currentIndex, canPrev, canNext, progressReceived, progressTotal } = useMemo(() => {
    if (!selectedLine || scanMatchedRows.length === 0) {
      return { currentIndex: -1, canPrev: false, canNext: false, progressReceived: 0, progressTotal: 0 };
    }
    const idx = scanMatchedRows.findIndex((r) => r.id === selectedLine.id);
    let receivedUnits = 0;
    let totalUnits = 0;
    for (const r of scanMatchedRows) {
      const expected = Math.max(0, Number(r.quantity_expected ?? 0));
      const received = Math.max(0, Number(r.quantity_received ?? 0));
      const isDone = String(r.workflow_status || '').toUpperCase() === 'DONE';
      const expectedSafe = expected > 0 ? expected : 1;
      totalUnits += expectedSafe;
      receivedUnits += isDone ? expectedSafe : Math.min(received, expectedSafe);
    }
    return {
      currentIndex: idx,
      canPrev: idx > 0,
      canNext: idx >= 0 && idx < scanMatchedRows.length - 1,
      progressReceived: receivedUnits,
      progressTotal: totalUnits,
    };
  }, [selectedLine, scanMatchedRows]);

  // Prev/next flips the local selectedLine and fires the dedicated
  // receiving-highlight-line event so the dashboard table's blue row
  // indicator follows along. We avoid dispatching receiving-select-line
  // because that handler wipes scanMatchedRows (row-click semantics) and
  // would break subsequent nav.
  const goPrevLine = useCallback(() => {
    if (currentIndex <= 0) return;
    const target = scanMatchedRows[currentIndex - 1];
    if (target) {
      setLineAccordionBootstrap('default');
      setSelectedLine(target);
      window.dispatchEvent(new CustomEvent('receiving-highlight-line', { detail: target.id }));
    }
  }, [currentIndex, scanMatchedRows]);

  const goNextLine = useCallback(() => {
    if (currentIndex < 0 || currentIndex >= scanMatchedRows.length - 1) return;
    const target = scanMatchedRows[currentIndex + 1];
    if (target) {
      setLineAccordionBootstrap('default');
      setSelectedLine(target);
      window.dispatchEvent(new CustomEvent('receiving-highlight-line', { detail: target.id }));
    }
  }, [currentIndex, scanMatchedRows]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('receiving.printOnScan', String(printOnScan));
  }, [printOnScan]);

  useEffect(() => {
    if (mode === 'pickup') {
      setPoContext(null);
      setArmedLineId(null);
      setSerialInput('');
      setReturns([]);
      setPendingCandidates([]);
    }
  }, [mode]);

  // ─── Selected line from table row click ──────────────────────────────────
  useEffect(() => {
    const handleSelect = (e: Event) => {
      const { row, expandFlowSections } = readSelectLineDetail(
        (e as CustomEvent<ReceivingSelectLineDetail>).detail,
      );
      const expand = Boolean(row != null && expandFlowSections);
      setLineAccordionBootstrap(expand ? 'all' : 'default');
      setSelectedLine(row);
      // Row clicks always open the full LineEditPanel (scan-driven → compact).
      setScanDriven(false);
      setScanMatchedRows([]);
    };
    const handleUpdated = (e: Event) => {
      const updated = (e as CustomEvent<Partial<ReceivingLineRow> & { id: number }>).detail;
      if (!updated || typeof updated.id !== 'number') return;
      setSelectedLine((prev) => (prev?.id === updated.id ? { ...prev, ...updated } : prev));
      setScanMatchedRows((rows) =>
        rows.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)),
      );
    };
    window.addEventListener('receiving-select-line', handleSelect);
    window.addEventListener('receiving-line-updated', handleUpdated);
    return () => {
      window.removeEventListener('receiving-select-line', handleSelect);
      window.removeEventListener('receiving-line-updated', handleUpdated);
    };
  }, []);

  // ─── Arm / disarm events from the main panel ────────────────────────────
  useEffect(() => {
    const handleArm = (e: Event) => {
      const detail = (
        e as CustomEvent<{ line_id?: number; sku?: string; item_name?: string }>
      ).detail;
      if (!detail?.line_id) return;
      setArmedLineId(detail.line_id);
    };
    const handleDisarm = () => setArmedLineId(null);

    window.addEventListener('receiving-arm-line', handleArm);
    window.addEventListener('receiving-disarm-line', handleDisarm);
    return () => {
      window.removeEventListener('receiving-arm-line', handleArm);
      window.removeEventListener('receiving-disarm-line', handleDisarm);
    };
  }, []);

  // ─── External receiving-active: main panel selected a pending receiving ─
  useEffect(() => {
    const handleActive = async (e: Event) => {
      const detail = (e as CustomEvent<{ receiving_id?: number }>).detail;
      const id = detail?.receiving_id;
      if (!id) return;
      if (poContext?.receiving_id === id) return;

      try {
        const res = await fetch(`/api/receiving-lines?receiving_id=${id}`);
        const data = await res.json();
        if (!data?.success) return;
        const lines: PoLineSummary[] = (data.receiving_lines || []).map((l: Record<string, unknown>) =>
          mapApiLineToPoSummary(l as Parameters<typeof mapApiLineToPoSummary>[0]),
        );
        const poIds = [
          ...new Set(
            lines
              .map((l) => (l.zoho_purchaseorder_id || '').trim())
              .filter((x) => x.length > 0),
          ),
        ];
        setPoContext({
          receiving_id: id,
          po_ids: poIds,
          lines,
          receiving_package: parseReceivingPackage(data.receiving_package),
        });
        setArmedLineId(null);
      } catch {
        /* ignore — sidebar stays empty */
      }
    };
    window.addEventListener('receiving-active', handleActive);
    return () => window.removeEventListener('receiving-active', handleActive);
  }, [poContext?.receiving_id]);

  const submitTrackingScan = useCallback((rawTracking?: string, opts?: { onResult?: (result: { tracking: string; matched: boolean; po_ids: string[]; receiving_id?: number; exception_id?: number | null; exception_reason?: string | null; error?: string }) => void }) => {
    const trackingNumber = (rawTracking ?? bulkTracking).trim();
    if (!trackingNumber) return;

    // 1. Clear the input immediately + insert a "checking" chip. Never blocks.
    setBulkTracking('');
    setScanBarKey((k) => k + 1); // force remount so SearchField's internal draft resets
    const scanUiId = randomId();
    setPendingScans((prev) => {
      const fresh: PendingScan = {
        id: scanUiId,
        tracking: trackingNumber,
        status: 'checking',
        startedAt: Date.now(),
      };
      return [
        fresh,
        ...prev.filter((s) => s.tracking !== trackingNumber || s.status !== 'checking'),
      ].slice(0, 10);
    });

    // 2. Fire-and-forget. Closure captures scanUiId so concurrent scans
    //    update their own chip independently.
    void (async () => {
      try {
        const res = await fetch('/api/receiving/lookup-po', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trackingNumber,
            staffId: Number(staffId),
          }),
        });
        const data = await res.json();

        if (!data?.success) {
          throw new Error(data?.error || 'Lookup failed');
        }

        const isMatched = Boolean(data.matched) && Array.isArray(data.lines) && data.lines.length > 0;

        if (isMatched) {
          opts?.onResult?.({
            tracking: trackingNumber,
            matched: true,
            po_ids: Array.isArray(data.po_ids) ? data.po_ids : [],
            receiving_id: Number(data.receiving_id),
          });

          const ctx: PoContext = {
            receiving_id: Number(data.receiving_id),
            po_ids: Array.isArray(data.po_ids) ? data.po_ids : [],
            lines: (data.lines || []).map((l: Record<string, unknown>) =>
              mapApiLineToPoSummary(l as Parameters<typeof mapApiLineToPoSummary>[0]),
            ),
            receiving_package: parseReceivingPackage(data.receiving_package),
          };

          setPoContext(ctx);
          setPendingCandidates([]);

          const openLines = ctx.lines.filter(
            (l) =>
              l.quantity_expected == null ||
              l.quantity_received < (l.quantity_expected ?? 0),
          );
          setArmedLineId(openLines.length === 1 ? openLines[0].id : null);

          // Fetch full ReceivingLineRow[] so the unified LineEditPanel can
          // open directly. Single open line → auto-select. Multiple open →
          // render the scan-line picker above LineEditPanel so the user picks.
          void (async () => {
            try {
              const linesRes = await fetch(`/api/receiving-lines?receiving_id=${ctx.receiving_id}`);
              const linesData = await linesRes.json();
              const rows = Array.isArray(linesData?.receiving_lines)
                ? (linesData.receiving_lines as ReceivingLineRow[])
                : [];
              setScanMatchedRows(rows);
              // Simpler workflow: surface every matched line at the top of the
              // History table immediately. The sidebar's deeper edit flow still
              // runs, but the user no longer has to scroll/search for what just
              // scanned in — and multi-line cartons show in full instead of
              // showing one at a time in the picker.
              if (rows.length > 0) {
                window.dispatchEvent(
                  new CustomEvent('receiving-lines-prepended', { detail: rows }),
                );
              }
              const openRows = rows.filter(
                (r) => r.quantity_expected == null || r.quantity_received < (r.quantity_expected ?? 0),
              );
              const pick = openRows.length === 1 ? openRows[0] : openRows.length === 0 && rows.length === 1 ? rows[0] : null;
              if (pick) {
                setLineAccordionBootstrap('default');
                setSelectedLine(pick);
                setScanDriven(true);
              } else {
                setLineAccordionBootstrap('default');
                setSelectedLine(null);
                setScanDriven(true);
              }
            } catch {
              /* silent — sidebar still has poContext for serial scans */
            }
          })();

          window.dispatchEvent(
            new CustomEvent('receiving-po-loaded', {
              detail: { receiving_id: ctx.receiving_id, lines: ctx.lines },
            }),
          );
          // Signal any phone listening on station:{staffId} that this carton
          // is the active one — the phone will auto-open its camera page.
          void publishPhotoRequestFor(ctx.receiving_id, trackingNumber);
          setTimeout(() => serialInputRef.current?.focus(), 60);

          setPendingScans((prev) =>
            prev.map((s) =>
              s.id === scanUiId
                ? {
                    ...s,
                    status: 'matched',
                    receiving_id: Number(data.receiving_id),
                    po_ids: Array.isArray(data.po_ids) ? data.po_ids : [],
                    scan_id: typeof data.scan_id === 'number' ? data.scan_id : undefined,
                  }
                : s,
            ),
          );

          // Auto-fade matched chip after 2s so the panel stays calm.
          setTimeout(() => {
            setPendingScans((prev) => prev.filter((s) => s.id !== scanUiId));
          }, 2000);
          // Matched path may have resolved a prior open exception; refresh list.
          void fetchOpenExceptions();
        } else {
          const exceptionId = typeof data.exception_id === 'number' ? data.exception_id : null;
          const exceptionReason = typeof data.exception_reason === 'string' ? data.exception_reason : null;
          opts?.onResult?.({
            tracking: trackingNumber,
            matched: false,
            po_ids: [],
            receiving_id: typeof data.receiving_id === 'number' ? data.receiving_id : undefined,
            exception_id: exceptionId,
            exception_reason: exceptionReason,
          });
          setPendingScans((prev) =>
            prev.map((s) =>
              s.id === scanUiId
                ? {
                    ...s,
                    status: 'unmatched',
                    receiving_id: typeof data.receiving_id === 'number' ? data.receiving_id : undefined,
                    scan_id: typeof data.scan_id === 'number' ? data.scan_id : undefined,
                    exception_id: exceptionId,
                    exception_reason: exceptionReason,
                  }
                : s,
            ),
          );
          window.dispatchEvent(
            new CustomEvent('receiving-entry-added', {
              detail: { id: String(data.receiving_id), tracking: trackingNumber },
            }),
          );
          // Unmatched path always upserts into tracking_exceptions — surface it.
          void fetchOpenExceptions();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Network error';
        opts?.onResult?.({ tracking: trackingNumber, matched: false, po_ids: [], error: message });
        setPendingScans((prev) =>
          prev.map((s) =>
            s.id === scanUiId ? { ...s, status: 'error', errorMessage: message } : s,
          ),
        );
      }
    })();
  }, [bulkTracking, staffId, fetchOpenExceptions]);

  const retryPendingScan = useCallback((tracking: string, id: string) => {
    setPendingScans((prev) => prev.filter((s) => s.id !== id));
    submitTrackingScan(tracking);
  }, [submitTrackingScan]);

  // Re-run the lookup on an existing scan chip: flip its status back to
  // 'checking', re-submit the tracking, and let the normal result handler
  // update the chip in place. Same flow as a fresh scan but without
  // re-inserting the chip.
  const refetchPendingScan = useCallback((tracking: string, id: string) => {
    setPendingScans((prev) => prev.map((s) =>
      s.id === id ? { ...s, status: 'checking', errorMessage: undefined } : s,
    ));
    submitTrackingScan(tracking);
  }, [submitTrackingScan]);

  const dismissPendingScan = useCallback((id: string) => {
    setPendingScans((prev) => prev.filter((s) => s.id !== id));
  }, []);

  // Phone-paired scans: incoming `phone_scan` messages route straight through
  // the same submitTrackingScan flow as if the desktop scanner had fired it.
  // After the lookup, echo the result back on the station channel so the
  // phone's chip can show matched/unmatched without a round-trip DB query.
  // (phoneChannelName / stationChannelName / getAblyClient are hoisted to
  //  the top of this component so the photo-request publisher can use them.)

  useAblyChannel(
    phoneChannelName,
    'phone_scan',
    (msg: { data?: { tracking?: string } }) => {
      const tracking = String(msg?.data?.tracking || '').trim();
      if (!tracking) return;
      submitTrackingScan(tracking, {
        onResult: async (result) => {
          try {
            const client = await getAblyClient();
            if (!client) return;
            const ch = client.channels.get(stationChannelName);
            await ch.publish('phone_scan_result', {
              tracking: result.tracking,
              matched: result.matched,
              po_ids: result.po_ids,
              receiving_id: result.receiving_id ?? null,
              exception_id: result.exception_id ?? null,
              exception_reason: result.exception_reason ?? null,
              error: result.error ?? null,
            });
          } catch (err) {
            console.warn('phone_scan_result publish failed', err);
          }
        },
      });
    },
    Number(staffId) > 0,
  );

  // ─── Unboxing mode: serial scan → scan-serial → bump qty, maybe print ───
  const submitSerialScan = useCallback(
    async (explicitLineId?: number, rawSerial?: string) => {
      const serial = (rawSerial ?? serialInput).trim();
      if (!serial || !poContext || serialSubmitting) return;

      setSerialSubmitting(true);
      setPendingCandidates([]);

      const effectiveLineId = explicitLineId ?? armedLineId;

      try {
        const res = await fetch('/api/receiving/scan-serial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            receiving_id: poContext.receiving_id,
            receiving_line_id: effectiveLineId ?? undefined,
            serial_number: serial,
            staff_id: Number(staffId),
          }),
        });
        const data = await res.json();

        if (data?.needs_line_selection) {
          setPendingCandidates(data.candidate_lines || []);
          return;
        }

        if (!data?.success) return;

        const state: {
          id: number;
          sku: string | null;
          item_name: string | null;
          quantity_received: number;
          quantity_expected: number | null;
          workflow_status?: string | null;
          is_complete: boolean;
        } = data.line_state;

        // Clear input immediately for the next scan
        setSerialInput('');

        dispatchLineUpdated({
          id: state.id,
          quantity_received: state.quantity_received,
          quantity_expected: state.quantity_expected,
          workflow_status: state.workflow_status ?? undefined,
        });

        // Optimistic local update
        setPoContext((prev) => {
          if (!prev) return prev;
          const nextLines = prev.lines.map((l) =>
            l.id === state.id
              ? { ...l, quantity_received: state.quantity_received }
              : l,
          );
          return { ...prev, lines: nextLines };
        });

        // Auto-advance arming when the armed line is complete
        if (state.is_complete && armedLineId === state.id) {
          setPoContext((prev) => {
            if (!prev) return prev;
            const remainingOpen = prev.lines.filter(
              (l) =>
                l.id !== state.id &&
                (l.quantity_expected == null ||
                  l.quantity_received < (l.quantity_expected ?? 0)),
            );
            setArmedLineId(remainingOpen.length === 1 ? remainingOpen[0].id : null);
            return prev;
          });
        }

        // Return detection banner
        if (data.is_return) {
          setReturns((prev) =>
            [
              {
                id: randomId(),
                serial_number: serial,
                line_id: state.id,
                sku: state.sku,
                prior_status: data.prior_status ?? null,
                at: Date.now(),
              },
              ...prev,
            ].slice(0, 3),
          );
        }

        // Print-on-scan (unboxing only, opt-out via toggle)
        if (printOnScan && state.sku) {
          printProductLabel({
            sku: state.sku,
            title: state.item_name ?? undefined,
            serialNumber: serial,
          });
        }

        // Broadcast to main panel
        window.dispatchEvent(
          new CustomEvent('receiving-serial-scanned', {
            detail: {
              line_id: state.id,
              new_qty: state.quantity_received,
              serial_unit: data.serial_unit,
              is_return: !!data.is_return,
              is_complete: !!state.is_complete,
            },
          }),
        );

        if (state.is_complete) {
          window.dispatchEvent(
            new CustomEvent('receiving-line-complete', {
              detail: { line_id: state.id },
            }),
          );
        }

        setTimeout(() => serialInputRef.current?.focus(), 40);
      } catch {
        /* silently fail — user can re-scan */
      } finally {
        setSerialSubmitting(false);
      }
    },
    [serialInput, poContext, armedLineId, serialSubmitting, staffId, printOnScan],
  );

  const clearPoContext = useCallback(() => {
    setPoContext(null);
    setArmedLineId(null);
    setPendingCandidates([]);
    setSerialInput('');
  }, []);

  const updateSourcePlatform = useCallback(async (next: string) => {
    if (!poContext) return;
    const normalized = (next || '').toLowerCase();
    const packageUpdate: ReceivingPackageMeta = {
      received_at: poContext.receiving_package?.received_at ?? null,
      unboxed_at: poContext.receiving_package?.unboxed_at ?? null,
      created_at: poContext.receiving_package?.created_at ?? null,
      return_platform: poContext.receiving_package?.return_platform ?? null,
      source_platform: normalized || null,
      is_return: poContext.receiving_package?.is_return ?? false,
    };
    setPoContext((prev) => (prev ? { ...prev, receiving_package: packageUpdate } : prev));
    const receivingId = poContext.receiving_id;
    try {
      await fetch(`/api/receiving/${receivingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_platform: normalized || null }),
      });
      window.dispatchEvent(new CustomEvent('receiving-package-updated', {
        detail: { receiving_id: receivingId, source_platform: normalized || null },
      }));
    } catch {
      /* silent — realtime invalidation will reconcile */
    }
  }, [poContext]);

  // Mirror platform changes originating from a line inspector back into the
  // top PO card's context so the label + dropdown reflect immediately.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ receiving_id?: number; source_platform?: string | null }>).detail;
      if (!detail) return;
      setPoContext((prev) => {
        if (!prev || prev.receiving_id !== detail.receiving_id) return prev;
        const nextPkg: ReceivingPackageMeta = {
          received_at: prev.receiving_package?.received_at ?? null,
          unboxed_at: prev.receiving_package?.unboxed_at ?? null,
          created_at: prev.receiving_package?.created_at ?? null,
          return_platform: prev.receiving_package?.return_platform ?? null,
          source_platform: (detail.source_platform || '').toLowerCase() || null,
          is_return: prev.receiving_package?.is_return ?? false,
        };
        return { ...prev, receiving_package: nextPkg };
      });
    };
    window.addEventListener('receiving-package-updated', handler);
    return () => window.removeEventListener('receiving-package-updated', handler);
  }, []);

  const dismissReturn = useCallback((id: string) => {
    setReturns((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const updateMode = (nextMode: ReceivingMode) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('mode', nextMode);
    router.replace(`/receiving?${nextParams.toString()}`);
  };

  const updateStaff = (id: number) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('staffId', String(id));
    router.replace(`/receiving?${nextParams.toString()}`);
  };

  // On mobile, the desktop tree (staff selector, scan bar, accordion sections,
  // lines list, etc.) is replaced by a focused "Take Photos for this PO" view.
  // All hooks above still run unconditionally to preserve Rules of Hooks.
  if (isMobile) {
    return <MobileReceivingActionsPane />;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Staff + mode selector */}
      <div className={sidebarHeaderBandClass}>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-gray-200">
          <div className="min-w-0">
            <StaffSelector
              role="all"
              variant="boxy"
              selectedStaffId={parseInt(staffId, 10)}
              onSelect={updateStaff}
            />
          </div>
          <div className="relative min-w-0">
            <ViewDropdown
              options={RECEIVING_MODE_OPTIONS}
              value={mode}
              onChange={(nextMode) => updateMode(nextMode as ReceivingMode)}
              variant="boxy"
              buttonClassName={sidebarHeaderControlClass}
              optionClassName="text-[10px] font-black tracking-wider"
            />
          </div>
        </div>
      </div>

      {mode === 'pickup' ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <LocalPickupIntakeForm variant="sidebar" staffId={staffId} />
        </div>
      ) : (
        <>
      {/* Tracking scan bar */}
      <div className={`${sidebarHeaderBandClass} ${sidebarHeaderRowClass} flex items-center gap-2`}>
        <div className="flex-1 min-w-0">
          <SearchBar
            key={scanBarKey}
            value={bulkTracking}
            onChange={setBulkTracking}
            onSearch={submitTrackingScan}
            onClear={() => setBulkTracking('')}
            placeholder="Scan tracking…"
            variant="blue"
            size="compact"
            isSearching={anyScanChecking}
            leadingIcon={<Barcode className="w-[14px] h-[14px]" />}
            className="w-full"
            autoFocus
          />
        </div>
      </div>

      <ReceivingReturnBanner returns={returns} onDismiss={dismissReturn} />

      {/* Scrollable body — all content below the fixed header scrolls as one
          region so tall LineEditPanels + pending scans don't fight for space. */}
      <div className="min-h-0 flex-1 overflow-auto">

      {/* Scan-line picker: shown when a tracking scan matches multiple open
          lines and the user hasn't picked one yet. Single matches skip this. */}
      {scanDriven && !selectedLine && scanMatchedRows.length > 1 && (
        <div className="border-b border-blue-200 bg-blue-50/60 px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[9px] font-black uppercase tracking-wider text-blue-700">
              Pick a line
            </p>
            <button
              type="button"
              onClick={() => {
                setScanDriven(false);
                setScanMatchedRows([]);
                clearPoContext();
              }}
              aria-label="Cancel scan"
              className="text-blue-400 transition-colors hover:text-blue-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {scanMatchedRows.map((line) => {
              const open = line.quantity_expected == null
                || line.quantity_received < (line.quantity_expected ?? 0);
              return (
                <button
                  key={line.id}
                  type="button"
                  onClick={() => {
                    setLineAccordionBootstrap('default');
                    setSelectedLine(line);
                  }}
                  className={`rounded border px-2 py-1 text-left text-[10px] font-bold transition-colors ${
                    open
                      ? 'border-blue-200 bg-white text-blue-900 hover:bg-blue-100'
                      : 'border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  <span className="truncate">{line.sku || line.item_name || `Line #${line.id}`}</span>
                  {' · '}
                  {line.quantity_received}/{line.quantity_expected ?? '?'}
                  {open ? '' : ' · complete'}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Unified line edit panel — scan-driven renders in compact mode, row
          clicks render in full mode. Either way this is the only display. */}
      {selectedLine && (
        <LineEditPanel
          row={selectedLine}
          staffId={staffId}
          compact={scanDriven}
          accordionBootstrap={lineAccordionBootstrap}
          onPrev={goPrevLine}
          onNext={goNextLine}
          canPrev={canPrev}
          canNext={canNext}
          itemIndex={currentIndex}
          itemTotal={scanMatchedRows.length}
          onClose={() => {
            setSelectedLine(null);
            setLineAccordionBootstrap('default');
            setScanDriven(false);
            setScanMatchedRows([]);
            clearPoContext();
            window.dispatchEvent(new CustomEvent('receiving-clear-line'));
          }}
        />
      )}

      {/* Scan status chips — one per in-flight or terminal scan */}
      {pendingScans.length > 0 && (
        <div className="border-t border-gray-200">
          <div className="flex items-center justify-between px-3 pt-2 pb-1">
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">
              Scans · {pendingScans.length}
            </p>
            <button
              type="button"
              onClick={() => setPendingScans([])}
              className="text-[9px] font-black uppercase tracking-wider text-gray-400 hover:text-gray-700"
            >
              Clear
            </button>
          </div>
          <div className="flex flex-col">
            {pendingScans.map((scan) => (
              <ScanStatusChip
                key={scan.id}
                tracking={scan.tracking}
                status={scan.status}
                errorMessage={scan.errorMessage}
                exceptionId={scan.exception_id ?? null}
                exceptionReason={scan.exception_reason ?? null}
                onRetry={
                  scan.status === 'error'
                    ? () => retryPendingScan(scan.tracking, scan.id)
                    : undefined
                }
                onRefetch={
                  scan.status === 'unmatched' || scan.status === 'matched'
                    ? () => refetchPendingScan(scan.tracking, scan.id)
                    : undefined
                }
                onDismiss={() => dismissPendingScan(scan.id)}
              />
            ))}
          </div>
        </div>
      )}

      </div>{/* /scrollable body */}
        </>
      )}
    </div>
  );
}
