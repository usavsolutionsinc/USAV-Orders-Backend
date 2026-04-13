'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  sidebarHeaderBandClass,
  sidebarHeaderControlClass,
  sidebarHeaderRowClass,
} from '@/components/layout/header-shell';
import { Barcode, Clipboard, Printer, RefreshCw, X } from '@/components/Icons';
import { OrderIdChip, TrackingChip, getLast4 } from '@/components/ui/CopyChip';
import { SearchBar } from '@/components/ui/SearchBar';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
import StaffSelector from '@/components/StaffSelector';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import {
  ReceivingReturnBanner,
  type ReturnEvent,
} from '@/components/sidebar/ReceivingReturnBanner';
import { printProductLabel } from '@/lib/print/printProductLabel';
import { LocalPickupIntakeForm } from '@/components/work-orders/LocalPickupIntakeForm';
import {
  QA_OPTS,
  DISPOSITION_OPTS,
  CONDITION_OPTS,
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
};

type PoContext = {
  receiving_id: number;
  po_ids: string[];
  lines: PoLineSummary[];
};

type UnmatchedEntry = {
  id: string;
  tracking: string;
  at: number;
};

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const RECEIVING_TYPE_OPTS = [
  { value: 'PO', label: 'PO' },
  { value: 'RETURN', label: 'Return' },
  { value: 'TRADE_IN', label: 'Trade In' },
  { value: 'PICKUP', label: 'Pick Up' },
];

const SELECT_CLASS =
  'w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] font-bold text-gray-900 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10';
const INPUT_CLASS =
  'w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-gray-900 placeholder:text-gray-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10';

function printReceivingLabel(poNumber: string, receivingType: string) {
  if (typeof window === 'undefined') return;
  const last4 = poNumber.length > 4 ? poNumber.slice(-4) : poNumber;
  const barcodeValue = JSON.stringify(poNumber);
  const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
  const typeLabel = (receivingType || 'PO').replace(/_/g, ' ');
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Label</title>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
<style>
  @page{size:2in 1in;margin:0}
  body{font-family:Arial,sans-serif;padding:0;margin:0;width:2in;height:1in;display:flex;flex-direction:column;justify-content:center}
  canvas{display:block;margin:0 auto}
  .row{display:flex;justify-content:space-between;align-items:center;padding:0 6px;margin-top:2px}
  .date{font-size:9px;font-weight:bold;color:#333}
  .type{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:1px}
  .po{font-size:14px;font-weight:900;letter-spacing:2px}
</style></head><body>
<canvas id="b"></canvas>
<div class="row">
  <span class="date">${today}</span>
  <span class="type">${typeLabel}</span>
  <span class="po">${last4}</span>
</div>
<script>window.onload=function(){JsBarcode("#b",${barcodeValue},{format:"CODE128",lineColor:"#000",width:2,height:32,displayValue:false});setTimeout(function(){window.print();window.close()},500)}<\/script>
</body></html>`;
  const w = window.open('', '', 'width=250,height=150');
  if (!w) return;
  w.document.write(html);
  w.document.close();
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

      {/* Type dropdown */}
      <div className="px-3 pb-2">
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
              if (poNumber) printReceivingLabel(poNumber, receivingType);
              else if (row.sku) printProductLabel({ sku: row.sku, title: row.item_name ?? undefined, serialNumber: serialInput.trim() || undefined });
            }}
            disabled={!poNumber && !row.sku}
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
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [workflowFilter, setWorkflowFilter] = useState('');
  const [unmatchedEntries, setUnmatchedEntries] = useState<UnmatchedEntry[]>([]);
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
        const lines: PoLineSummary[] = (data.receiving_lines || []).map((l: {
          id: number;
          sku: string | null;
          item_name: string | null;
          image_url: string | null;
          quantity_expected: number | null;
          quantity_received: number;
        }) => ({
          id: l.id,
          sku: l.sku,
          item_name: l.item_name,
          image_url: l.image_url ?? null,
          quantity_expected: l.quantity_expected,
          quantity_received: l.quantity_received,
        }));
        setPoContext({ receiving_id: id, po_ids: [], lines });
        setArmedLineId(null);
      } catch {
        /* ignore — sidebar stays empty */
      }
    };
    window.addEventListener('receiving-active', handleActive);
    return () => window.removeEventListener('receiving-active', handleActive);
  }, [poContext?.receiving_id]);

  const submitTrackingScan = useCallback(async (rawTracking?: string) => {
    const trackingNumber = (rawTracking ?? bulkTracking).trim();
    if (!trackingNumber || bulkSubmitting) return;

    setBulkTracking('');
    setBulkSubmitting(true);
    setPoContext(null);
    setArmedLineId(null);
    setPendingCandidates([]);

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

      if (data?.success && data.lines?.length > 0) {
        const ctx: PoContext = {
          receiving_id: Number(data.receiving_id),
          po_ids: Array.isArray(data.po_ids) ? data.po_ids : [],
          lines: (data.lines || []).map((l: {
            id: number;
            sku: string | null;
            item_name: string | null;
            image_url: string | null;
            quantity_expected: number | null;
            quantity_received: number;
          }) => ({
            id: l.id,
            sku: l.sku,
            item_name: l.item_name,
            image_url: l.image_url ?? null,
            quantity_expected: l.quantity_expected,
            quantity_received: l.quantity_received,
          })),
        };
        setPoContext(ctx);

        const openLines = ctx.lines.filter(
          (l) =>
            l.quantity_expected == null ||
            l.quantity_received < (l.quantity_expected ?? 0),
        );
        if (openLines.length === 1) {
          setArmedLineId(openLines[0].id);
        }

        window.dispatchEvent(
          new CustomEvent('receiving-po-loaded', {
            detail: { receiving_id: ctx.receiving_id, lines: ctx.lines },
          }),
        );

        setTimeout(() => serialInputRef.current?.focus(), 60);
      } else {
        const entryRes = await fetch('/api/receiving-entry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trackingNumber,
            qaStatus: 'PENDING',
            dispositionCode: 'HOLD',
            conditionGrade: 'USED_A',
            isReturn: false,
            needsTest: true,
            skipZohoMatch: true,
          }),
        });
        if (entryRes.ok) {
          const entryData = await entryRes.json();
          if (entryData?.record) {
            window.dispatchEvent(
              new CustomEvent('receiving-entry-added', { detail: entryData.record }),
            );
          }
        }
        setUnmatchedEntries((prev) =>
          [{ id: randomId(), tracking: trackingNumber, at: Date.now() }, ...prev].slice(0, 20),
        );
      }
    } catch {
      /* silently fail */
    } finally {
      setBulkSubmitting(false);
    }
  }, [bulkTracking, bulkSubmitting, staffId]);

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
      <div className={`${sidebarHeaderBandClass} ${sidebarHeaderRowClass}`}>
        <SearchBar
          value={bulkTracking}
          onChange={setBulkTracking}
          onSearch={submitTrackingScan}
          onClear={() => setBulkTracking('')}
          placeholder="Scan tracking…"
          variant="blue"
          size="compact"
          isSearching={bulkSubmitting}
          leadingIcon={<Barcode className="w-[14px] h-[14px]" />}
          className="w-full"
        />
      </div>

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
            {/* Top bar: refresh | PO chip | close */}
            <div className="flex items-center justify-between px-3 py-1.5">
              <button
                type="button"
                onClick={() => setImgKey((k) => k + 1)}
                aria-label="Reload image"
                className="text-gray-400 transition-colors hover:text-gray-700"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              {poContext.po_ids.length > 0 && (
                <OrderIdChip
                  value={poContext.po_ids[0]}
                  display={getLast4(poContext.po_ids[0])}
                />
              )}
              <button
                type="button"
                onClick={clearPoContext}
                aria-label="Clear PO"
                className="text-gray-400 transition-colors hover:text-gray-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

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

      {/* Unmatched entries — blind receives with no PO */}
      {unmatchedEntries.length > 0 && (
        <div className="min-h-0 flex-1 overflow-auto border-t border-gray-200">
          <div className="flex items-center justify-between px-3 pt-2 pb-1">
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">
              No PO Found · {unmatchedEntries.length}
            </p>
            <button
              type="button"
              onClick={() => setUnmatchedEntries([])}
              className="text-[9px] font-black uppercase tracking-wider text-gray-400 hover:text-gray-700"
            >
              Clear
            </button>
          </div>
          <div className="flex flex-col">
            {unmatchedEntries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-gray-50 hover:bg-gray-50/50"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />
                  <TrackingChip value={entry.tracking} display={getLast4(entry.tracking)} />
                </div>
                <button
                  type="button"
                  onClick={() => setUnmatchedEntries((prev) => prev.filter((e) => e.id !== entry.id))}
                  className="flex-shrink-0 text-gray-300 hover:text-gray-600"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
