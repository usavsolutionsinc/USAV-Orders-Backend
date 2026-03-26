'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Loader2, Minus, Package, Plus } from '@/components/Icons';
import { StationScanBar } from '@/components/station/StationScanBar';
import { usePendingCatalog } from '@/components/fba/hooks/usePendingCatalog';
import { useTodayPlan } from '@/components/fba/hooks/useTodayPlan';
import { getTodayDateIso } from '@/components/fba/utils/getTodayDate';
import { getStationInputMode, useStationTestingController } from '@/hooks/useStationTestingController';
import { looksLikeFnsku, looksLikeFnskuPrefix } from '@/lib/scan-resolver';
import {
  fbaWorkspaceScanChrome,
  getStaffThemeById,
  stationScanInputBorderClass,
  type StationTheme,
} from '@/utils/staff-colors';

interface ValidatedFnskuRow {
  fnsku: string;
  found: boolean;
  product_title: string | null;
  asin: string | null;
  sku: string | null;
}

interface FbaFeedback {
  fnsku: string;
  product_title: string | null;
  sku: string | null;
  log_id: number;
  tech_scanned_qty: number;
  pack_ready_qty: number;
  shipped_qty: number;
  available_to_ship: number;
  shipment_ref: string | null;
}

interface BulkScanCandidate {
  fnsku: string;
  qty: number;
  found: boolean;
  product_title: string | null;
  asin: string | null;
  sku: string | null;
}

export interface StationFbaInputProps {
  /** Show the “Station scan” caption and FNSKU routing hint */
  showLabels?: boolean;
  className?: string;
  /**
   * When true, only Amazon FNSKU (X00…) is accepted — no tracking, SKU (with `:`), RS-, or serial.
   * Used by the FBA workspace sidebar scan field.
   */
  fbaScanOnly?: boolean;
  /** Theme-colored outline on the scan bar (same as {@link StationTesting} `inputBorderClassName`). */
  inputBorderClassName?: string;
  /** When set, drives FNSKU chrome + default border; usually matches selected staff ({@link getStaffThemeById}). */
  workspaceTheme?: StationTheme;
  /** When URL has no `staffId`, FBA workspace passes resolved default (e.g. Lien) so scans attribute correctly. */
  techStaffIdOverride?: number | string | null;
}

function normalizeFnsku(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function extractFnskuCounts(raw: string): Map<string, number> {
  const normalized = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const matches = normalized.match(/(?:X0|B0)[A-Z0-9]{8}/g) ?? [];
  const counts = new Map<string, number>();
  for (const match of matches) {
    counts.set(match, (counts.get(match) || 0) + 1);
  }
  return counts;
}

export default function StationFbaInput({
  showLabels = true,
  className = '',
  fbaScanOnly = false,
  inputBorderClassName,
  workspaceTheme: workspaceThemeProp,
  techStaffIdOverride,
}: StationFbaInputProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const staffIdRaw = String(searchParams.get('staffId') || '').trim();
  const userId = useMemo(() => {
    if (techStaffIdOverride != null && techStaffIdOverride !== '') {
      const n = Number(techStaffIdOverride);
      if (Number.isFinite(n) && n > 0) return String(n);
    }
    return /^\d+$/.test(staffIdRaw) ? staffIdRaw : '1';
  }, [techStaffIdOverride, staffIdRaw]);
  const stationTheme = useMemo((): StationTheme => {
    if (workspaceThemeProp) return workspaceThemeProp;
    return getStaffThemeById(staffIdRaw || null, 'technician');
  }, [workspaceThemeProp, staffIdRaw]);
  const workspaceChrome = fbaWorkspaceScanChrome[stationTheme];
  const scanOutlineClass =
    inputBorderClassName ?? stationScanInputBorderClass[stationTheme];

  const planParam = searchParams.get('plan');
  const planIdNum = planParam ? Number(planParam) : NaN;
  const openPlanId = Number.isFinite(planIdNum) && planIdNum > 0 ? planIdNum : null;

  const { addFnskus, resetIfStale } = useTodayPlan();
  const { addPending } = usePendingCatalog();

  useEffect(() => {
    resetIfStale();
  }, [resetIfStale]);

  const bumpFbaRefresh = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('r', String(Date.now()));
    router.replace(params.toString() ? `/fba?${params.toString()}` : '/fba');
  }, [router, searchParams]);

  const [fbaFeedback, setFbaFeedback] = useState<FbaFeedback | null>(null);
  const [fbaError, setFbaError] = useState<string | null>(null);
  const [planHint, setPlanHint] = useState<string | null>(null);
  const [isFbaLoading, setIsFbaLoading] = useState(false);
  const [bulkCandidates, setBulkCandidates] = useState<BulkScanCandidate[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);

  const {
    inputValue,
    setInputValue,
    isLoading,
    inputRef,
    setActiveOrder,
    errorMessage,
    successMessage,
    trackingNotFoundAlert,
    handleSubmit,
    triggerGlobalRefresh,
  } = useStationTestingController({
    userId,
    userName: 'FBA',
    themeColor: 'blue',
    onComplete: bumpFbaRefresh,
    onTrackingOrderLoaded: useCallback(() => {}, []),
    onActiveOrderCardAutoHidden: useCallback(() => {}, []),
  });

  const clearBulkCandidates = useCallback(() => {
    setBulkCandidates([]);
    setBulkLoading(false);
  }, []);

  const validateBulkCandidates = useCallback(async (counts: Map<string, number>) => {
    if (counts.size === 0) {
      clearBulkCandidates();
      return;
    }
    setBulkLoading(true);
    try {
      const uniqueFnskus = Array.from(counts.keys());
      const res = await fetch(`/api/fba/fnskus/validate?fnskus=${encodeURIComponent(uniqueFnskus.join(','))}`);
      const json = await res.json().catch(() => ({}));
      const results = Array.isArray(json?.results) ? (json.results as ValidatedFnskuRow[]) : [];
      const foundMap = new Map(results.map((row) => [String(row.fnsku || '').toUpperCase(), row]));
      const rows: BulkScanCandidate[] = uniqueFnskus.map((fnsku) => {
        const row = foundMap.get(fnsku);
        return {
          fnsku,
          qty: Math.max(1, counts.get(fnsku) || 1),
          found: Boolean(row?.found),
          product_title: row?.product_title ?? null,
          asin: row?.asin ?? null,
          sku: row?.sku ?? null,
        };
      });
      setBulkCandidates(rows);
    } catch {
      setBulkCandidates([]);
      setFbaError('Could not validate pasted FNSKUs right now.');
    } finally {
      setBulkLoading(false);
    }
  }, [clearBulkCandidates]);

  const adjustBulkQty = useCallback((fnsku: string, delta: number) => {
    setBulkCandidates((prev) =>
      prev.map((row) =>
        row.fnsku === fnsku
          ? { ...row, qty: Math.max(0, row.qty + delta) }
          : row,
      ),
    );
  }, []);

  const applyScanFnskuFeedback = useCallback(
    async (fnsku: string) => {
      try {
        const res = await fetch(
          `/api/tech/scan-fnsku?fnsku=${encodeURIComponent(fnsku)}&techId=${encodeURIComponent(userId)}`
        );
        const data = await res.json();
        if (!res.ok || !data.found) return;

        if (!fbaScanOnly) {
          setActiveOrder({
            id: data.order?.id ?? null,
            orderId: data.order?.orderId ?? 'FNSKU',
            fnsku,
            productTitle: data.order?.productTitle ?? data.order?.tracking ?? fnsku,
            itemNumber: data.order?.itemNumber ?? null,
            sku: data.order?.sku ?? 'N/A',
            condition: data.order?.condition ?? 'N/A',
            notes: data.order?.notes ?? '',
            tracking: data.order?.tracking ?? fnsku,
            serialNumbers: Array.isArray(data.order?.serialNumbers) ? data.order.serialNumbers : [],
            testDateTime: data.order?.testDateTime ?? null,
            testedBy: data.order?.testedBy ?? null,
            quantity: parseInt(String(data.order?.quantity || 1), 10) || 1,
            shipByDate: data.order?.shipByDate ?? null,
            createdAt: data.order?.createdAt ?? null,
            orderFound: data.orderFound !== false,
            sourceType: 'fba',
          });
          triggerGlobalRefresh();
        }

        setFbaFeedback({
          fnsku,
          product_title: data.order?.productTitle ?? null,
          sku: data.order?.sku ?? null,
          log_id: Number(data.fnskuLogId ?? 0),
          tech_scanned_qty: Number(data.summary?.tech_scanned_qty ?? 0),
          pack_ready_qty: Number(data.summary?.pack_ready_qty ?? 0),
          shipped_qty: Number(data.summary?.shipped_qty ?? 0),
          available_to_ship: Number(data.summary?.available_to_ship ?? 0),
          shipment_ref: data.shipment?.shipment_ref ?? null,
        });
      } catch {
        /* optional telemetry */
      }
    },
    [userId, setActiveOrder, triggerGlobalRefresh, fbaScanOnly]
  );

  const handleFnskuPlanFlow = useCallback(
    async (raw: string) => {
      const fnsku = normalizeFnsku(raw);
      if (!fnsku) return;

      setIsFbaLoading(true);
      setFbaFeedback(null);
      setFbaError(null);
      setPlanHint(null);

      try {
        const validateRes = await fetch(`/api/fba/fnskus/validate?fnskus=${encodeURIComponent(fnsku)}`);
        const validateJson = await validateRes.json();
        const row = Array.isArray(validateJson?.results) ? (validateJson.results[0] as ValidatedFnskuRow) : null;

        if (!row?.found) {
          addPending([fnsku]);
          setFbaError('FNSKU not in catalog — saved as pending for admin.');
          return;
        }

        if (openPlanId) {
          const res = await fetch(`/api/fba/shipments/${openPlanId}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fnsku,
              expected_qty: 1,
              product_title: row.product_title,
              asin: row.asin,
              sku: row.sku,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!data.success && !res.ok) {
            setFbaError(data.error || 'Could not add line to this plan.');
            return;
          }
          addFnskus([fnsku]);
          setPlanHint(`Added to open plan (#${openPlanId}).`);
          window.dispatchEvent(new CustomEvent('fba-print-queue-refresh'));
          window.dispatchEvent(new Event('fba-plan-created'));
          bumpFbaRefresh();
        } else {
          const res = await fetch('/api/fba/shipments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              due_date: getTodayDateIso(),
              items: [{ fnsku, expected_qty: 1 }],
              unresolved_fnskus: [],
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            setFbaError(data?.error || 'Could not create a new plan.');
            return;
          }
          const shipmentId = Number(data.shipment?.id);
          const shipmentRef = String(data.shipment?.shipment_ref ?? '');
          if (!Number.isFinite(shipmentId) || shipmentId < 1) {
            setFbaError('Plan created but response was incomplete.');
            return;
          }
          addFnskus([fnsku]);
          setPlanHint(shipmentRef ? `New plan ${shipmentRef}` : 'New plan created.');
          const params = new URLSearchParams(searchParams.toString());
          params.set('plan', String(shipmentId));
          params.delete('draft');
          params.set('r', String(Date.now()));
          router.replace(`/fba?${params.toString()}`);
          window.dispatchEvent(new Event('fba-plan-created'));
          window.dispatchEvent(new CustomEvent('fba-print-queue-refresh'));
        }

        await applyScanFnskuFeedback(fnsku);
      } catch {
        setFbaError('Network error — try again.');
      } finally {
        setIsFbaLoading(false);
        setInputValue('');
        inputRef.current?.focus();
      }
    },
    [
      openPlanId,
      addPending,
      addFnskus,
      bumpFbaRefresh,
      applyScanFnskuFeedback,
      router,
      searchParams,
      setInputValue,
      inputRef,
    ]
  );

  const handleBulkFnskuPlanFlow = useCallback(
    async (rows: BulkScanCandidate[]) => {
      const validRows = rows.filter((row) => row.found && row.qty > 0);
      const missingFnskus = rows.filter((row) => !row.found).map((row) => row.fnsku);
      if (missingFnskus.length > 0) addPending(missingFnskus);
      if (validRows.length === 0) {
        setFbaError('No valid catalog FNSKUs in pasted list. Missing rows were saved as pending.');
        return;
      }

      setIsFbaLoading(true);
      setFbaFeedback(null);
      setFbaError(null);
      setPlanHint(null);
      try {
        if (openPlanId) {
          for (const row of validRows) {
            const res = await fetch(`/api/fba/shipments/${openPlanId}/items`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fnsku: row.fnsku,
                expected_qty: row.qty,
                product_title: row.product_title,
                asin: row.asin,
                sku: row.sku,
              }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data?.success === false) {
              setFbaError(data?.error || `Could not add ${row.fnsku} to this plan.`);
              return;
            }
          }
          setPlanHint(`Added ${validRows.length} FNSKU row${validRows.length === 1 ? '' : 's'} to open plan (#${openPlanId}).`);
          addFnskus(validRows.map((row) => row.fnsku));
          window.dispatchEvent(new CustomEvent('fba-print-queue-refresh'));
          window.dispatchEvent(new Event('fba-plan-created'));
          bumpFbaRefresh();
        } else {
          const res = await fetch('/api/fba/shipments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              due_date: getTodayDateIso(),
              items: validRows.map((row) => ({
                fnsku: row.fnsku,
                expected_qty: row.qty,
                product_title: row.product_title,
                asin: row.asin,
                sku: row.sku,
              })),
              unresolved_fnskus: missingFnskus,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data?.success === false) {
            setFbaError(data?.error || 'Could not create a new plan from pasted FNSKUs.');
            return;
          }
          const shipmentId = Number(data.shipment?.id);
          const shipmentRef = String(data.shipment?.shipment_ref ?? '');
          if (!Number.isFinite(shipmentId) || shipmentId < 1) {
            setFbaError('Plan created but response was incomplete.');
            return;
          }
          setPlanHint(
            shipmentRef
              ? `New plan ${shipmentRef} with ${validRows.length} FNSKU row${validRows.length === 1 ? '' : 's'}.`
              : 'New plan created from pasted FNSKUs.',
          );
          addFnskus(validRows.map((row) => row.fnsku));
          const params = new URLSearchParams(searchParams.toString());
          params.set('plan', String(shipmentId));
          params.delete('draft');
          params.set('r', String(Date.now()));
          router.replace(`/fba?${params.toString()}`);
          window.dispatchEvent(new Event('fba-plan-created'));
          window.dispatchEvent(new CustomEvent('fba-print-queue-refresh'));
        }

        await applyScanFnskuFeedback(validRows[0].fnsku);
        setInputValue('');
        clearBulkCandidates();
      } catch {
        setFbaError('Network error - try again.');
      } finally {
        setIsFbaLoading(false);
        inputRef.current?.focus();
      }
    },
    [
      addFnskus,
      addPending,
      applyScanFnskuFeedback,
      bumpFbaRefresh,
      clearBulkCandidates,
      inputRef,
      openPlanId,
      router,
      searchParams,
      setInputValue,
    ],
  );

  const handleFormSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const raw = inputValue;
      const trimmed = raw.trim();
      if (!trimmed) return;
      if (fbaScanOnly && bulkCandidates.length > 0) {
        void handleBulkFnskuPlanFlow(bulkCandidates);
        return;
      }

      if (fbaScanOnly && !looksLikeFnsku(trimmed)) {
        setFbaError(
          looksLikeFnskuPrefix(trimmed)
            ? 'Incomplete FNSKU — full X00… or B0… (10 characters).'
            : 'FNSKU only (X00…). No tracking, SKU, RS-, or serial in this field.',
        );
        return;
      }

      if (looksLikeFnsku(trimmed)) {
        clearBulkCandidates();
        setInputValue('');
        void handleFnskuPlanFlow(raw);
        return;
      }

      setFbaFeedback(null);
      setFbaError(null);
      setPlanHint(null);
      void handleSubmit(undefined, undefined, undefined);
    },
    [inputValue, handleFnskuPlanFlow, handleSubmit, setInputValue, fbaScanOnly, bulkCandidates, handleBulkFnskuPlanFlow, clearBulkCandidates]
  );

  const handleInputChange = useCallback(
    (value: string) => {
      setInputValue(value);
      if (!fbaScanOnly) return;
      setFbaError(null);
      setPlanHint(null);
      setFbaFeedback(null);
      const counts = extractFnskuCounts(value);
      const hasBatch = counts.size > 1 || (counts.size === 1 && /[\s,;|]/.test(value));
      if (!hasBatch) {
        clearBulkCandidates();
        return;
      }
      void validateBulkCandidates(counts);
    },
    [clearBulkCandidates, fbaScanOnly, setInputValue, validateBulkCandidates]
  );

  const scanError = fbaScanOnly ? fbaError : trackingNotFoundAlert || errorMessage || fbaError;
  const busy = fbaScanOnly ? isFbaLoading || bulkLoading : isLoading || isFbaLoading;

  const routingHint = openPlanId
    ? 'FNSKU adds to the open plan. No plan selected → FNSKU starts a new plan.'
    : 'FNSKU starts a new plan. Select a plan in the list to add lines there instead.';

  const fbaOnlyHint =
    openPlanId === null
      ? 'Scan an FNSKU (X00…) to start a new plan, or select a plan below to add lines to it.'
      : 'Scan an FNSKU (X00…) to add a line to the open plan.';

  return (
    <div className={`space-y-2 ${className}`.trim()}>
      {showLabels ? (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            {fbaScanOnly ? 'FNSKU scan' : 'Station scan'}
          </p>
          <p className="text-[11px] leading-snug text-zinc-500">{fbaScanOnly ? fbaOnlyHint : routingHint}</p>
        </>
      ) : null}

      <StationScanBar
        value={inputValue}
        onChange={handleInputChange}
        onSubmit={handleFormSubmit}
        inputRef={inputRef}
        inputBorderClassName={scanOutlineClass}
        placeholder={fbaScanOnly ? 'FNSKU (X00…)' : 'FNSKU, tracking, RS-, serial'}
        autoFocus={false}
        hasRightContent={busy}
        icon={
          <Package
            className={`h-4 w-4 ${fbaScanOnly ? workspaceChrome.fnskuScanIconClass : 'text-violet-600'}`}
          />
        }
        iconClassName=""
        inputClassName={
          fbaScanOnly
            ? `!py-2.5 !text-sm !rounded-xl !font-bold ${workspaceChrome.fnskuScanInputClass}`
            : '!py-2.5 !text-sm !rounded-xl focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20'
        }
        rightContentClassName="right-2"
        rightContent={
          busy ? (
            <Loader2
              className={`h-4 w-4 shrink-0 animate-spin ${fbaScanOnly ? workspaceChrome.savingSpinner : 'text-zinc-600'}`}
            />
          ) : null
        }
      />

      {fbaScanOnly && bulkCandidates.length > 0 ? (
        <div className="rounded-xl border border-violet-200 bg-violet-50/60 px-2.5 py-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-800">
              Pasted FNSKU validation
            </p>
            <p className="text-[10px] font-semibold tabular-nums text-violet-700">
              {bulkCandidates.length} rows
            </p>
          </div>
          <ul className="space-y-1.5">
            {bulkCandidates.map((row) => (
              <li key={row.fnsku} className="flex items-center gap-2 rounded-lg border border-violet-100 bg-white px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-bold text-zinc-900">
                    {row.product_title || row.fnsku}
                  </p>
                  <p className={`text-[10px] font-mono ${row.found ? 'text-zinc-500' : 'text-red-600'}`}>
                    {row.fnsku} {row.found ? '' : '- not in fba_fnskus'}
                  </p>
                </div>
                <div className="flex w-7 flex-col items-center justify-center rounded-md border border-violet-200 bg-violet-50">
                  <button
                    type="button"
                    onClick={() => adjustBulkQty(row.fnsku, 1)}
                    className="flex h-5 w-full items-center justify-center text-violet-700 hover:bg-violet-100"
                    aria-label={`Increase ${row.fnsku} quantity`}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                  <span className="text-[10px] font-black tabular-nums text-violet-900">{row.qty}</span>
                  <button
                    type="button"
                    onClick={() => adjustBulkQty(row.fnsku, -1)}
                    className="flex h-5 w-full items-center justify-center text-violet-700 hover:bg-violet-100 disabled:opacity-40"
                    disabled={row.qty <= 0}
                    aria-label={`Decrease ${row.fnsku} quantity`}
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-violet-700">
            Press Enter to add valid rows using the quantities on the right.
          </p>
        </div>
      ) : null}

      {scanError ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs font-semibold text-red-800"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 leading-snug">{scanError}</span>
        </div>
      ) : null}

      {!scanError && planHint ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs font-semibold text-emerald-900">
          {planHint}
        </p>
      ) : null}

      {!fbaScanOnly && !scanError && successMessage && !planHint ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs font-semibold text-emerald-900">
          {successMessage}
        </p>
      ) : null}

      {fbaFeedback && !fbaError ? (
        <div className="rounded-lg border border-orange-200 bg-orange-50/90 px-2.5 py-2 text-xs">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-orange-800">FNSKU</p>
          <p className="mt-0.5 line-clamp-2 font-bold text-zinc-900">
            {fbaFeedback.product_title || fbaFeedback.fnsku}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-zinc-600">{fbaFeedback.fnsku}</p>
          {fbaFeedback.shipment_ref ? (
            <p className="mt-1 text-[11px] font-semibold text-orange-800">
              Shipment {fbaFeedback.shipment_ref}
            </p>
          ) : null}
          <p className="mt-1.5 tabular-nums text-[11px] text-zinc-700">
            Tech {fbaFeedback.tech_scanned_qty} · Ready {fbaFeedback.pack_ready_qty} · Avail{' '}
            {fbaFeedback.available_to_ship} · Ship {fbaFeedback.shipped_qty}
          </p>
        </div>
      ) : null}
    </div>
  );
}
