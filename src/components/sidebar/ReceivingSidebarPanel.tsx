'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'react-qr-code';
import {
  sidebarHeaderBandClass,
  sidebarHeaderControlClass,
  sidebarHeaderRowClass,
} from '@/components/layout/header-shell';
import { Barcode, Clipboard, Printer, RefreshCw, X } from '@/components/Icons';
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
import { PhonePairModal } from '@/components/sidebar/PhonePairModal';
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

const RECEIVING_MODE_OPTIONS = [
  { value: 'receive', label: 'Receiving' },
  { value: 'pickup', label: 'Local Pickup' },
];

const WORKFLOW_FILTERS: HorizontalSliderItem[] = [
  { id: '',         label: 'All' },
  { id: 'EXPECTED', label: 'Expected' },
  { id: 'MATCHED',  label: 'Received' },
  { id: 'UNBOXED',  label: 'Unboxed' },
  { id: 'PASSED',   label: 'Passed' },
  { id: 'FAILED',   label: 'Failed' },
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
  { value: 'other',      label: 'Other' },
];

const SOURCE_PLATFORM_LABELS: Record<string, string> = {
  ebay: 'eBay',
  amazon: 'Amazon',
  aliexpress: 'AliExpress',
  walmart: 'Walmart',
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
    return `U-${letter}`;
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
      <span className="inline-flex items-baseline gap-0 font-black tracking-tight text-gray-900">
        <span className="underline decoration-gray-900 decoration-2 underline-offset-2">U</span>
        <span>-{letter}</span>
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
  errorMessage?: string;
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
  const condHtml = condShort === 'New' || condShort === 'Parts'
    ? escapeHtml(condShort)
    : `<u>U</u>-${escapeHtml(condShort.replace(/^U-/, ''))}`;

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
  .cond u{text-decoration:underline;text-underline-offset:1px}
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

  const w = window.open('', '_blank', 'width=320,height=220');
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
  onClose,
}: {
  row: ReceivingLineRow;
  staffId: string;
  onClose: () => void;
}) {
  const [receivingType, setReceivingType] = useState(row.receiving_type || 'PO');
  const [qa, setQa] = useState(row.qa_status);
  const [disp, setDisp] = useState(row.disposition_code);
  const [cond, setCond] = useState(row.condition_grade);
  const [notes, setNotes] = useState(row.notes || '');
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
  const serialRef = useRef<HTMLInputElement>(null);
  const listingRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setReceivingType(row.receiving_type || 'PO');
    setQa(row.qa_status);
    setDisp(row.disposition_code);
    setCond(row.condition_grade);
    setNotes(row.notes || '');
    setTrackingEdit(row.tracking_number || '');
    setZendesk('');
    setListingLink('');
  }, [row.id, row.qa_status, row.disposition_code, row.condition_grade, row.notes, row.tracking_number, row.receiving_type]);

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
      if (data?.success) {
        setSerialInput('');
        window.dispatchEvent(new CustomEvent('receiving-serial-scanned', {
          detail: {
            line_id: row.id,
            new_qty: data.line_state?.quantity_received,
            serial_unit: data.serial_unit,
            is_return: !!data.is_return,
            is_complete: !!data.line_state?.is_complete,
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
    if (receiving) return;
    setReceiving(true);
    try {
      const combinedNotes = [
        notes,
        zendesk ? `Zendesk: ${zendesk}` : '',
        listingLink ? `Listing: ${listingLink}` : '',
      ].filter(Boolean).join(' | ');

      await patch({
        qa_status: qa,
        disposition_code: disp,
        condition_grade: cond,
        notes: combinedNotes || notes,
      });

      if (row.zoho_purchaseorder_id && row.zoho_line_item_id) {
        try {
          await fetch('/api/receiving/mark-received', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              receiving_line_id: row.id,
              receiving_id: row.receiving_id,
              zoho_purchaseorder_id: row.zoho_purchaseorder_id,
              zoho_line_item_id: row.zoho_line_item_id,
              zoho_item_id: row.zoho_item_id,
              qa_status: qa,
              disposition_code: disp,
              condition_grade: cond,
              serial_number: serialInput.trim() || undefined,
              zendesk_ticket: zendesk.trim() || undefined,
              listing_link: listingLink.trim() || undefined,
              notes: combinedNotes || undefined,
              staff_id: Number(staffId),
            }),
          });
        } catch {
          /* Zoho sync failed — local data is saved */
        }
      }

      window.dispatchEvent(new CustomEvent('receiving-entry-added'));
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch { /* silent */ } finally {
      setReceiving(false);
    }
  }, [receiving, row, qa, disp, cond, notes, zendesk, listingLink, serialInput, staffId, patch]);

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

  return (
    <div className="border-b border-gray-200 bg-gray-50">
      {/* Top bar: refresh | close */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <button
          type="button"
          onClick={() => setImgKey((k) => k + 1)}
          aria-label="Reload image"
          className="text-gray-400 transition-colors hover:text-gray-700"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close line edit"
          className="text-gray-400 transition-colors hover:text-gray-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Product image */}
      {imgUrl && (
        <div className="flex justify-center px-3 pb-2">
          <img
            key={imgKey}
            src={imgUrl}
            alt={row.item_name ?? 'Product'}
            className="h-28 w-28 rounded-lg border border-gray-200 bg-white object-contain"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}

      {/* Product title */}
      <p className="px-3 pb-1 text-[12px] font-bold leading-snug text-gray-900 break-words">
        {row.item_name || row.sku || `Line #${row.id}`}
      </p>

      {/* Platform / Type dropdowns */}
      <div className="grid grid-cols-2 gap-2 px-3 pb-2">
        <div>
          <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-gray-500">
            Platform{platformSaving ? '…' : ''}
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

      {/* QA / Disposition / Condition */}
      <div className="grid grid-cols-3 gap-2 px-3 pb-2">
        <div>
          <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-gray-500">QA</p>
          <select value={qa} onChange={(e) => { setQa(e.target.value); patch({ qa_status: e.target.value }); }} className={SELECT_CLASS}>
            {QA_OPTS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
        <div>
          <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-gray-500">Disposition</p>
          <select value={disp} onChange={(e) => { setDisp(e.target.value); patch({ disposition_code: e.target.value }); }} className={SELECT_CLASS}>
            {DISPOSITION_OPTS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
        <div>
          <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-gray-500">Condition</p>
          <select value={cond} onChange={(e) => { setCond(e.target.value); patch({ condition_grade: e.target.value }); }} className={SELECT_CLASS}>
            {CONDITION_OPTS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
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

      {/* Serial scan row */}
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

      {/* Fields */}
      <div className="bg-white px-3 py-3 space-y-2.5">
        {saving && (
          <p className="text-[9px] font-black uppercase tracking-wider text-blue-500">Saving</p>
        )}

        {/* Zendesk ticket with paste */}
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

        {/* Listing link */}
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

        {/* Notes */}
        <div>
          <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-gray-500">Notes</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => { if (notes !== (row.notes || '')) patch({ notes }); }}
            rows={2}
            placeholder="Add notes…"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] leading-relaxed text-gray-900 placeholder:text-gray-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10 resize-none"
          />
        </div>

        {/* Print (left) / Receive (right) */}
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
            disabled={receiving}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {receiving ? 'Receiving' : 'Receive'}
          </button>
        </div>

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
  const [workflowFilter, setWorkflowFilter] = useState('');
  const [pendingScans, setPendingScans] = useState<PendingScan[]>([]);
  const [pairModalOpen, setPairModalOpen] = useState(false);
  const anyScanChecking = pendingScans.some((s) => s.status === 'checking');
  const [imgKey, setImgKey] = useState(0);
  const [selectedLine, setSelectedLine] = useState<ReceivingLineRow | null>(null);

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('receiving.printOnScan', String(printOnScan));
  }, [printOnScan]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('receiving-workflow-filter', { detail: workflowFilter }));
  }, [workflowFilter]);

  useEffect(() => {
    const handler = () => setWorkflowFilter('');
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
    };
    const handleUpdated = (e: Event) => {
      const updated = (e as CustomEvent<ReceivingLineRow>).detail;
      if (!updated) return;
      setSelectedLine((prev) => (prev?.id === updated.id ? updated : prev));
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

  const submitTrackingScan = useCallback((rawTracking?: string, opts?: { onResult?: (result: { tracking: string; matched: boolean; po_ids: string[]; receiving_id?: number; error?: string }) => void }) => {
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
        } else {
          opts?.onResult?.({
            tracking: trackingNumber,
            matched: false,
            po_ids: [],
            receiving_id: typeof data.receiving_id === 'number' ? data.receiving_id : undefined,
          });
          setPendingScans((prev) =>
            prev.map((s) =>
              s.id === scanUiId
                ? {
                    ...s,
                    status: 'unmatched',
                    receiving_id: typeof data.receiving_id === 'number' ? data.receiving_id : undefined,
                    scan_id: typeof data.scan_id === 'number' ? data.scan_id : undefined,
                  }
                : s,
            ),
          );
          window.dispatchEvent(
            new CustomEvent('receiving-entry-added', {
              detail: { id: String(data.receiving_id), tracking: trackingNumber },
            }),
          );
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
  }, [bulkTracking, staffId]);

  const retryPendingScan = useCallback((tracking: string, id: string) => {
    setPendingScans((prev) => prev.filter((s) => s.id !== id));
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
          is_complete: boolean;
        } = data.line_state;

        // Clear input immediately for the next scan
        setSerialInput('');

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
        <button
          type="button"
          onClick={() => setPairModalOpen(true)}
          disabled={Number(staffId) <= 0}
          aria-label="Pair phone"
          title="Pair phone scanner"
          className="shrink-0 inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Barcode className="h-3 w-3" />
          Phone
        </button>
      </div>
      <PhonePairModal
        staffId={Number(staffId) || 0}
        open={pairModalOpen}
        onClose={() => setPairModalOpen(false)}
      />

      {/* Workflow filter */}
      <div className="border-b border-gray-200 px-3 py-2">
        <HorizontalButtonSlider
          items={WORKFLOW_FILTERS}
          value={workflowFilter}
          onChange={setWorkflowFilter}
          variant="slate"
          aria-label="Filter by workflow status"
        />
      </div>

      <ReceivingReturnBanner returns={returns} onDismiss={dismissReturn} />

      {poContext && (
        <>
          {/* PO header card */}
          <div className="border-b border-gray-200 bg-gray-50">
            {/* Top bar: refresh | close */}
            <div className="flex items-center justify-between border-b border-gray-100/90 px-3 py-1.5">
              <button
                type="button"
                onClick={() => setImgKey((k) => k + 1)}
                aria-label="Reload image"
                className="text-gray-400 transition-colors hover:text-gray-700"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={clearPoContext}
                aria-label="Clear PO"
                className="text-gray-400 transition-colors hover:text-gray-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {(() => {
              const headerLine = armedLine ?? poContext.lines[0] ?? null;
              const poScanValue = resolvePoScanValue(headerLine, poContext.po_ids, poContext.receiving_id);
              const platform = platformLabel(poContext.receiving_package, headerLine?.receiving_type);
              const typeLbl = receivingTypeLabel(headerLine?.receiving_type);
              const condCode = headerLine?.condition_grade ?? 'BRAND_NEW';
              const dateStr = formatPackageUnboxDate(poContext.receiving_package);
              return (
                <div className="flex flex-nowrap gap-3 px-3 py-2.5 items-start justify-between">
                  <div className="min-w-0 flex-1 grid grid-cols-2 gap-x-3 gap-y-2 text-[10px] leading-tight">
                    <div className="min-w-0">
                      <select
                        value={(poContext.receiving_package?.source_platform || '').toLowerCase()}
                        onChange={(e) => updateSourcePlatform(e.target.value)}
                        title={`Platform override (currently displayed: ${platform})`}
                        className="w-full rounded border border-gray-200 bg-white px-1.5 py-1 text-[10px] font-bold text-gray-700 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
                      >
                        {SOURCE_PLATFORM_OPTS.map((opt) => (
                          <option key={opt.value || 'auto'} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="text-right font-black uppercase tracking-wide text-gray-900">
                      {typeLbl}
                    </div>
                    <div className="min-w-0 self-end">
                      <ConditionHeaderDisplay code={condCode} />
                    </div>
                    <div className="text-right tabular-nums font-semibold text-gray-600 self-end">
                      {dateStr}
                    </div>
                  </div>
                  {poScanValue ? (
                    <div
                      className="shrink-0 ml-auto flex items-center"
                      role="img"
                      aria-label={`Purchase order QR, ${poScanValue}`}
                    >
                      <div className="rounded-lg border border-gray-200 bg-white p-1.5 shadow-sm">
                        <QRCode
                          value={poScanValue}
                          size={92}
                          level="M"
                          fgColor="#111827"
                          bgColor="#ffffff"
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })()}

            {/* Product image */}
            {(() => {
              const imgUrl = (armedLine?.image_url || poContext.lines[0]?.image_url) ?? null;
              return imgUrl ? (
                <div className="flex justify-center px-3 pb-2">
                  <img
                    key={imgKey}
                    src={imgUrl}
                    alt={(armedLine?.item_name || poContext.lines[0]?.item_name) ?? 'Product'}
                    className="h-28 w-28 rounded-lg border border-gray-200 bg-white object-contain"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              ) : null;
            })()}

            {/* Product title */}
            <p className="px-3 pb-2 text-[12px] font-bold leading-snug text-gray-900 break-words">
              {(armedLine?.item_name || poContext.lines[0]?.item_name) ?? 'Unnamed product'}
            </p>
          </div>

          {/* Serial scan row */}
          <div className={`${sidebarHeaderBandClass} ${sidebarHeaderRowClass}`}>
            <SearchBar
              value={serialInput}
              onChange={setSerialInput}
              onSearch={(value) => submitSerialScan(undefined, value)}
              onClear={() => setSerialInput('')}
              inputRef={serialInputRef}
              placeholder={
                armedLine
                  ? `Serial for ${armedLine.sku || '—'}…`
                  : 'Scan serial (auto-pick)…'
              }
              variant="blue"
              size="compact"
              isSearching={serialSubmitting}
              leadingIcon={<Barcode className="w-[14px] h-[14px]" />}
              className="w-full"
            />
          </div>

          {/* Armed line chip + print button + print-on-scan toggle */}
          <div className="flex items-center justify-between gap-2 border-b border-gray-100 bg-white px-3 py-1.5">
            {armedLine ? (
              <span className="rounded bg-blue-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-blue-700">
                Armed: {armedLine.sku || '—'}
              </span>
            ) : (
              <span className="text-[9px] font-black uppercase tracking-wider text-gray-400">
                Auto-pick
              </span>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const line = armedLine ?? poContext.lines[0] ?? null;
                  if (!line?.sku) return;
                  printProductLabel({
                    sku: line.sku,
                    title: line.item_name ?? undefined,
                    serialNumber: serialInput.trim() || undefined,
                  });
                }}
                disabled={!(armedLine?.sku || poContext.lines[0]?.sku)}
                className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1 text-[9px] font-black uppercase tracking-wider text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                title="Print label now"
              >
                <Printer className="h-3 w-3" />
                Print
              </button>
              <label className="flex cursor-pointer items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-gray-500">
                <input
                  type="checkbox"
                  checked={printOnScan}
                  onChange={(e) => setPrintOnScan(e.target.checked)}
                  className="h-3 w-3"
                />
                Print on scan
              </label>
            </div>
          </div>

          {/* Line selection picker when backend reports ambiguity */}
          {pendingCandidates.length > 0 && (
            <div className="border-b border-amber-200 bg-amber-50 px-3 py-2">
              <p className="mb-1 text-[9px] font-black uppercase tracking-wider text-amber-700">
                Pick a line for this serial
              </p>
              <div className="flex flex-col gap-1">
                {pendingCandidates.map((line) => (
                  <button
                    key={line.id}
                    type="button"
                    onClick={() => submitSerialScan(line.id)}
                    className="rounded border border-amber-200 bg-white px-2 py-1 text-left text-[10px] font-bold text-amber-900 hover:bg-amber-100"
                  >
                    {line.sku || '—'}
                    {' · '}
                    {line.quantity_received}/{line.quantity_expected ?? '?'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Line edit panel — QA / Disposition / Condition / Notes */}
      {selectedLine && (
        <LineEditPanel
          row={selectedLine}
          staffId={staffId}
          onClose={() => {
            setSelectedLine(null);
            window.dispatchEvent(new CustomEvent('receiving-clear-line'));
          }}
        />
      )}

      {/* Scan status chips — one per in-flight or terminal scan */}
      {pendingScans.length > 0 && (
        <div className="min-h-0 flex-1 overflow-auto border-t border-gray-200">
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
                onRetry={
                  scan.status === 'error'
                    ? () => retryPendingScan(scan.tracking, scan.id)
                    : undefined
                }
                onDismiss={() => dismissPendingScan(scan.id)}
              />
            ))}
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
