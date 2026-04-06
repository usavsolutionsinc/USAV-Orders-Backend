'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { fbaPaths } from '@/lib/fba/api-paths';
import { FBA_BOARD_INJECT_ITEM, FBA_SELECTION_ADJUSTED, FBA_SCAN_STATUS } from '@/lib/fba/events';
import { AlertCircle, Loader2, Minus, Package, Plus } from '@/components/Icons';
import type { FbaBoardItem } from '@/components/fba/FbaBoardTable';
import { FbaSelectedLineRow } from '@/components/fba/sidebar/FbaSelectedLineRow';
import { emitOpenQuickAddFnsku, FBA_FNSKU_SAVED_EVENT } from '@/components/fba/FbaQuickAddFnskuModal';
import { StationScanBar } from '@/components/station/StationScanBar';
import { DeferredQtyInput } from '@/design-system/primitives';
import { usePendingCatalog } from '@/components/fba/hooks/usePendingCatalog';
import { useFbaBoardSelection } from '@/components/fba/hooks/useFbaBoardSelection';
import { normalizeFnsku } from '@/lib/tracking-format';
import {
  todayShipmentQtyByFnskuFromJson,
  todayShipmentSnapshotFromJson,
  mergeIntoPendingToday,
  extractFnskuCounts,
  PLAN_QTY_MAX,
  type ValidatedFnskuRow,
  type BulkScanCandidate,
  type PlanPreviewLine,
  type TodayItemSnapshot,
} from '@/lib/fba/plan-helpers';
import { useTodayPlan } from '@/components/fba/hooks/useTodayPlan';
import { looksLikeFnsku, looksLikeFnskuPrefix } from '@/lib/scan-resolver';
import {
  fbaWorkspaceScanChrome,
  getStaffThemeById,
  stationScanInputBorderClass,
  type StationTheme,
} from '@/utils/staff-colors';

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
  /**
   * When true, ignore `?plan=` so scans always use today’s-plan review + `/shipments/today/items`
   * (sidebar scan should not POST directly to the URL plan).
   */
  ignoreUrlPlan?: boolean;
}


export default function StationFbaInput({
  showLabels = true,
  className = '',
  fbaScanOnly = false,
  inputBorderClassName,
  workspaceTheme: workspaceThemeProp,
  techStaffIdOverride,
  ignoreUrlPlan = false,
}: StationFbaInputProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const staffIdRaw = String(searchParams.get('staffId') || '').trim();
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
  const [fbaMode, setFbaMode] = useState<'plan' | 'select'>('plan');
  const [selectResult, setSelectResult] = useState<FnskuSelectResult | null>(null);
  const [selectModeItems, setSelectModeItems] = useState<FbaBoardItem[]>([]);
  /** Last line(s) successfully added in plan mode — shown under the scan bar. */
  const [planPreviewLines, setPlanPreviewLines] = useState<PlanPreviewLine[]>([]);
  /** No `?plan=` — lines queue here for qty review before POST to today’s plan. */
  const [pendingTodayPlanRows, setPendingTodayPlanRows] = useState<BulkScanCandidate[] | null>(null);
  /** Last fetch from GET /api/fba/shipments/today — used for “Update plan” vs “Add to plan” + micro copy. */
  const [todayPlanQtyByFnsku, setTodayPlanQtyByFnsku] = useState<Record<string, number>>({});

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

  useEffect(() => {
    if (fbaMode !== 'select') {
      setSelectModeItems([]);
      setSelectResult(null);
    }
  }, [fbaMode]);

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

  const boardSelection = useFbaBoardSelection({ includePairedSelection: true });

  // Single state for selection counts. Board writes it, panel overwrites with adjusted qtys.
  const [selCounts, setSelCounts] = useState({ selected: 0, total: 0, selectedQty: 0, totalQty: 0 });
  useEffect(() => {
    const boardHandler = (e: Event) => {
      const c = (e as CustomEvent<typeof selCounts>).detail;
      if (c) setSelCounts(c);
    };
    const adjustedHandler = (e: Event) => {
      const a = (e as CustomEvent<{ selected: number; selectedQty: number }>).detail;
      if (a) setSelCounts((prev) => ({ ...prev, selected: a.selected, selectedQty: a.selectedQty }));
    };
    window.addEventListener('fba-board-selection-count', boardHandler);
    window.addEventListener(FBA_SELECTION_ADJUSTED, adjustedHandler);
    return () => {
      window.removeEventListener('fba-board-selection-count', boardHandler);
      window.removeEventListener(FBA_SELECTION_ADJUSTED, adjustedHandler);
    };
  }, []);

  // Bubble select-mode fallback items to parent so its FbaPairedReviewPanel sees them.
  useEffect(() => {
    if (selectModeItems.length === 0) return;
    const byId = new Map<number, FbaBoardItem>();
    for (const row of boardSelection) byId.set(row.item_id, row);
    for (const row of selectModeItems) byId.set(row.item_id, row);
    const merged = Array.from(byId.values());
    window.dispatchEvent(new CustomEvent('fba-paired-selection', { detail: merged }));
  }, [selectModeItems]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchPlanLineQty = useCallback(
    async (line: PlanPreviewLine, nextQty: number) => {
      const { shipmentId: sid, itemId: iid } = line;
      if (nextQty <= 0) {
        const res = await fetch(fbaPaths.planItem(sid, iid), { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          setFbaError(data?.error || 'Could not remove line');
          return;
        }
        setPlanPreviewLines((prev) => prev.filter((p) => p.itemId !== iid));
        bumpFbaRefresh();
        window.dispatchEvent(new CustomEvent('fba-print-queue-refresh'));
        window.dispatchEvent(new Event('fba-plan-created'));
        return;
      }
      const res = await fetch(fbaPaths.planItem(sid, iid), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_qty: Math.min(PLAN_QTY_MAX, nextQty) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setFbaError(data?.error || 'Could not update quantity');
        return;
      }
      const q = Number(data.item?.expected_qty ?? nextQty);
      setPlanPreviewLines((prev) =>
        prev.map((p) => (p.itemId === iid ? { ...p, expectedQty: q } : p)),
      );
      bumpFbaRefresh();
      window.dispatchEvent(new CustomEvent('fba-print-queue-refresh'));
    },
    [bumpFbaRefresh],
  );

  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFnskuSelectFlow = useCallback(
    (raw: string) => {
      const fnsku = normalizeFnsku(raw);
      if (!fnsku) return;
      setFbaError(null);
      setPlanHint(null);
      setSelectResult(null);
      window.dispatchEvent(new CustomEvent('fba-board-select-by-fnsku', { detail: fnsku }));
      setInputValue('');
      inputRef.current?.focus();
    },
    [setInputValue, inputRef],
  );

  const fetchSelectableBoardRows = useCallback(async (fnsku: string): Promise<FbaBoardItem[]> => {
    try {
      const res = await fetch('/api/fba/board', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      const pending = Array.isArray(data?.pending) ? (data.pending as FbaBoardItem[]) : [];
      const key = normalizeFnsku(fnsku);
      if (!key) return [];
      // Match by FNSKU or ASIN — a B0 ASIN scan should find items with that ASIN.
      return pending.filter(
        (row) => normalizeFnsku(String(row.fnsku || '')) === key
          || (row.asin && normalizeFnsku(String(row.asin)) === key),
      );
    } catch {
      return [];
    }
  }, []);

  /** Pending panel + single-scan add: PATCH lines already on today; POST only new / moved-from-other. */
  const submitPendingTodayPlan = useCallback(
    async (addableRows: BulkScanCandidate[], missingFnskus: string[]) => {
      try {
        const snap = await fetchTodayShipmentSnapshot();
        const toPatch: BulkScanCandidate[] = [];
        const toPost: BulkScanCandidate[] = [];
        for (const r of addableRows) {
          if (snap.itemByFnsku[r.fnsku]) toPatch.push(r);
          else toPost.push(r);
        }

        type LineHead = { fnsku: string; expected_qty: number; item_id: number; display_title: string };
        const patchResults: LineHead[] = [];

        for (const r of toPatch) {
          const sid = snap.shipmentId;
          const meta = snap.itemByFnsku[r.fnsku];
          if (!sid || !meta) {
            setFbaError('Plan data is out of date — try again.');
            return;
          }
          const res = await fetch(fbaPaths.planItem(sid, meta.id), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expected_qty: Math.min(PLAN_QTY_MAX, r.qty) }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) {
            setFbaError(data?.error || `Could not update ${r.fnsku}.`);
            return;
          }
          const item = data.item as { id?: number; fnsku?: string; expected_qty?: number; product_title?: string | null } | undefined;
          const displayTitle =
            (r.product_title && String(r.product_title).trim()) ||
            (item?.product_title && String(item.product_title).trim()) ||
            meta.display_title ||
            r.fnsku;
          patchResults.push({
            fnsku: r.fnsku,
            expected_qty: Math.max(1, Number(item?.expected_qty ?? r.qty) || 1),
            item_id: Number(item?.id ?? meta.id),
            display_title: displayTitle,
          });
        }

        let postShipmentId: number | null = null;
        let postShipmentRef = '';
        const postAdded: LineHead[] = [];
        const postMerged: LineHead[] = [];
        const postMoved: LineHead[] = [];

        if (toPost.length > 0) {
          const res = await fetch(fbaPaths.todayItems(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: toPost.map((row) => ({
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
          postShipmentId = Number(data.shipment_id);
          postShipmentRef = String(data.shipment_ref ?? data.plan_ref ?? '');
          if (Array.isArray(data.merged)) postMerged.push(...data.merged);
          if (Array.isArray(data.added)) postAdded.push(...data.added);
          if (Array.isArray(data.moved)) postMoved.push(...data.moved);
        }

        const byItemId = new Map<number, LineHead>();
        for (const h of patchResults) byItemId.set(Number(h.item_id), h);
        for (const h of [...postAdded, ...postMerged, ...postMoved]) {
          byItemId.set(Number(h.item_id), h);
        }
        const lineRows = Array.from(byItemId.values());
        const lineCount = lineRows.length;
        const shipmentId =
          Number.isFinite(postShipmentId) && postShipmentId! > 0
            ? postShipmentId!
            : snap.shipmentId;

        if (lineCount === 0 || !shipmentId || shipmentId < 1) {
          setFbaError('Plan updated but response was incomplete.');
          return;
        }

        const shipmentRef = postShipmentRef || snap.shipmentRef;

        setPlanPreviewLines(
          lineRows.map((h) => ({
            itemId: Number(h.item_id),
            shipmentId,
            displayTitle: String(h.display_title || h.fnsku),
            fnsku: h.fnsku,
            expectedQty: Math.max(1, Number(h.expected_qty) || 1),
          })),
        );
        {
          const hint = missingFnskus.length > 0
            ? `Added ${lineCount} item${lineCount !== 1 ? 's' : ''} — some need details`
            : `Added ${lineCount} item${lineCount !== 1 ? 's' : ''} to plan`;
          setPlanHint(hint);
        }
        addFnskus(addableRows.map((row) => row.fnsku));
        if (!ignoreUrlPlan) {
          const params = new URLSearchParams(searchParams.toString());
          params.set('plan', String(shipmentId));
          params.delete('draft');
          params.set('r', String(Date.now()));
          router.replace(`/fba?${params.toString()}`);
        } else {
          bumpFbaRefresh();
        }
        window.dispatchEvent(new Event('fba-plan-created'));
        window.dispatchEvent(new CustomEvent('fba-print-queue-refresh'));

        setInputValue('');
      } catch {
        setFbaError('Network error - try again.');
      }
    },
    [
      addFnskus,

      bumpFbaRefresh,
      fbaScanOnly,
      fetchTodayShipmentSnapshot,
      ignoreUrlPlan,
      router,
      searchParams,
      setInputValue,
    ],
  );

  const handleFnskuPlanFlow = useCallback(
    async (raw: string) => {
      const fnsku = normalizeFnsku(raw);
      if (!fnsku) return;

      setIsFbaLoading(true);
      setFbaError(null);
      setPlanHint(null);

      try {
        // Single validate call with persist_missing=1 — creates stub if not in catalog.
        // For fbaScanOnly, fetch today's qty map in parallel to cut latency.
        const validatePromise = fetch(
          `/api/fba/fnskus/validate?fnskus=${encodeURIComponent(fnsku)}&persist_missing=1`
        ).then((r) => r.json().catch(() => ({})));
        const todayMapPromise = fbaScanOnly ? fetchTodayQtyMap() : Promise.resolve({} as Record<string, number>);

        const [validateJson, todayMap] = await Promise.all([validatePromise, todayMapPromise]);
        const row = Array.isArray(validateJson?.results) ? (validateJson.results[0] as ValidatedFnskuRow) : null;

        const needsDetails = !row?.found;
        if (needsDetails) addPending([fnsku]);

        // B0-prefixed FNSKUs are ASINs — always populate the asin field
        const isAsin = /^B0[A-Z0-9]{8}$/i.test(fnsku);
        const resolvedAsin = row?.asin ?? (isAsin ? fnsku : null);

        // FBA sidebar scan should always queue for qty review before updating today's plan.
        if (fbaScanOnly) {
          setTodayPlanQtyByFnsku(todayMap);
          const newRow: BulkScanCandidate = {
            fnsku,
            qty: 1,
            found: !!row?.found,
            catalog_exists: row?.catalog_exists,
            needs_details: row?.needs_details,
            upserted_stub: row?.upserted_stub,
            product_title: row?.product_title ?? null,
            asin: resolvedAsin,
            sku: row?.sku ?? null,
          };
          setPendingTodayPlanRows((prev) => mergeIntoPendingToday(prev, newRow, todayMap));
          setPlanPreviewLines([]);
          return;
        }

        if (openPlanId) {
          const res = await fetch(fbaPaths.planItems(openPlanId), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fnsku,
              expected_qty: 1,
              product_title: row?.product_title ?? null,
              asin: resolvedAsin,
              sku: row?.sku ?? null,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data?.success === false) {
            setFbaError(data.error || 'Could not add line to this plan.');
            return;
          }
          const item = data.item as { id?: number; fnsku?: string; expected_qty?: number; product_title?: string | null } | undefined;
          if (!item?.id) {
            setFbaError('Plan updated but response was incomplete.');
            return;
          }
          addFnskus([fnsku]);
          setPlanHint(needsDetails ? 'Added — details pending' : 'Added to plan');
          setPlanPreviewLines([{
            itemId: Number(item.id),
            shipmentId: openPlanId,
            displayTitle:
              (row?.product_title && String(row.product_title).trim())
              || (item.product_title && String(item.product_title).trim())
              || String(item.fnsku || fnsku),
            fnsku: String(item.fnsku || fnsku),
            expectedQty: Math.max(1, Number(item.expected_qty) || 1),
          }]);
          window.dispatchEvent(new CustomEvent('fba-print-queue-refresh'));
          window.dispatchEvent(new Event('fba-plan-created'));
          bumpFbaRefresh();

        } else {
          const map = await fetchTodayQtyMap();
          if ((map[fnsku] ?? 0) > 0) {
            setPlanHint('Already on today\u2019s plan');
            addFnskus([fnsku]);
            bumpFbaRefresh();
            window.dispatchEvent(new Event('fba-plan-created'));
  
            return;
          }
          const newRow: BulkScanCandidate = {
            fnsku,
            qty: 1,
            found: !!row?.found,
            catalog_exists: row?.catalog_exists,
            needs_details: row?.needs_details,
            upserted_stub: row?.upserted_stub,
            product_title: row?.product_title ?? null,
            asin: resolvedAsin,
            sku: row?.sku ?? null,
          };
          await submitPendingTodayPlan([newRow], needsDetails ? [fnsku] : []);
        }
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

      fbaScanOnly,
      setInputValue,
      inputRef,
      fetchTodayQtyMap,
      submitPendingTodayPlan,
    ]
  );

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<FnskuSelectResult>).detail;
      if (!detail) return;

      if (!fbaScanOnly || fbaMode !== 'select') {
        setSelectResult(detail);
        return;
      }

      if (detail.found) {
        setSelectResult(detail);
        return;
      }

      void (async () => {
        const fallbackRows = await fetchSelectableBoardRows(detail.fnsku);
        if (fallbackRows.length > 0) {
          setSelectModeItems((prev) => {
            const byId = new Map<number, FbaBoardItem>();
            for (const row of prev) byId.set(row.item_id, row);
            for (const row of fallbackRows) byId.set(row.item_id, row);
            return Array.from(byId.values());
          });
          setSelectResult({
            fnsku: detail.fnsku,
            found: true,
            count: fallbackRows.length,
            title: fallbackRows[0]?.display_title,
          });
          return;
        }

        // Not on board — auto-add 1 to today's plan, then select it.
        // Stay in select mode so the label printer flow isn't interrupted.
        try {
          const res = await fetch(fbaPaths.todayItems(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: [{ fnsku: detail.fnsku, expected_qty: 1 }],
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data?.success !== false) {
            // Build a FbaBoardItem from the response and inject it directly.
            const added = data.added?.[0] || data.merged?.[0] || data.moved?.[0];
            const newItem: FbaBoardItem = {
              item_id: Number(added?.item_id ?? 0),
              fnsku: detail.fnsku,
              expected_qty: 1,
              actual_qty: 0,
              item_status: 'PLANNED',
              display_title: String(added?.display_title || detail.fnsku),
              asin: null,
              sku: null,
              item_notes: null,
              shipment_id: Number(data.shipment_id ?? 0),
              shipment_ref: String(data.shipment_ref ?? ''),
              amazon_shipment_id: null,
              due_date: new Date().toISOString().slice(0, 10),
              shipment_status: 'PLANNED',
              destination_fc: null,
              tracking_numbers: [],
              condition: null,
            };

            // Inject into board without full refresh, then immediately select.
            window.dispatchEvent(new CustomEvent(FBA_BOARD_INJECT_ITEM, { detail: newItem }));
            window.dispatchEvent(new CustomEvent('fba-board-select-by-fnsku', { detail: detail.fnsku }));

            setSelectResult({ fnsku: detail.fnsku, found: true, count: 1, title: newItem.display_title });
            setPlanHint('Added to plan + selected');
          } else {
            setFbaError(data?.error || 'Could not auto-add to plan');
          }
        } catch {
          setFbaError('Network error — could not auto-add to plan');
        }
      })();
    };
    window.addEventListener('fba-board-fnsku-select-result', handler as EventListener);
    return () => window.removeEventListener('fba-board-fnsku-select-result', handler as EventListener);
  }, [fbaScanOnly, fbaMode, fetchSelectableBoardRows]);

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
      setFbaError(null);
      setPlanHint(null);
      try {
        if (!openPlanId || fbaScanOnly) {
          await submitPendingTodayPlan(addableRows, missingFnskus);
          return;
        }

        const previewAccum: PlanPreviewLine[] = [];
        for (const row of addableRows) {
          const res = await fetch(fbaPaths.planItems(openPlanId), {
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
          const item = data.item as { id?: number; fnsku?: string; expected_qty?: number; product_title?: string | null } | undefined;
          if (!item?.id) {
            setFbaError('Plan updated but response was incomplete.');
            return;
          }
          previewAccum.push({
            itemId: Number(item.id),
            shipmentId: openPlanId,
            displayTitle:
              (row.product_title && String(row.product_title).trim())
              || (item.product_title && String(item.product_title).trim())
              || String(item.fnsku || row.fnsku),
            fnsku: String(item.fnsku || row.fnsku),
            expectedQty: Math.max(1, Number(item.expected_qty) || 1),
          });
        }
        setPlanPreviewLines(previewAccum);
        {
          const count = addableRows.length;
          const hint = missingFnskus.length > 0
            ? `Added ${count} item${count !== 1 ? 's' : ''} — some need details`
            : `Added ${count} item${count !== 1 ? 's' : ''} to plan`;
          setPlanHint(hint);
        }
        addFnskus(addableRows.map((row) => row.fnsku));
        window.dispatchEvent(new CustomEvent('fba-print-queue-refresh'));
        window.dispatchEvent(new Event('fba-plan-created'));
        bumpFbaRefresh();

        setInputValue('');
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

      bumpFbaRefresh,
      fbaScanOnly,
      inputRef,
      openPlanId,
      submitPendingTodayPlan,
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
      }
    },
    [inputValue, handleFnskuPlanFlow, handleFnskuSelectFlow, setInputValue, fbaScanOnly, fbaMode]
  );

  const handleInputChange = useCallback(
    (value: string) => {
      setInputValue(value);
      if (!fbaScanOnly) return;
      setFbaError(null);
      setPlanHint(null);
      const counts = extractFnskuCounts(value);

      // Single FNSKU pasted (no separators) — auto-submit immediately
      if (counts.size === 1 && !/[\s,;|]/.test(value)) {
        const fnsku = Array.from(counts.keys())[0];
        if (looksLikeFnsku(fnsku) && value.trim().length >= 10) {
          setInputValue('');
          if (fbaMode === 'select') {
            handleFnskuSelectFlow(fnsku);
          } else {
            void handleFnskuPlanFlow(fnsku);
          }
          return;
        }
      }

      // Batch paste (multiple FNSKUs or separator-delimited)
      const hasBatch = counts.size > 1 || (counts.size === 1 && /[\s,;|]/.test(value));
      if (hasBatch && counts.size > 0) {
        setInputValue('');
        if (fbaMode === 'select') {
          for (const fnsku of Array.from(counts.keys())) {
            window.dispatchEvent(new CustomEvent('fba-board-select-by-fnsku', { detail: fnsku }));
          }
          return;
        }
        const rows: BulkScanCandidate[] = Array.from(counts.entries()).map(([fnsku, qty]) => ({
          fnsku,
          qty,
          found: false,
          product_title: null,
          asin: null,
          sku: null,
        }));
        if (fbaScanOnly) {
          void (async () => {
            const [map, validateJson] = await Promise.all([
              fetchTodayQtyMap(),
              fetch(`/api/fba/fnskus/validate?fnskus=${encodeURIComponent(Array.from(counts.keys()).join(','))}&persist_missing=1`)
                .then((r) => r.json().catch(() => ({}))),
            ]);
            const enriched = rows.map((row) => {
              const match = Array.isArray(validateJson?.results)
                ? (validateJson.results as ValidatedFnskuRow[]).find((r) => r.fnsku === row.fnsku)
                : null;
              return match
                ? { ...row, found: !!match.found, product_title: match.product_title ?? null, asin: match.asin ?? row.asin, sku: match.sku ?? row.sku }
                : row;
            });
            setTodayPlanQtyByFnsku(map);
            setPendingTodayPlanRows((prev) => mergeIntoPendingToday(prev, enriched, map));
          })();
          return;
        }
        if (!openPlanId) {
          void (async () => {
            const [map, validateJson] = await Promise.all([
              fetchTodayQtyMap(),
              fetch(`/api/fba/fnskus/validate?fnskus=${encodeURIComponent(Array.from(counts.keys()).join(','))}&persist_missing=1`)
                .then((r) => r.json().catch(() => ({}))),
            ]);
            const enriched = rows.map((row) => {
              const match = Array.isArray(validateJson?.results)
                ? (validateJson.results as ValidatedFnskuRow[]).find((r) => r.fnsku === row.fnsku)
                : null;
              return match
                ? { ...row, found: !!match.found, product_title: match.product_title ?? null, asin: match.asin ?? row.asin, sku: match.sku ?? row.sku }
                : row;
            });
            setTodayPlanQtyByFnsku(map);
            setPendingTodayPlanRows((prev) => mergeIntoPendingToday(prev, enriched, map));
          })();
        } else {
          void handleBulkFnskuPlanFlow(rows);
        }
        return;
      }
    },
    [fbaScanOnly, fbaMode, openPlanId, setInputValue, handleBulkFnskuPlanFlow, handleFnskuPlanFlow, handleFnskuSelectFlow, fetchTodayQtyMap]
  );

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

  const selectedCount = selCounts.selected;
  const selectedQty = selCounts.selectedQty;
  const fbaOnlyHint =
    fbaMode === 'select'
      ? selectedCount > 0
        ? `${selectedCount} FNSKU${selectedCount !== 1 ? 's' : ''} selected \u00b7 ${selectedQty} unit${selectedQty !== 1 ? 's' : ''}. Scan more or attach tracking below.`
        : 'Scan FNSKU or ASIN to select for combining shipment.'
      : pendingTodayPlanRows && pendingTodayPlanRows.length > 0
      ? pendingNotInPlanCount > 0
        ? `${pendingNotInPlanCount} currently not in plan. Review qty, then Add to plan.`
        : 'Review qty, then Update plan.'
      : 'Scan FNSKU (X00\u2026) or ASIN (B0\u2026) to add to today\u2019s plan.';

  return (
    <div className={`space-y-2 ${className}`.trim()}>
      {showLabels ? (
        <>
          {fbaScanOnly ? (
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-700">
              Adding To Today Current Plan
            </p>
          ) : (
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Station scan</p>
          )}
          <p className="text-[11px] leading-snug text-zinc-500">{fbaScanOnly ? fbaOnlyHint : routingHint}</p>
        </>
      ) : null}

      <StationScanBar
        value={inputValue}
        onChange={handleInputChange}
        onSubmit={handleFormSubmit}
        inputRef={inputRef}
        inputBorderClassName={scanOutlineClass}
        placeholder={fbaScanOnly ? 'FNSKU (X00\u2026) or ASIN (B0\u2026)' : 'FNSKU, ASIN, tracking, RS-, serial'}
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
        showModeButtons={fbaScanOnly}
        activeMode={fbaMode}
        onPlanMode={() => {
          setFbaMode('plan');
          setSelectResult(null);
        }}
        onSelectMode={() => {
          setFbaMode('select');
          setPlanHint(null);
          setFbaError(null);
          setPlanPreviewLines([]);
          clearPendingTodayPlan();
        }}
        rightContent={
          busy ? (
            <Loader2
              className={`h-4 w-4 shrink-0 animate-spin ${fbaScanOnly ? workspaceChrome.savingSpinner : 'text-zinc-600'}`}
            />
          ) : null
        }
      />

      {fbaScanOnly ? (
        <div className="flex items-center gap-1.5">
          {isFbaLoading ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-gray-400" />
          ) : null}
          <p className={`text-[10px] font-bold uppercase tracking-widest ${
            planHint
              ? 'text-emerald-600'
              : selectedCount > 0
                ? 'text-blue-600'
                : isFbaLoading
                  ? 'text-gray-500'
                  : 'text-gray-400'
          }`}>
            {isFbaLoading
              ? 'Updating plan\u2026'
              : planHint
                ? planHint
                : selectedCount > 0
                  ? `${selectedCount} selected \u00b7 ${selectedQty} unit${selectedQty !== 1 ? 's' : ''}`
                  : fbaMode === 'select'
                    ? 'Scan FNSKU or ASIN to select'
                    : 'Scan to add to today\u2019s plan'}
          </p>
        </div>
      ) : null}

      {fbaScanOnly && fbaMode === 'plan' && pendingTodayPlanRows && pendingTodayPlanRows.length > 0 ? (
        <>
          <div className="divide-y divide-gray-200 overflow-y-auto">
            {pendingTodayPlanRows.map((r) => {
              const title = (r.product_title && String(r.product_title).trim()) || r.fnsku;
              return (
                <FbaSelectedLineRow
                  key={r.fnsku}
                  displayTitle={title}
                  fnsku={r.fnsku}
                  stationTheme={stationTheme}
                  microcopyAboveTitle={
                    r.upserted_stub || r.needs_details
                      ? 'Added to catalog — details pending'
                      : (todayPlanQtyByFnsku[r.fnsku] ?? 0) > 0
                      ? 'Found in FBA plan — edit qty'
                      : undefined
                  }
                  microcopyTone={r.upserted_stub || r.needs_details ? 'success' : 'default'}
                  onEditDetails={() => emitOpenQuickAddFnsku({
                    fnsku: r.fnsku,
                    product_title: r.product_title,
                    asin: r.asin,
                    sku: r.sku,
                  })}
                  rightSlot={
                    <>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          patchPendingTodayQty(r.fnsku, Math.min(PLAN_QTY_MAX, r.qty + 1));
                        }}
                        disabled={r.qty >= PLAN_QTY_MAX}
                        className="flex h-6 w-10 items-center justify-center rounded-t-md border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-40"
                        aria-label={`Increase ${r.fnsku} quantity`}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <DeferredQtyInput
                        value={r.qty}
                        min={0}
                        max={PLAN_QTY_MAX}
                        onChange={(v) => {
                          patchPendingTodayQty(r.fnsku, v);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="h-7 w-10 border-x border-gray-200 bg-white text-center text-[13px] font-black tabular-nums text-gray-900 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          patchPendingTodayQty(r.fnsku, r.qty - 1);
                        }}
                        disabled={r.qty <= 0}
                        className={`flex h-6 w-10 items-center justify-center rounded-b-md border transition-colors ${
                          r.qty <= 1
                            ? 'border-red-300 text-red-500 hover:bg-red-50'
                            : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                        } disabled:opacity-40`}
                        aria-label={`Decrease ${r.fnsku} quantity`}
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                    </>
                  }
                />
              );
            })}
          </div>
          <div className="flex w-full min-w-0 items-center justify-between gap-3 bg-white px-3 py-2.5">
            <button
              type="button"
              disabled={isFbaLoading}
              onClick={() => clearPendingTodayPlan()}
              className="shrink-0 text-[9px] font-black uppercase tracking-[0.12em] text-gray-500 transition-colors hover:text-gray-900 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isFbaLoading}
              onClick={() => {
                if (!pendingTodayPlanRows?.length) return;
                if (pendingTodayPlanRows.every((r) => r.qty <= 0)) {
                  setFbaError('Set a quantity above zero for at least one line.');
                  return;
                }
                const rows = pendingTodayPlanRows;
                clearPendingTodayPlan();
                void handleBulkFnskuPlanFlow(rows);
              }}
              className="shrink-0 rounded-md bg-purple-600 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
            >
              {pendingTodayTouchesExistingLine ? 'Update plan' : 'Add to plan'}
            </button>
          </div>
        </>
      ) : null}

      {!fbaScanOnly && planPreviewLines.length > 0 ? (
        <div className="divide-y divide-gray-200">
          {planPreviewLines.map((line, idx) => (
            <FbaSelectedLineRow
              key={`${line.itemId}-${idx}`}
              displayTitle={line.displayTitle}
              fnsku={line.fnsku}
              stationTheme={stationTheme}
              onEditDetails={() =>
                emitOpenQuickAddFnsku({
                  fnsku: line.fnsku,
                  product_title: line.displayTitle || null,
                  asin: null,
                  sku: null,
                  condition: null,
                })
              }
              rightSlot={
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = Math.min(PLAN_QTY_MAX, line.expectedQty + 1);
                      void patchPlanLineQty(line, next);
                    }}
                    disabled={line.expectedQty >= PLAN_QTY_MAX}
                    className="flex h-6 w-10 items-center justify-center rounded-t-md border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-40"
                    aria-label={`Increase ${line.fnsku} quantity`}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                  <DeferredQtyInput
                    value={line.expectedQty}
                    min={0}
                    max={PLAN_QTY_MAX}
                    onChange={(v) => {
                      void patchPlanLineQty(line, v);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-7 w-10 border-x border-gray-200 bg-white text-center text-[13px] font-black tabular-nums text-gray-900 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void patchPlanLineQty(line, line.expectedQty - 1);
                    }}
                    disabled={line.expectedQty <= 0}
                    className={`flex h-6 w-10 items-center justify-center rounded-b-md border transition-colors ${
                      line.expectedQty <= 1
                        ? 'border-red-300 text-red-500 hover:bg-red-50'
                        : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                    } disabled:opacity-40`}
                    aria-label={`Decrease ${line.fnsku} quantity`}
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                </>
              }
            />
          ))}
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



      {/* FbaPairedReviewPanel removed — the parent FbaSidebar renders it via boardSelection */}
    </div>
  );
}
