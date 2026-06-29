'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { fbaPaths } from '@/lib/fba/api-paths';
import { FBA_SCAN_STATUS } from '@/lib/fba/events';
import { FBA_FNSKU_SAVED_EVENT } from '@/components/fba/FbaQuickAddFnskuModal';
import { usePendingCatalog } from '@/components/fba/hooks/usePendingCatalog';
import {
  todayShipmentQtyByFnskuFromJson,
  todayShipmentSnapshotFromJson,
  PLAN_QTY_MAX,
  type BulkScanCandidate,
  type PlanPreviewLine,
  type TodayItemSnapshot,
} from '@/lib/fba/plan-helpers';
import { useTodayPlan } from '@/components/fba/hooks/useTodayPlan';
import {
  fbaWorkspaceScanChrome,
  getStaffThemeById,
  stationScanInputBorderClass,
  type StationTheme,
} from '@/utils/staff-colors';
import { useFbaPlanFlows } from './useFbaPlanFlows';
import { useFbaSelectMode } from './useFbaSelectMode';
import { useFbaScanRouting } from './useFbaScanRouting';

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
  /**
   * When true, ignore `?plan=` so scans always use today’s-plan review + `/shipments/today/items`
   * (sidebar scan should not POST directly to the URL plan).
   */
  ignoreUrlPlan?: boolean;
  /**
   * Locks the scan flow to one mode and shows only that mode's button:
   *   'plan'   — plan page: FNSKU adds/updates today's plan.
   *   'select' — combine page: FNSKU selects packed items for combining.
   * When omitted, both buttons show and the user can toggle (legacy).
   */
  scanMode?: 'plan' | 'select';
  /**
   * Sidebar header band (40px scan row + pills below). Drops the inner halo
   * wrapper so the parent `receivingScanBandClass` owns tint + height.
   */
  sidebarHeaderBand?: boolean;
}

/**
 * Owns the entire FBA station scan flow: FNSKU/ASIN parsing, the plan-vs-select
 * mode, today's-plan review queue, plan-line qty patching, and the cross-component
 * window-event wiring (board selection, paired review, quick-add saves). Returns
 * a controller bag the thin `StationFbaInput` shell renders from.
 *
 * Thin controller: the heavy lifting lives in three composed sub-hooks —
 * {@link useFbaPlanFlows} (plan-write network flows), {@link useFbaSelectMode}
 * (combine/select board state + flow), and {@link useFbaScanRouting} (raw-scan
 * classification + dispatch). This hook owns the shared state + chrome and wires
 * them together.
 */
export function useFbaStationInput({
  fbaScanOnly = false,
  inputBorderClassName,
  workspaceTheme: workspaceThemeProp,
  ignoreUrlPlan = false,
  scanMode,
  sidebarHeaderBand = false,
}: StationFbaInputProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Theme color is keyed off the signed-in staff. Identity comes from the
  // verified session cookie, not the URL.
  const { user } = useAuth();
  const staffIdRaw = user?.staffId != null ? String(user.staffId) : '';
  const stationTheme = useMemo((): StationTheme => {
    if (workspaceThemeProp) return workspaceThemeProp;
    return getStaffThemeById(staffIdRaw || null);
  }, [workspaceThemeProp, staffIdRaw]);
  const workspaceChrome = fbaWorkspaceScanChrome[stationTheme];
  const scanOutlineClass =
    inputBorderClassName ?? stationScanInputBorderClass[stationTheme];

  const planParam = searchParams.get('plan');
  const openPlanId = useMemo(() => {
    if (ignoreUrlPlan) return null;
    const planIdNum = planParam ? Number(planParam) : NaN;
    return Number.isFinite(planIdNum) && planIdNum > 0 ? planIdNum : null;
  }, [ignoreUrlPlan, planParam]);

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

  const fetchTodayQtyMap = useCallback(async (): Promise<Record<string, number>> => {
    try {
      const res = await fetch(fbaPaths.today());
      const data = await res.json().catch(() => ({}));
      return todayShipmentQtyByFnskuFromJson(data);
    } catch {
      return {};
    }
  }, []);

  const fetchTodayShipmentSnapshot = useCallback(async () => {
    try {
      const res = await fetch(fbaPaths.today());
      const data = await res.json().catch(() => ({}));
      return todayShipmentSnapshotFromJson(data);
    } catch {
      return { shipmentId: null as number | null, shipmentRef: '', itemByFnsku: {} as Record<string, TodayItemSnapshot> };
    }
  }, []);

  const [fbaError, setFbaError] = useState<string | null>(null);
  const [planHint, setPlanHint] = useState<string | null>(null);
  const [isFbaLoading, setIsFbaLoading] = useState(false);
  const [fbaMode, setFbaMode] = useState<'plan' | 'select'>(scanMode ?? 'plan');
  // When the page locks the mode (plan vs combine), keep the flow pinned to it.
  useEffect(() => {
    if (scanMode) setFbaMode(scanMode);
  }, [scanMode]);
  /** Last line(s) successfully added in plan mode — shown under the scan bar. */
  const [planPreviewLines, setPlanPreviewLines] = useState<PlanPreviewLine[]>([]);
  /** No `?plan=` — lines queue here for qty review before POST to today’s plan. */
  const [pendingTodayPlanRows, setPendingTodayPlanRows] = useState<BulkScanCandidate[] | null>(null);
  /** Last fetch from GET /api/fba/shipments/today — used for “Update plan” vs “Add to plan” + micro copy. */
  const [todayPlanQtyByFnsku, setTodayPlanQtyByFnsku] = useState<Record<string, number>>({});
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const clearPendingTodayPlan = useCallback(() => {
    setPendingTodayPlanRows(null);
    setTodayPlanQtyByFnsku({});
  }, []);

  useEffect(() => {
    if (openPlanId != null) {
      setPendingTodayPlanRows(null);
      setTodayPlanQtyByFnsku({});
    }
  }, [openPlanId]);

  useEffect(() => {
    if (pendingTodayPlanRows == null) {
      setTodayPlanQtyByFnsku({});
    }
  }, [pendingTodayPlanRows]);

  // Auto-clear planHint after 3s so microcopy reverts to default mode text.
  useEffect(() => {
    if (!planHint || !fbaScanOnly) return;
    const id = window.setTimeout(() => setPlanHint(null), 3000);
    return () => window.clearTimeout(id);
  }, [planHint, fbaScanOnly]);

  // Listen for status messages from other FBA components (e.g. paired review save).
  useEffect(() => {
    if (!fbaScanOnly) return;
    const handler = (e: Event) => {
      const msg = (e as CustomEvent<string>).detail;
      if (msg) setPlanHint(msg);
    };
    window.addEventListener(FBA_SCAN_STATUS, handler);
    return () => window.removeEventListener(FBA_SCAN_STATUS, handler);
  }, [fbaScanOnly]);

  // When user saves FNSKU details via modal, update the pending row title in real-time.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ fnsku: string; product_title: string | null; asin: string | null; sku: string | null }>).detail;
      if (!detail?.fnsku) return;
      const key = detail.fnsku.toUpperCase();
      setPendingTodayPlanRows((prev) => {
        if (!prev) return prev;
        let changed = false;
        const next = prev.map((r) => {
          if (r.fnsku.toUpperCase() !== key) return r;
          changed = true;
          return {
            ...r,
            product_title: detail.product_title ?? r.product_title,
            asin: detail.asin ?? r.asin,
            sku: detail.sku ?? r.sku,
            found: true,
            needs_details: false,
            upserted_stub: false,
          };
        });
        return changed ? next : prev;
      });
      // Also update plan preview lines if visible
      setPlanPreviewLines((prev) =>
        prev.map((line) =>
          line.fnsku.toUpperCase() === key && detail.product_title
            ? { ...line, displayTitle: detail.product_title }
            : line,
        ),
      );
    };
    window.addEventListener(FBA_FNSKU_SAVED_EVENT, handler as EventListener);
    return () => window.removeEventListener(FBA_FNSKU_SAVED_EVENT, handler as EventListener);
  }, []);

  const { patchPlanLineQty, handleFnskuPlanFlow, handleBulkFnskuPlanFlow } = useFbaPlanFlows({
    openPlanId,
    fbaScanOnly,
    ignoreUrlPlan,
    router,
    searchParams,
    inputRef,
    setInputValue,
    setFbaError,
    setPlanHint,
    setIsFbaLoading,
    setTodayPlanQtyByFnsku,
    setPendingTodayPlanRows,
    setPlanPreviewLines,
    addFnskus,
    addPending,
    bumpFbaRefresh,
    fetchTodayQtyMap,
    fetchTodayShipmentSnapshot,
  });

  const { selectedCount, selectedQty, handleFnskuSelectFlow, setSelectResult } = useFbaSelectMode({
    fbaScanOnly,
    fbaMode,
    setFbaError,
    setPlanHint,
    setInputValue,
    inputRef,
  });

  const { handleInputChange, handleFormSubmit } = useFbaScanRouting({
    inputValue,
    setInputValue,
    fbaScanOnly,
    fbaMode,
    openPlanId,
    setFbaError,
    setPlanHint,
    setTodayPlanQtyByFnsku,
    setPendingTodayPlanRows,
    fetchTodayQtyMap,
    handleFnskuPlanFlow,
    handleBulkFnskuPlanFlow,
    handleFnskuSelectFlow,
  });

  const patchPendingTodayQty = useCallback((fnsku: string, nextQty: number) => {
    setPendingTodayPlanRows((prev) => {
      if (!prev) return null;
      if (nextQty <= 0) {
        const next = prev.filter((r) => r.fnsku !== fnsku);
        return next.length === 0 ? null : next;
      }
      return prev.map((r) =>
        r.fnsku === fnsku ? { ...r, qty: Math.min(PLAN_QTY_MAX, nextQty) } : r,
      );
    });
  }, []);

  const pendingTodayTouchesExistingLine = useMemo(
    () =>
      (pendingTodayPlanRows ?? []).some(
        (r) => (todayPlanQtyByFnsku[r.fnsku] ?? 0) > 0,
      ),
    [pendingTodayPlanRows, todayPlanQtyByFnsku],
  );
  const pendingNotInPlanCount = useMemo(
    () => (pendingTodayPlanRows ?? []).filter((r) => (todayPlanQtyByFnsku[r.fnsku] ?? 0) <= 0).length,
    [pendingTodayPlanRows, todayPlanQtyByFnsku],
  );

  const scanError = fbaError;
  const busy = isFbaLoading;

  const routingHint = openPlanId
    ? 'FNSKU adds to the open plan. No plan selected → FNSKU starts a new plan.'
    : 'FNSKU starts a new plan. Select a plan in the list to add lines there instead.';

  const fbaOnlyHint =
    fbaMode === 'select'
      ? selectedCount > 0
        ? `${selectedCount} FNSKU${selectedCount !== 1 ? 's' : ''} selected · ${selectedQty} unit${selectedQty !== 1 ? 's' : ''}. Scan more or attach tracking below.`
        : 'Scan FNSKU or ASIN to select for combining shipment.'
      : pendingTodayPlanRows && pendingTodayPlanRows.length > 0
      ? pendingNotInPlanCount > 0
        ? `${pendingNotInPlanCount} currently not in plan. Review qty, then Add to plan.`
        : 'Review qty, then Update plan.'
      : 'Scan FNSKU (X00…) or ASIN (B0…) to add to today’s plan.';

  const hasSidebarStatusRow =
    fbaScanOnly && (isFbaLoading || !!planHint || selectedCount > 0);
  const hasPendingPlanQueue =
    fbaScanOnly && fbaMode === 'plan' && !!pendingTodayPlanRows && pendingTodayPlanRows.length > 0;
  const stackBelowScan =
    !sidebarHeaderBand || hasSidebarStatusRow || hasPendingPlanQueue;

  return {
    // derived chrome
    stationTheme,
    workspaceChrome,
    scanOutlineClass,
    // scan input
    inputValue,
    inputRef,
    handleInputChange,
    handleFormSubmit,
    busy,
    fbaMode,
    setFbaMode,
    setSelectResult,
    setPlanHint,
    setFbaError,
    setPlanPreviewLines,
    clearPendingTodayPlan,
    // status
    isFbaLoading,
    planHint,
    selectedCount,
    selectedQty,
    // data + handlers
    pendingTodayPlanRows,
    todayPlanQtyByFnsku,
    planPreviewLines,
    patchPendingTodayQty,
    patchPlanLineQty,
    handleBulkFnskuPlanFlow,
    pendingTodayTouchesExistingLine,
    // hints + layout
    routingHint,
    fbaOnlyHint,
    scanError,
    hasSidebarStatusRow,
    hasPendingPlanQueue,
    stackBelowScan,
  };
}

export type FbaStationInputController = ReturnType<typeof useFbaStationInput>;
