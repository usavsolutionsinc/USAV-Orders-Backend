'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  sidebarHeaderBandClass,
  sidebarHeaderControlClass,
  sidebarHeaderRowClass,
} from '@/components/layout/header-shell';
import { Barcode, Printer, X } from '@/components/Icons';
import { OrderIdChip, getLast4 } from '@/components/ui/CopyChip';
import { SearchBar } from '@/components/ui/SearchBar';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
import StaffSelector from '@/components/StaffSelector';
import { RECEIVING_CARRIERS } from '@/components/station/receiving-constants';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import type { ReceivingDetailsLog } from '@/components/station/ReceivingDetailsStack';
import {
  ReceivingReturnBanner,
  type ReturnEvent,
} from '@/components/sidebar/ReceivingReturnBanner';
import { printProductLabel } from '@/lib/print/printProductLabel';
import { LocalPickupIntakeForm } from '@/components/work-orders/LocalPickupIntakeForm';

export { RECEIVING_CARRIERS };

const RECEIVING_MODE_OPTIONS = [
  { value: 'bulk', label: 'Bulk Scan' },
  { value: 'unboxing', label: 'Unboxing' },
  { value: 'pickup', label: 'Local Pickup' },
];

type ReceivingMode = 'bulk' | 'unboxing' | 'pickup';

type PoLineSummary = {
  id: number;
  sku: string | null;
  item_name: string | null;
  quantity_expected: number | null;
  quantity_received: number;
};

type PoContext = {
  receiving_id: number;
  po_ids: string[];
  lines: PoLineSummary[];
};

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ReceivingSidebarPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const rawMode = searchParams.get('mode');
  const mode: ReceivingMode =
    rawMode === 'unboxing' ? 'unboxing' : rawMode === 'pickup' ? 'pickup' : 'bulk';
  const staffId = searchParams.get('staffId') || '7';

  // Existing bridge: when a line is selected in the main table (pickup flow),
  // open the parent receiving log detail stack. Unrelated to the new arm-line
  // concept used for scanning serials against a line.
  useEffect(() => {
    const onSelect = (e: Event) => {
      const line = (e as CustomEvent<ReceivingLineRow | null>).detail;
      if (!line?.receiving_id) return;
      const logDetail: ReceivingDetailsLog = {
        id: String(line.receiving_id),
        timestamp: line.created_at || '',
        tracking: line.tracking_number || '',
        status: line.carrier || '',
        qa_status: line.qa_status || 'PENDING',
        disposition_code: line.disposition_code || 'ACCEPT',
        condition_grade: line.condition_grade || 'BRAND_NEW',
        needs_test: true,
      };
      window.dispatchEvent(
        new CustomEvent('receiving-select-log', { detail: logDetail }),
      );
    };
    window.addEventListener('receiving-select-line', onSelect);
    return () => window.removeEventListener('receiving-select-line', onSelect);
  }, []);

  // Clear line selection highlight when leaving unboxing mode
  useEffect(() => {
    if (mode !== 'unboxing') {
      window.dispatchEvent(new CustomEvent('receiving-clear-line'));
    }
  }, [mode]);

  // ─── Bulk mode state (unchanged) ─────────────────────────────────────────
  const [carrier, setCarrier] = useState('');
  const carrierScrollRef = useRef<HTMLDivElement>(null);
  const handleCarrierWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (carrierScrollRef.current) {
      carrierScrollRef.current.scrollLeft += e.deltaY + e.deltaX;
    }
  }, []);

  const [bulkTracking, setBulkTracking] = useState('');
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

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

  // Persist print-on-scan preference
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('receiving.printOnScan', String(printOnScan));
  }, [printOnScan]);

  // Reset all unboxing state when leaving unboxing mode
  useEffect(() => {
    if (mode !== 'unboxing') {
      setPoContext(null);
      setArmedLineId(null);
      setSerialInput('');
      setReturns([]);
      setPendingCandidates([]);
    }
  }, [mode]);

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
          quantity_expected: number | null;
          quantity_received: number;
        }) => ({
          id: l.id,
          sku: l.sku,
          item_name: l.item_name,
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

  // ─── Bulk scan handler (unchanged from original) ────────────────────────
  const submitBulkScan = useCallback((rawTracking?: string) => {
    const trackingNumber = (rawTracking ?? bulkTracking).trim();
    if (!trackingNumber || bulkSubmitting) return;

    setBulkTracking('');
    setBulkSubmitting(true);

    fetch('/api/receiving-entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trackingNumber,
        carrier: carrier || undefined,
        qaStatus: 'PENDING',
        dispositionCode: 'HOLD',
        conditionGrade: 'USED_A',
        isReturn: false,
        needsTest: true,
        skipZohoMatch: true,
      }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        if (data?.record) {
          window.dispatchEvent(
            new CustomEvent('receiving-entry-added', { detail: data.record }),
          );
        }
      })
      .catch(() => {
        /* silently fail — entry will appear on next refresh */
      })
      .finally(() => setBulkSubmitting(false));
  }, [bulkTracking, carrier, bulkSubmitting, queryClient]);

  // ─── Unboxing mode: tracking scan → lookup-po → hydrated lines ──────────
  const submitUnboxingLookupPo = useCallback(async (rawTracking?: string) => {
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
          carrier: carrier || undefined,
          staffId: Number(staffId),
        }),
      });
      const data = await res.json();
      if (!data?.success) return;

      const ctx: PoContext = {
        receiving_id: Number(data.receiving_id),
        po_ids: Array.isArray(data.po_ids) ? data.po_ids : [],
        lines: (data.lines || []).map((l: {
          id: number;
          sku: string | null;
          item_name: string | null;
          quantity_expected: number | null;
          quantity_received: number;
        }) => ({
          id: l.id,
          sku: l.sku,
          item_name: l.item_name,
          quantity_expected: l.quantity_expected,
          quantity_received: l.quantity_received,
        })),
      };
      setPoContext(ctx);

      // Auto-arm if exactly one open line
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

      // Move focus to the serial input for rapid rapid-fire scanning
      setTimeout(() => serialInputRef.current?.focus(), 60);
    } catch {
      /* silently fail — user can re-scan */
    } finally {
      setBulkSubmitting(false);
    }
  }, [bulkTracking, bulkSubmitting, carrier, staffId]);

  // Dispatch tracking scan based on mode
  const submitTrackingScan = useCallback((rawTracking?: string) => {
    if (mode === 'unboxing') submitUnboxingLookupPo(rawTracking);
    else submitBulkScan(rawTracking);
  }, [mode, submitUnboxingLookupPo, submitBulkScan]);

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

      {/* Pickup mode: dedicated intake form (no tracking scan) */}
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
          placeholder={mode === 'unboxing' ? 'Scan tracking to load PO…' : 'Scan or enter tracking…'}
          variant="blue"
          size="compact"
          isSearching={bulkSubmitting}
          leadingIcon={<Barcode className="w-[14px] h-[14px]" />}
          className="w-full"
        />
      </div>

      {/* Return detection banner (unboxing only) — sits directly under SearchBar */}
      {mode === 'unboxing' && (
        <ReceivingReturnBanner returns={returns} onDismiss={dismissReturn} />
      )}

      {/* Carrier slider — bulk scan only */}
      {mode === 'bulk' && (
        <div className={`${sidebarHeaderBandClass} px-3 py-2`}>
          <div
            ref={carrierScrollRef}
            onWheel={handleCarrierWheel}
            className="overflow-x-auto w-full"
            style={{ scrollbarWidth: 'none' }}
          >
            <div className="flex gap-1.5 w-max">
              {RECEIVING_CARRIERS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCarrier(c.value)}
                  className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all ${
                    carrier === c.value
                      ? 'bg-gray-900 text-white'
                      : 'border border-gray-200 bg-white text-gray-500 hover:text-gray-800 hover:border-gray-300'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Unboxing mode: PO header + serial scan row + toggle row + picker */}
      {mode === 'unboxing' && poContext && (
        <>
          {/* PO header card */}
          <div className="border-b border-gray-200 bg-gray-50 px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">
                  PO Loaded
                </p>
                <p className="mt-0.5 text-[12px] font-bold leading-snug text-gray-900 break-words">
                  {(armedLine?.item_name || poContext.lines[0]?.item_name) ?? 'Unnamed product'}
                </p>
                {poContext.po_ids.length > 0 && (
                  <div className="mt-1 flex items-center">
                    <OrderIdChip
                      value={poContext.po_ids[0]}
                      display={getLast4(poContext.po_ids[0])}
                    />
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={clearPoContext}
                aria-label="Clear PO"
                className="flex-shrink-0 text-gray-400 transition-colors hover:text-gray-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
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
        </>
      )}
    </div>
  );
}
