'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Loader2, Package } from '@/components/Icons';
import { StationScanBar } from '@/components/station/StationScanBar';
import { usePendingCatalog } from '@/components/fba/hooks/usePendingCatalog';
import { useTodayPlan } from '@/components/fba/hooks/useTodayPlan';
import { getTodayDateIso } from '@/components/fba/utils/getTodayDate';
import { getStationInputMode, useStationTestingController } from '@/hooks/useStationTestingController';

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

export interface StationFbaInputProps {
  /** Show the “Station scan” caption and FNSKU routing hint */
  showLabels?: boolean;
  className?: string;
  /**
   * When true, only Amazon FNSKU (X00…) is accepted — no tracking, SKU (with `:`), RS-, or serial.
   * Used by the FBA workspace sidebar scan field.
   */
  fbaScanOnly?: boolean;
}

function normalizeFnsku(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export default function StationFbaInput({
  showLabels = true,
  className = '',
  fbaScanOnly = false,
}: StationFbaInputProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const staffIdRaw = String(searchParams.get('staffId') || '').trim();
  const userId = /^\d+$/.test(staffIdRaw) ? staffIdRaw : '1';

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

  const handleFormSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const raw = inputValue;
      const trimmed = raw.trim();
      if (!trimmed) return;

      if (fbaScanOnly && getStationInputMode(raw) !== 'fba') {
        setFbaError('FNSKU only (X00…). No tracking, SKU, RS-, or serial in this field.');
        return;
      }

      if (getStationInputMode(raw) === 'fba') {
        setInputValue('');
        void handleFnskuPlanFlow(raw);
        return;
      }

      setFbaFeedback(null);
      setFbaError(null);
      setPlanHint(null);
      void handleSubmit(undefined, undefined, undefined);
    },
    [inputValue, handleFnskuPlanFlow, handleSubmit, setInputValue, fbaScanOnly]
  );

  const scanError = fbaScanOnly ? fbaError : trackingNotFoundAlert || errorMessage || fbaError;
  const busy = fbaScanOnly ? isFbaLoading : isLoading || isFbaLoading;

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
        onChange={setInputValue}
        onSubmit={handleFormSubmit}
        inputRef={inputRef}
        placeholder={fbaScanOnly ? 'FNSKU (X00…)' : 'FNSKU, tracking, RS-, serial'}
        autoFocus={false}
        hasRightContent={busy}
        icon={<Package className={`h-4 w-4 ${fbaScanOnly ? 'text-pink-600' : 'text-violet-600'}`} />}
        iconClassName=""
        inputClassName={
          fbaScanOnly
            ? '!py-2.5 !text-sm !rounded-xl !font-bold !text-pink-700 placeholder:text-pink-400 focus:border-pink-400 focus:ring-2 focus:ring-pink-500/25'
            : '!py-2.5 !text-sm !rounded-xl focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20'
        }
        rightContentClassName="right-2"
        rightContent={
          busy ? (
            <Loader2
              className={`h-4 w-4 shrink-0 animate-spin ${fbaScanOnly ? 'text-pink-600' : 'text-zinc-600'}`}
            />
          ) : null
        }
      />

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
