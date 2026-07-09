'use client';

import {
  useCallback,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { useRouter, useSearchParams } from 'next/navigation';
import { fbaPaths } from '@/lib/fba/api-paths';
import { normalizeFnsku } from '@/lib/tracking-format';
import {
  mergeIntoPendingToday,
  PLAN_QTY_MAX,
  type BulkScanCandidate,
  type PlanPreviewLine,
  type TodayItemSnapshot,
  type ValidatedFnskuRow,
} from '@/lib/fba/plan-helpers';

type TodayShipmentSnapshot = {
  shipmentId: number | null;
  shipmentRef: string;
  itemByFnsku: Record<string, TodayItemSnapshot>;
};

interface FbaPlanFlowsDeps {
  openPlanId: number | null;
  fbaScanOnly: boolean;
  ignoreUrlPlan: boolean;
  router: ReturnType<typeof useRouter>;
  searchParams: ReturnType<typeof useSearchParams>;
  inputRef: RefObject<HTMLInputElement | null>;
  setInputValue: Dispatch<SetStateAction<string>>;
  setFbaError: Dispatch<SetStateAction<string | null>>;
  setPlanHint: Dispatch<SetStateAction<string | null>>;
  setIsFbaLoading: Dispatch<SetStateAction<boolean>>;
  setTodayPlanQtyByFnsku: Dispatch<SetStateAction<Record<string, number>>>;
  setPendingTodayPlanRows: Dispatch<SetStateAction<BulkScanCandidate[] | null>>;
  setPlanPreviewLines: Dispatch<SetStateAction<PlanPreviewLine[]>>;
  addFnskus: (fnskus: string[]) => void;
  addPending: (fnskus: string[]) => void;
  bumpFbaRefresh: () => void;
  fetchTodayQtyMap: () => Promise<Record<string, number>>;
  fetchTodayShipmentSnapshot: () => Promise<TodayShipmentSnapshot>;
}

/**
 * The FBA plan-write network flows split out of {@link useFbaStationInput}:
 * single + bulk FNSKU plan adds, the pending-today review submit (PATCH lines
 * already on today, POST only new / moved-from-other), and the plan-preview
 * line qty patch. All shared controller state flows in via the passed setters,
 * so this hook owns no state of its own.
 */
export function useFbaPlanFlows({
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
}: FbaPlanFlowsDeps) {
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
            setPlanHint('Already on today’s plan');
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

  return { patchPlanLineQty, handleFnskuPlanFlow, handleBulkFnskuPlanFlow };
}
