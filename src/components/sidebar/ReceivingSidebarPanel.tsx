'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'react-qr-code';
import {
  sidebarHeaderBandClass,
  sidebarHeaderControlClass,
  sidebarHeaderRowClass,
} from '@/components/layout/header-shell';
import { Barcode, ChevronDown, ChevronUp, Clipboard, Printer, RefreshCw, X } from '@/components/Icons';
import { TrackingChip, getLast4 } from '@/components/ui/CopyChip';
import { SearchBar } from '@/components/ui/SearchBar';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
import StaffSelector from '@/components/StaffSelector';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import {
  ReceivingReturnBanner,
  type ReturnEvent,
} from '@/components/sidebar/ReceivingReturnBanner';
import { ScanStatusChip } from '@/components/sidebar/ScanStatusChip';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { useAblyClient } from '@/contexts/AblyContext';
import { printProductLabel } from '@/lib/print/printProductLabel';
import { loadBarcodeLibrary, renderBarcode } from '@/utils/barcode';
import { LocalPickupIntakeForm } from '@/components/work-orders/LocalPickupIntakeForm';
import {
  QA_OPTS,
  DISPOSITION_OPTS,
  CONDITION_OPTS,
  COND_LABEL,
} from '@/components/station/receiving-constants';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import { dispatchLineUpdated } from '@/components/station/ReceivingLinesTable';
import {
  parseSerialFromLineDescription,
  parseZendeskListingFromPoNotes,
} from '@/lib/zoho-po-prefill';

/** Carton-level scratch (Zendesk, listing, notes) for Receive; survives line-to-line nav. */
const RECEIVING_LINE_DETAILS_STORAGE_KEY = (receivingId: number) =>
  `receiving.sidebar.lineDetails.v1:${receivingId}`;

type ReceivingLineDetailScratch = { zendesk: string; listing: string; notes: string };

function readReceivingLineDetailsScratch(receivingId: number | null): ReceivingLineDetailScratch {
  if (receivingId == null || typeof window === 'undefined') {
    return { zendesk: '', listing: '', notes: '' };
  }
  try {
    const raw = window.localStorage.getItem(RECEIVING_LINE_DETAILS_STORAGE_KEY(receivingId));
    if (!raw) return { zendesk: '', listing: '', notes: '' };
    const o = JSON.parse(raw) as Partial<ReceivingLineDetailScratch>;
    return {
      zendesk: typeof o.zendesk === 'string' ? o.zendesk : '',
      listing: typeof o.listing === 'string' ? o.listing : '',
      notes: typeof o.notes === 'string' ? o.notes : '',
    };
  } catch {
    return { zendesk: '', listing: '', notes: '' };
  }
}

function writeReceivingLineDetailsScratch(receivingId: number, d: ReceivingLineDetailScratch) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      RECEIVING_LINE_DETAILS_STORAGE_KEY(receivingId),
      JSON.stringify({ zendesk: d.zendesk, listing: d.listing, notes: d.notes }),
    );
  } catch {
    /* quota / private mode */
  }
}

const RECEIVING_MODE_OPTIONS = [
  { value: 'receive', label: 'Receiving' },
  { value: 'pickup', label: 'Local Pickup' },
];

// Two-tab surface covering the full receiver workflow:
//   Recent   = in-flight lines (pre-match through in-test), sorted by most
//              recent scan pairing event so new scans bubble up.
//   Received = physically received in the warehouse (MATCHED → DONE),
//              sorted by updated_at so recent receives bubble up.
const VIEW_FILTERS: HorizontalSliderItem[] = [
  { id: 'all',      label: 'All' },
  { id: 'recent',   label: 'Recent' },
  { id: 'received', label: 'Received' },
];

type ViewId = 'all' | 'recent' | 'received';
const VALID_VIEW_IDS = new Set<ViewId>(['all', 'recent', 'received']);

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
    condition_grade: l.condition_grade ?? 'BRAND_NEW',
  };
}

function receivingTypeLabel(value: string | null | undefined): string {
  const v = String(value || 'PO').trim().toUpperCase() || 'PO';
  return RECEIVING_TYPE_OPTS.find((o) => o.value === v)?.label ?? v.replace(/_/g, ' ');
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
  'w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] font-bold text-gray-900 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10';
const INPUT_CLASS =
  'w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-gray-900 placeholder:text-gray-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10';

type ReceivingLabelPayload = {
  scanValue: string;        // PO#, PO id, or RCV-{receiving_id} fallback
  platform: string;         // "Zoho" | "Return" | "Local pickup" | "eBay" ...
  typeLabel: string;        // "PO" | "Return" | "Trade In" | "Pick Up"
  conditionCode: string;    // raw condition grade enum: BRAND_NEW | USED_A | …
  date: string;             // short date "4/14/26"
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generate a 2×1" label with info on the left and a pre-rendered QR SVG on
 * the right. The QR is materialized in the parent window via react-qr-code
 * + renderToStaticMarkup so the popup contains no external scripts — that
 * removes the CDN race that sometimes left the print dialog hanging.
 */
function printReceivingLabel(payload: ReceivingLabelPayload) {
  if (typeof window === 'undefined') return;
  const scanValue = payload.scanValue.trim();
  if (!scanValue) return;

  // Pre-render the QR as an SVG string in the parent so the popup does not
  // need to fetch a qrcode library from a CDN.
  const qrSvg = renderToStaticMarkup(
    <QRCode
      value={scanValue}
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
  .type{font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:0.3px;color:#111;white-space:nowrap;text-align:center}
  .cond{font-size:13px;font-weight:900;color:#111;white-space:nowrap}
  .po{font-size:12px;font-weight:900;letter-spacing:0.3px;line-height:1.05;color:#111;white-space:nowrap;font-variant-numeric:tabular-nums}
  .date{font-size:11px;font-weight:700;color:#4b5563;white-space:nowrap;tabular-nums:true;font-variant-numeric:tabular-nums}
  .qr{flex:0 0 auto;width:0.86in;height:0.86in;display:flex;align-items:center;justify-content:center}
  .qr svg{width:100%;height:100%;display:block}
</style></head><body>
<div class="wrap">
  <div class="info">
    <div class="row">
      <span class="platform">${escapeHtml(payload.platform)}</span>
      <span class="date">${escapeHtml(payload.date)}</span>
    </div>
    <div class="type">${escapeHtml(payload.typeLabel)}</div>
    <div class="row">
      <span class="cond">${condHtml}</span>
      <span class="po">${escapeHtml(getLast4(scanValue))}</span>
    </div>
  </div>
  <div class="qr">${qrSvg}</div>
</div>
<script>
window.onload=function(){
  // Defer just long enough for layout to settle, then trigger the native
  // print dialog. window.close() runs after print resolves / cancels.
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

/** On-screen preview matching {@link printReceivingLabel} (2×1in layout). */
function ReceivingPoLabelPreview({
  scanValue,
  platform,
  typeLabel,
  conditionCode,
  date,
}: ReceivingLabelPayload) {
  const safe = scanValue.trim();
  if (!safe) return null;
  return (
    <div className="border-t border-gray-200 bg-gray-50">
      <div className="flex items-center gap-3 px-3 pt-3 pb-2">
        <span className="text-[9px] font-black tabular-nums text-gray-500 tracking-widest">03</span>
        <span className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-600">
          Review &amp; print
        </span>
      </div>
      <div className="px-3 pb-3">
        <div className="w-full rounded border border-gray-200 bg-white px-2 py-2 shadow-sm">
          <div className="flex flex-nowrap items-stretch gap-3 min-h-[5rem]">
            <div className="min-w-0 flex-1 flex flex-col justify-between py-0.5">
              <div className="flex items-baseline justify-between gap-2 text-[12px] leading-none">
                <span className="truncate font-bold text-gray-700">{platform}</span>
                <span className="shrink-0 tabular-nums font-semibold text-gray-600">
                  {date}
                </span>
              </div>
              <div className="text-center text-[13px] font-black uppercase tracking-wide text-gray-900 leading-none">
                {typeLabel}
              </div>
              <div className="flex items-baseline justify-between gap-2 text-[13px] leading-none">
                <ConditionHeaderDisplay code={conditionCode} />
                <span className="shrink-0 tabular-nums font-black text-gray-900">
                  {getLast4(safe)}
                </span>
              </div>
            </div>
            <div className="shrink-0 flex items-center">
              <QRCode value={safe} size={80} level="M" fgColor="#000000" bgColor="#ffffff" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** On-screen preview matching {@link printProductLabel} (SKU + Code128). */
function ReceivingProductLabelPreview({
  sku,
  title,
  serialNumber,
}: {
  sku: string;
  title: string;
  serialNumber: string;
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

  return (
    <div className="border-t border-gray-200 bg-gray-50">
      <div className="flex items-center gap-3 px-3 pt-3 pb-2">
        <span className="text-[9px] font-black tabular-nums text-gray-500 tracking-widest">03</span>
        <span className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-600">
          Review & print
        </span>
      </div>
      <div className="px-3 pb-3">
        <div className="flex flex-nowrap items-start justify-between gap-3 border border-gray-200 bg-white px-3 py-3">
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
      </div>
    </div>
  );
}

function LineEditPanel({
  row,
  staffId,
  compact = false,
  onClose,
  onPrev,
  onNext,
  canPrev = false,
  canNext = false,
  progressReceived,
  progressTotal,
}: {
  row: ReceivingLineRow;
  staffId: string;
  compact?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  canPrev?: boolean;
  canNext?: boolean;
  progressReceived?: number;
  progressTotal?: number;
  onClose: () => void;
}) {
  const [receivingType, setReceivingType] = useState(row.receiving_type || 'PO');
  // Pre-receipt placeholders (PENDING/HOLD) get promoted to the common
  // happy-path defaults (PASSED/ACCEPT/USED_A). If a line was previously
  // saved with a more specific status (e.g. FAILED_DAMAGED, RTV,
  // BRAND_NEW), we preserve that — the override only replaces the
  // pre-receipt placeholders.
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
  const [imgKey, setImgKey] = useState(0);
  const [sourcePlatform, setSourcePlatform] = useState<string>('');
  const [platformSaving, setPlatformSaving] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(!compact);
  const [zohoSyncing, setZohoSyncing] = useState(false);
  const serialRef = useRef<HTMLInputElement>(null);
  const listingRef = useRef<HTMLInputElement>(null);

  const persistZendeskRef = useRef(zendesk);
  const persistListingRef = useRef(listingLink);
  const persistNotesRef = useRef(notes);
  persistZendeskRef.current = zendesk;
  persistListingRef.current = listingLink;
  persistNotesRef.current = notes;

  useEffect(() => {
    setReceivingType(row.receiving_type || 'PO');
    // Mirror the initial-state promotion logic on row change so a freshly
    // loaded PO line shows the happy-path defaults (PASSED / ACCEPT / USED_A)
    // instead of the raw placeholders (PENDING / HOLD) written when the line
    // was first created. Non-placeholder values (e.g. FAILED_DAMAGED, RTV,
    // BRAND_NEW) are preserved as-is.
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
      return;
    }
    const d = readReceivingLineDetailsScratch(row.receiving_id);
    setZendesk(d.zendesk);
    setListingLink(d.listing);
    setNotes(d.notes);
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

    writeReceivingLineDetailsScratch(cur, { zendesk, listing: listingLink, notes });
  }, [zendesk, listingLink, notes, row.receiving_id]);

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
      }
    } catch { /* silent */ } finally {
      setSerialSubmitting(false);
    }
  }, [serialInput, row.receiving_id, row.id, staffId, serialSubmitting]);

  const pasteToListing = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setListingLink(text.trim());
    } catch { /* clipboard not available */ }
  }, []);

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

      window.dispatchEvent(new CustomEvent('receiving-entry-added'));
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch { /* silent */ } finally {
      setReceiving(false);
    }
  }, [receiving, row.receiving_id, qa, disp, cond, notes, zendesk, listingLink, serialInput, staffId]);

  const poNumber = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
  const scanValue = poNumber || (row.receiving_id != null ? `RCV-${row.receiving_id}` : '');
  const labelPlatform = sourcePlatform
    ? (SOURCE_PLATFORM_LABELS[sourcePlatform] ?? sourcePlatform)
    : String(receivingType || 'PO').toUpperCase() === 'PICKUP' ? 'Local pickup' : 'Zoho';
  const labelType = receivingTypeLabel(receivingType);
  const labelDate = new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
  const labelPayload: ReceivingLabelPayload = {
    scanValue,
    platform: labelPlatform,
    typeLabel: labelType,
    conditionCode: cond,
    date: labelDate,
  };
  const imgUrl = row.image_url ?? null;

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
    if (!tracking) {
      setImgKey((k) => k + 1); // nothing to sync — at least refresh the image
      return;
    }
    setZohoSyncing(true);
    try {
      const findRes = await fetch('/api/zoho/find-po', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingNumber: tracking }),
      });
      const findData = await findRes.json();
      const po = findData?.success && findData.matched ? findData.purchase_order : null;

      // 2. Reconcile the line's PO#/number only if Zoho disagrees. Zoho wins.
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

      // 3. Reconcile the carton.
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
        // No carton yet — let lookup-po create/link one from the tracking#.
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
      setImgKey((k) => k + 1);
    } catch {
      /* silent — user can retry */
    } finally {
      setZohoSyncing(false);
    }
  }, [zohoSyncing, row.id, row.receiving_id, row.tracking_number,
      row.zoho_purchaseorder_id, row.zoho_purchaseorder_number, staffId]);

  const hasProgress = typeof progressReceived === 'number' && typeof progressTotal === 'number' && progressTotal > 0;

  return (
    <div className="border-b border-gray-200 bg-gray-50">
      {/* Top bar: refresh · up/down · status · close */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={syncWithZoho}
            disabled={zohoSyncing}
            aria-label="Sync with Zoho by tracking number"
            title="Sync with Zoho by tracking number"
            className="text-gray-400 transition-colors hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onPrev}
            disabled={!onPrev || !canPrev}
            aria-label="Previous line in PO"
            title="Previous line"
            className="text-gray-400 transition-colors hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!onNext || !canNext}
            aria-label="Next line in PO"
            title="Next line"
            className="text-gray-400 transition-colors hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
        {/* Status chip — shows saving / syncing state in the center. */}
        <div
          aria-live="polite"
          className="flex min-w-0 flex-1 items-center justify-center text-[9px] font-black uppercase tracking-[0.18em]"
        >
          {zohoSyncing ? (
            <span className="inline-flex items-center gap-1 text-blue-600">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Syncing
            </span>
          ) : saving || platformSaving ? (
            <span className="inline-flex items-center gap-1 text-blue-600">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Saving
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {hasProgress && (
            <span className="text-[10px] font-black tracking-wider text-gray-600">
              {progressReceived}/{progressTotal}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close line edit"
            className="text-gray-400 transition-colors hover:text-gray-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Product image */}
      {imgUrl && (
        <div className={`flex justify-center px-3 ${compact ? 'pb-1.5' : 'pb-2'}`}>
          <img
            key={imgKey}
            src={imgUrl}
            alt={row.item_name ?? 'Product'}
            className={`rounded-lg border border-gray-200 bg-white object-contain ${compact ? 'h-20 w-20' : 'h-28 w-28'}`}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}

      {/* Product title */}
      <p className={`px-3 pb-1 font-bold leading-snug text-gray-900 break-words ${compact ? 'text-[11px] line-clamp-2' : 'text-[12px]'}`}>
        {row.item_name || row.sku || `Line #${row.id}`}
      </p>

      {/* Item condition — per receiving line; drives the same condition_grade shown in the table */}
      <div className="px-3 pb-2 pt-0.5">
        <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-gray-500">
          Item condition
        </p>
        <select
          value={cond}
          onChange={(e) => {
            const v = e.target.value;
            setCond(v);
            void patch({ condition_grade: v });
          }}
          className={SELECT_CLASS}
          aria-label="Condition grade for this line item"
        >
          {CONDITION_OPTS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Serial scan — scoped to this line only. (PO-wide serial input
          lives in the sidebar shell when a PO is loaded.) */}
      <div className={`${sidebarHeaderBandClass} ${sidebarHeaderRowClass}`}>
        <SearchBar
          value={serialInput}
          onChange={setSerialInput}
          onSearch={(v) => submitSerial(v)}
          onClear={() => setSerialInput('')}
          inputRef={serialRef}
          placeholder={`Scan serial for ${row.sku || '—'}`}
          variant="blue"
          size="compact"
          isSearching={serialSubmitting}
          leadingIcon={<Barcode className="w-[14px] h-[14px]" />}
          className="w-full"
        />
      </div>

      {/* Platform / Type dropdowns */}
      <div className="grid grid-cols-2 gap-2 px-3 pt-3 pb-2">
        <div>
          <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-gray-500">
            Platform
          </p>
          <select
            value={sourcePlatform}
            onChange={(e) => {
              const next = e.target.value;
              setSourcePlatform(next);
              void savePlatform(next);
            }}
            disabled={row.receiving_id == null}
            className={SELECT_CLASS}
          >
            {SOURCE_PLATFORM_OPTS.map((opt) => (
              <option key={opt.value || 'auto'} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-gray-500">
            Type
          </p>
          <select
            value={receivingType}
            onChange={(e) => { setReceivingType(e.target.value); patch({ receiving_type: e.target.value }); }}
            className={SELECT_CLASS}
          >
            {RECEIVING_TYPE_OPTS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* QA / Disposition (condition is above serial — item-scoped) */}
      <div className="grid grid-cols-2 gap-2 px-3 pb-2">
        <div>
          <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-gray-500">QA</p>
          <select value={qa} onChange={(e) => { setQa(e.target.value); void patch({ qa_status: e.target.value }); }} className={SELECT_CLASS}>
            {QA_OPTS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
        <div>
          <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-gray-500">Disposition</p>
          <select value={disp} onChange={(e) => { setDisp(e.target.value); void patch({ disposition_code: e.target.value }); }} className={SELECT_CLASS}>
            {DISPOSITION_OPTS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
      </div>

      {/* Tracking scan row */}
      <div className={`${sidebarHeaderBandClass} ${sidebarHeaderRowClass}`}>
        <SearchBar
          value={trackingEdit}
          onChange={setTrackingEdit}
          onSearch={(v) => {
            const trimmed = v.trim();
            if (trimmed !== (row.tracking_number || '').trim()) {
              patch({ zoho_reference_number: trimmed || null });
            }
          }}
          onClear={() => setTrackingEdit('')}
          placeholder="Scan tracking"
          variant="blue"
          size="compact"
          leadingIcon={<Barcode className="w-[14px] h-[14px]" />}
          className="w-full"
        />
      </div>

      {/* Fields */}
      <div className={`bg-white px-3 ${compact ? 'py-2 space-y-2' : 'py-3 space-y-2.5'}`}>
        {/* Saving indicator moved to the top-bar status chip. */}

        {/* Details disclosure (Zendesk / Listing / Notes) — collapsed by default in compact mode */}
        {compact ? (
          <button
            type="button"
            onClick={() => setDetailsOpen((o) => !o)}
            className="flex w-full items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-[9px] font-black uppercase tracking-widest text-gray-600 transition-colors hover:bg-gray-100"
            aria-expanded={detailsOpen}
          >
            <span>Details · Zendesk · Listing · Notes</span>
            <span className="text-gray-400">{detailsOpen ? '−' : '+'}</span>
          </button>
        ) : null}

        {(detailsOpen || !compact) && (
          <>
            <div>
              <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-gray-500">Zendesk Ticket</p>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={zendesk}
                  onChange={(e) => setZendesk(e.target.value)}
                  placeholder="Ticket # or URL"
                  className={`${INPUT_CLASS} flex-1 min-w-0`}
                />
                <button
                  type="button"
                  onClick={async () => { try { const t = await navigator.clipboard.readText(); if (t) setZendesk(t.trim()); } catch {} }}
                  title="Paste from clipboard"
                  className="shrink-0 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
                >
                  <Clipboard className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div>
              <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-gray-500">Listing Link</p>
              <div className="flex gap-1">
                <input
                  ref={listingRef}
                  type="text"
                  value={listingLink}
                  onChange={(e) => setListingLink(e.target.value)}
                  placeholder="Paste listing URL"
                  className={`${INPUT_CLASS} flex-1 min-w-0`}
                />
                <button
                  type="button"
                  onClick={pasteToListing}
                  title="Paste from clipboard"
                  className="shrink-0 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
                >
                  <Clipboard className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div>
              <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-gray-500">Notes</p>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => { if (notes !== (row.notes || '')) patch({ notes }); }}
                rows={compact ? 2 : 2}
                placeholder="Add notes…"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] leading-relaxed text-gray-900 placeholder:text-gray-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10 resize-none"
              />
            </div>
          </>
        )}

        {/* Print (left) / Receive (right) + Print-on-scan (when provided) */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              if (scanValue) printReceivingLabel(labelPayload);
              else if (row.sku) printProductLabel({ sku: row.sku, title: row.item_name ?? undefined, serialNumber: serialInput.trim() || undefined });
            }}
            disabled={!scanValue && !row.sku}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wider text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Printer className="h-3.5 w-3.5" />
            Print
          </button>
          <button
            type="button"
            onClick={handleReceive}
            disabled={receiving || row.receiving_id == null}
            title={
              row.receiving_id == null
                ? 'Line must be linked to a shipment'
                : 'Mark every open line on this shipment received and sync to Zoho'
            }
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {receiving ? 'Receiving…' : 'Receive PO'}
          </button>
        </div>

        {/* Label preview is always rendered — no toggle. */}
        {(scanValue || row.sku) && (
          <div className="-mx-3">
            {scanValue ? (
              <ReceivingPoLabelPreview {...labelPayload} />
            ) : row.sku ? (
              <ReceivingProductLabelPreview
                sku={row.sku}
                title={row.item_name ?? ''}
                serialNumber={serialInput.trim()}
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export function ReceivingSidebarPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawMode = searchParams.get('mode');
  const mode: ReceivingMode = rawMode === 'pickup' ? 'pickup' : 'receive';
  const staffId = searchParams.get('staffId') || '7';


  useEffect(() => {
    if (mode === 'pickup') {
      window.dispatchEvent(new CustomEvent('receiving-clear-line'));
    }
  }, [mode]);

  const [bulkTracking, setBulkTracking] = useState('');
  const [scanBarKey, setScanBarKey] = useState(0);
  // Recent/Received lead; status filters follow. Table consumes the id verbatim.
  const [viewMode, setViewMode] = useState<ViewId>('recent');
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
      setSelectedLine(target);
      window.dispatchEvent(new CustomEvent('receiving-highlight-line', { detail: target.id }));
    }
  }, [currentIndex, scanMatchedRows]);

  const goNextLine = useCallback(() => {
    if (currentIndex < 0 || currentIndex >= scanMatchedRows.length - 1) return;
    const target = scanMatchedRows[currentIndex + 1];
    if (target) {
      setSelectedLine(target);
      window.dispatchEvent(new CustomEvent('receiving-highlight-line', { detail: target.id }));
    }
  }, [currentIndex, scanMatchedRows]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('receiving.printOnScan', String(printOnScan));
  }, [printOnScan]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('receiving-workflow-filter', { detail: viewMode }));
  }, [viewMode]);

  useEffect(() => {
    const handler = () => setViewMode('recent');
    window.addEventListener('receiving-workflow-filter-reset', handler);
    return () => window.removeEventListener('receiving-workflow-filter-reset', handler);
  }, []);

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
      const row = (e as CustomEvent<ReceivingLineRow | null>).detail;
      setSelectedLine(row ?? null);
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
              const openRows = rows.filter(
                (r) => r.quantity_expected == null || r.quantity_received < (r.quantity_expected ?? 0),
              );
              const pick = openRows.length === 1 ? openRows[0] : openRows.length === 0 && rows.length === 1 ? rows[0] : null;
              if (pick) {
                setSelectedLine(pick);
                setScanDriven(true);
              } else {
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
  const phoneChannelName = `phone:${Number(staffId) || 0}`;
  const stationChannelName = `station:${Number(staffId) || 0}`;
  const { getClient: getAblyClient } = useAblyClient();

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

      {/* View filter — Recent & Received lead, then per-status chips */}
      <div className="border-b border-gray-200 px-3 py-2">
        <HorizontalButtonSlider
          items={VIEW_FILTERS}
          value={viewMode}
          onChange={(next) => {
            const id = next as ViewId;
            setViewMode(VALID_VIEW_IDS.has(id) ? id : 'recent');
          }}
          variant="slate"
          aria-label="Filter by view"
        />
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
                  onClick={() => setSelectedLine(line)}
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
          onPrev={goPrevLine}
          onNext={goNextLine}
          canPrev={canPrev}
          canNext={canNext}
          progressReceived={progressReceived}
          progressTotal={progressTotal}
          onClose={() => {
            setSelectedLine(null);
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
