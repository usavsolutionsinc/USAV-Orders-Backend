'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ClipboardList, Loader2, Package, Pencil, Plus } from '@/components/Icons';
import { FbaSelectionItemList, type FbaListItemRow } from '@/components/fba/sidebar/FbaSelectionItemList';
import { StationScanBar } from '@/components/station/StationScanBar';
import { usePendingCatalog } from '@/components/fba/hooks/usePendingCatalog';
import { useTodayPlan } from '@/components/fba/hooks/useTodayPlan';
import { emitOpenQuickAddFnsku } from '@/components/fba/FbaQuickAddFnskuModal';
import { getStationInputMode, useStationTestingController } from '@/hooks/useStationTestingController';
import { looksLikeFnsku, looksLikeFnskuPrefix } from '@/lib/scan-resolver';
import {
  fbaSidebarThemeChrome,
  fbaWorkspaceScanChrome,
  getStaffThemeById,
  stationScanInputBorderClass,
  type StationTheme,
} from '@/utils/staff-colors';

interface ValidatedFnskuRow {
  fnsku: string;
  found: boolean;
  catalog_exists?: boolean;
  needs_details?: boolean;
  upserted_stub?: boolean;
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
  catalog_exists?: boolean;
  needs_details?: boolean;
  upserted_stub?: boolean;
  product_title: string | null;
  asin: string | null;
  sku: string | null;
}

interface FnskuSelectResult {
  fnsku: string;
  found: boolean;
  count: number;
  title?: string;
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
  const sidebarChrome = fbaSidebarThemeChrome[stationTheme];
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
  const [fbaMode, setFbaMode] = useState<'plan' | 'select'>('plan');
  const [selectResult, setSelectResult] = useState<FnskuSelectResult | null>(null);

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

  useEffect(() => {
    const handler = (e: Event) => {
      setSelectResult((e as CustomEvent<FnskuSelectResult>).detail);
    };
    window.addEventListener('fba-board-fnsku-select-result', handler as EventListener);
    return () => window.removeEventListener('fba-board-fnsku-select-result', handler as EventListener);
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

  const handleFnskuSelectFlow = useCallback(
    (raw: string) => {
      const fnsku = normalizeFnsku(raw);
      if (!fnsku) return;
      setFbaFeedback(null);
      setFbaError(null);
      setPlanHint(null);
      setSelectResult(null);
      window.dispatchEvent(new CustomEvent('fba-board-select-by-fnsku', { detail: fnsku }));
      setInputValue('');
      inputRef.current?.focus();
    },
    [setInputValue, inputRef],
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
        const validateRes = await fetch(
          `/api/fba/fnskus/validate?fnskus=${encodeURIComponent(fnsku)}&persist_missing=1`
        );
        const validateJson = await validateRes.json();
        const row = Array.isArray(validateJson?.results) ? (validateJson.results[0] as ValidatedFnskuRow) : null;

        const needsDetails = !row?.found;
        if (needsDetails) addPending([fnsku]);

        if (openPlanId) {
          const res = await fetch(`/api/fba/shipments/${openPlanId}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fnsku,
              expected_qty: 1,
              product_title: row?.product_title ?? null,
              asin: row?.asin ?? null,
              sku: row?.sku ?? null,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!data.success && !res.ok) {
            setFbaError(data.error || 'Could not add line to this plan.');
            return;
          }
          addFnskus([fnsku]);
          setPlanHint(
            needsDetails
              ? `Added to open plan (#${openPlanId}). You can fill in product details later.`
              : `Added to open plan (#${openPlanId}).`
          );
          window.dispatchEvent(new CustomEvent('fba-print-queue-refresh'));
          window.dispatchEvent(new Event('fba-plan-created'));
          bumpFbaRefresh();
        } else {
          // Add to today's plan (auto-creates if none exists)
          const res = await fetch('/api/fba/shipments/today/items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: [{
                fnsku,
                expected_qty: 1,
                product_title: row?.product_title ?? null,
                asin: row?.asin ?? null,
                sku: row?.sku ?? null,
              }],
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            setFbaError(data?.error || 'Could not add to today\'s plan.');
            return;
          }
          const shipmentId = Number(data.shipment_id);
          const shipmentRef = String(data.shipment_ref ?? data.plan_ref ?? '');
          const wasSkipped = Array.isArray(data.skipped) && data.skipped.length > 0;
          if (!Number.isFinite(shipmentId) || shipmentId < 1) {
            setFbaError('Plan updated but response was incomplete.');
            return;
          }
          addFnskus([fnsku]);
          setPlanHint(
            wasSkipped
              ? `${fnsku} already in today's plan (${shipmentRef}).`
              : needsDetails
                ? `Added to today's plan ${shipmentRef}. Product details can be filled in later.`
                : `Added to today's plan ${shipmentRef}.`
          );
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
      const addableRows = rows.filter((row) => row.qty > 0);
      const missingFnskus = rows.filter((row) => !row.found).map((row) => row.fnsku);
      if (missingFnskus.length > 0) addPending(missingFnskus);
      if (addableRows.length === 0) {
        setFbaError('No FNSKUs with quantity above zero in the pasted list.');
        return;
      }

      setIsFbaLoading(true);
      setFbaFeedback(null);
      setFbaError(null);
      setPlanHint(null);
      try {
        if (openPlanId) {
          for (const row of addableRows) {
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
          setPlanHint(
            missingFnskus.length > 0
              ? `Added ${addableRows.length} FNSKU row${addableRows.length === 1 ? '' : 's'} to open plan (#${openPlanId}). Some still need product details.`
              : `Added ${addableRows.length} FNSKU row${addableRows.length === 1 ? '' : 's'} to open plan (#${openPlanId}).`
          );
          addFnskus(addableRows.map((row) => row.fnsku));
          window.dispatchEvent(new CustomEvent('fba-print-queue-refresh'));
          window.dispatchEvent(new Event('fba-plan-created'));
          bumpFbaRefresh();
        } else {
          // Add to today's plan (auto-creates if none exists)
          const res = await fetch('/api/fba/shipments/today/items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: addableRows.map((row) => ({
                fnsku: row.fnsku,
                expected_qty: row.qty,
                product_title: row.product_title,
                asin: row.asin,
                sku: row.sku,
              })),
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data?.success === false) {
            setFbaError(data?.error || 'Could not add FNSKUs to today\'s plan.');
            return;
          }
          const shipmentId = Number(data.shipment_id);
          const shipmentRef = String(data.shipment_ref ?? data.plan_ref ?? '');
          const addedCount = Array.isArray(data.added) ? data.added.length : addableRows.length;
          const skippedCount = Array.isArray(data.skipped) ? data.skipped.length : 0;
          if (!Number.isFinite(shipmentId) || shipmentId < 1) {
            setFbaError('Plan updated but response was incomplete.');
            return;
          }
          const skippedNote = skippedCount > 0 ? ` (${skippedCount} already in plan)` : '';
          setPlanHint(
            shipmentRef
              ? missingFnskus.length > 0
                ? `Added ${addedCount} FNSKU row${addedCount === 1 ? '' : 's'} to today's plan ${shipmentRef}${skippedNote}. Some still need product details.`
                : `Added ${addedCount} FNSKU row${addedCount === 1 ? '' : 's'} to today's plan ${shipmentRef}${skippedNote}.`
              : missingFnskus.length > 0
                ? `Added ${addedCount} rows to today's plan${skippedNote}. Some still need product details.`
                : `Added ${addedCount} rows to today's plan${skippedNote}.`,
          );
          addFnskus(addableRows.map((row) => row.fnsku));
          const params = new URLSearchParams(searchParams.toString());
          params.set('plan', String(shipmentId));
          params.delete('draft');
          params.set('r', String(Date.now()));
          router.replace(`/fba?${params.toString()}`);
          window.dispatchEvent(new Event('fba-plan-created'));
          window.dispatchEvent(new CustomEvent('fba-print-queue-refresh'));
        }

        await applyScanFnskuFeedback(addableRows[0].fnsku);
        setInputValue('');
        // bulk candidates cleared (auto-submit, no review)
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

      if (fbaScanOnly && !looksLikeFnsku(trimmed)) {
        setFbaError(
          looksLikeFnskuPrefix(trimmed)
            ? 'Incomplete FNSKU — full X00… or B0… (10 characters).'
            : 'FNSKU only (X00…). No tracking, SKU, RS-, or serial in this field.',
        );
        return;
      }

      if (looksLikeFnsku(trimmed)) {
        setInputValue('');
        if (fbaScanOnly && fbaMode === 'select') {
          handleFnskuSelectFlow(trimmed);
        } else {
          void handleFnskuPlanFlow(raw);
        }
        return;
      }

      setFbaFeedback(null);
      setFbaError(null);
      setPlanHint(null);
      void handleSubmit(undefined, undefined, undefined);
    },
    [inputValue, handleFnskuPlanFlow, handleFnskuSelectFlow, handleSubmit, setInputValue, fbaScanOnly, fbaMode]
  );

  const handleInputChange = useCallback(
    (value: string) => {
      setInputValue(value);
      if (!fbaScanOnly) return;
      setFbaError(null);
      setPlanHint(null);
      setFbaFeedback(null);
      setSelectResult(null);
      if (fbaMode === 'select') return;
      // Detect bulk paste — auto-submit immediately, no intermediate review
      const counts = extractFnskuCounts(value);
      const hasBatch = counts.size > 1 || (counts.size === 1 && /[\s,;|]/.test(value));
      if (hasBatch && counts.size > 0) {
        setInputValue('');
        const rows: BulkScanCandidate[] = Array.from(counts.entries()).map(([fnsku, qty]) => ({
          fnsku, qty, found: true, product_title: null, asin: null, sku: null,
        }));
        void handleBulkFnskuPlanFlow(rows);
      }
    },
    [fbaScanOnly, fbaMode, setInputValue, handleBulkFnskuPlanFlow]
  );

  const scanError = fbaScanOnly ? fbaError : trackingNotFoundAlert || errorMessage || fbaError;
  const busy = fbaScanOnly ? isFbaLoading : isLoading || isFbaLoading;

  const routingHint = openPlanId
    ? 'FNSKU adds to the open plan. No plan selected → FNSKU starts a new plan.'
    : 'FNSKU starts a new plan. Select a plan in the list to add lines there instead.';

  const fbaOnlyHint = fbaMode === 'select'
    ? 'Scan FNSKU (X00…) to select matching items on the board.'
    : openPlanId === null
      ? 'Scan FNSKU (X00…) to start a new plan. Select a plan below to add lines to it.'
      : 'Scan FNSKU (X00…) to add a line to the open plan.';

  const modeButtonBase = 'flex h-6 w-6 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400/60';
  const modeButtonInactive = 'text-gray-400 hover:bg-gray-100 hover:text-gray-700';

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
        hasRightContent={fbaScanOnly || busy}
        onPaste={fbaScanOnly ? handleInputChange : undefined}
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
          ) : fbaScanOnly ? (
            <div className="flex items-center gap-0">
              <button
                type="button"
                onClick={() => { setFbaMode('plan'); setSelectResult(null); }}
                aria-pressed={fbaMode === 'plan'}
                title="Plan mode — scan FNSKU to add to plan"
                aria-label={fbaMode === 'plan' ? 'Plan mode active' : 'Switch to Plan mode'}
                className={`${modeButtonBase} ${fbaMode === 'plan' ? 'bg-purple-50 text-purple-700 hover:bg-purple-100' : modeButtonInactive}`}
              >
                <ClipboardList className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => { setFbaMode('select'); setFbaFeedback(null); setPlanHint(null); setFbaError(null); }}
                aria-pressed={fbaMode === 'select'}
                title="Select mode — scan FNSKU to select it on the board"
                aria-label={fbaMode === 'select' ? 'Select mode active' : 'Switch to Select mode'}
                className={`${modeButtonBase} ${fbaMode === 'select' ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : modeButtonInactive}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null
        }
      />

      {fbaScanOnly && fbaMode === 'select' && selectResult ? (
        selectResult.found ? (
          <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs font-semibold text-emerald-900">
            Selected {selectResult.count} item{selectResult.count !== 1 ? 's' : ''}{selectResult.title ? ` — ${selectResult.title}` : ''} on the board
          </p>
        ) : (
          <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] font-semibold text-amber-800">
            <span className="font-mono">{selectResult.fnsku}</span> not on board —{' '}
            <button
              type="button"
              onClick={() => { setFbaMode('plan'); setSelectResult(null); }}
              className="font-black text-purple-700 underline-offset-2 hover:underline"
            >
              switch to Plan
            </button>{' '}
            to add to today&apos;s plan
          </p>
        )
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
        <div className="space-y-1.5">
          <FbaSelectionItemList
            items={[{
              id: fbaFeedback.fnsku,
              displayTitle: fbaFeedback.product_title || fbaFeedback.fnsku,
              fnskuSubtext: fbaFeedback.fnsku,
              subLabel: fbaFeedback.shipment_ref
                ? `Plan ${fbaFeedback.shipment_ref}`
                : 'Added to plan',
              subLabelClass: 'text-purple-600',
              qty: fbaFeedback.available_to_ship,
              ...(fbaFeedback.product_title
                ? {}
                : {
                    onFocus: () => emitOpenQuickAddFnsku({ fnsku: fbaFeedback.fnsku }),
                  }),
            } satisfies FbaListItemRow]}
            fnskuSubtextClass={fbaScanOnly ? workspaceChrome.fnskuSubtext : 'font-mono text-gray-500'}
            focusRingClass={sidebarChrome.cardFocusRing ?? ''}
          />
          <p className="tabular-nums text-[10px] text-zinc-500">
            Tech {fbaFeedback.tech_scanned_qty} · Ready {fbaFeedback.pack_ready_qty} · Avail{' '}
            {fbaFeedback.available_to_ship} · Ship {fbaFeedback.shipped_qty}
          </p>
        </div>
      ) : null}
    </div>
  );
}
