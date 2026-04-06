import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fbaPaths } from '@/lib/fba/api-paths';
import { FBA_FNSKU_SAVED_EVENT } from '@/components/fba/FbaQuickAddFnskuModal';
import type { ShipmentTrackingEntry } from '@/components/fba/table/types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DraftItem {
  fnsku: string;
  found: boolean;
  alreadyInPlan: boolean;
  product_title: string | null;
  asin: string | null;
  qty: number;
}

export interface PlanItem {
  id: number;
  fnsku: string;
  display_title: string | null;
  product_title: string | null;
  asin: string | null;
  sku: string | null;
  expected_qty: number;
  status: string;
  notes: string | null;
  ready_by_staff_id: number | null;
  ready_by_name: string | null;
  verified_by_staff_id: number | null;
  verified_by_name: string | null;
}

const PRINT_QUEUE_STATUSES = new Set(['PACKING', 'READY_TO_GO', 'OUT_OF_STOCK', 'LABEL_ASSIGNED', 'SHIPPED']);

function normalizePlanItemStatus(status: string | null | undefined) {
  return String(status || '').trim().toUpperCase();
}

export function isPlanChecklistVisibleItem(item: Pick<PlanItem, 'status'>) {
  return !PRINT_QUEUE_STATUSES.has(normalizePlanItemStatus(item.status));
}

// ─── localStorage helpers ───────────────────────────────────────────────────

export interface StoredPlanSelectionEntry {
  itemId: number | null;
  fnsku: string;
}

function getPlanSelectionStorageKey(planId: number) {
  return `fba-plan-checklist-selection:${planId}`;
}

export function readStoredPlanSelection(planId: number): StoredPlanSelectionEntry[] {
  try {
    const raw = localStorage.getItem(getPlanSelectionStorageKey(planId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => ({
        itemId: Number.isFinite(Number(entry?.itemId)) ? Number(entry.itemId) : null,
        fnsku: String(entry?.fnsku || '').trim().toUpperCase(),
      }))
      .filter((entry) => entry.itemId != null || entry.fnsku);
  } catch {
    return [];
  }
}

export function writeStoredPlanSelection(planId: number, entries: StoredPlanSelectionEntry[]) {
  try {
    if (entries.length === 0) {
      localStorage.removeItem(getPlanSelectionStorageKey(planId));
      return;
    }
    localStorage.setItem(getPlanSelectionStorageKey(planId), JSON.stringify(entries));
  } catch {
    /* no-op */
  }
}

// ─── Status cycling ─────────────────────────────────────────────────────────

const STATUS_CYCLE: Record<string, string> = {
  PLANNED:      'PACKING',
  PACKING:      'READY_TO_GO',
  OUT_OF_STOCK: 'PLANNED',
  READY_TO_GO:  'PLANNED',
};

// ─── Hook options ───────────────────────────────────────────────────────────

interface UseFnskuChecklistDataOptions {
  fnskus: string[];
  planId?: number;
  statusFilter?: string;
  onCreated?: (id: number, ref: string) => void;
  onClear?: () => void;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useFnskuChecklistData({
  fnskus,
  planId,
  statusFilter,
  onCreated,
  onClear,
}: UseFnskuChecklistDataOptions) {
  const isDraftMode = fnskus.length > 0 && !planId;
  const isTodayMode = !planId && fnskus.length === 0;

  // Draft state
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [draftLoading, setDraftLoading] = useState(false);
  const [todayPlanId, setTodayPlanId] = useState<number | null>(null);

  // Plan / today state
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [planLoading, setPlanLoading] = useState(false);
  const [planRef, setPlanRef] = useState('');
  const [planDueDate, setPlanDueDate] = useState<string | null>(null);
  const [planAmazonShipmentId, setPlanAmazonShipmentId] = useState<string | null>(null);
  const [planTrackingNumbers, setPlanTrackingNumbers] = useState<ShipmentTrackingEntry[]>([]);

  // Create state
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const [addedCount, setAddedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);

  // Status cycling
  const [cyclingItemId, setCyclingItemId] = useState<number | null>(null);

  // Notes editing
  const [expandedNoteId, setExpandedNoteId] = useState<number | null>(null);
  const [noteText, setNoteText] = useState('');
  const noteSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Undo toast for move-to-print
  const [undoToast, setUndoToast] = useState<{ itemId: number; label: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const undoRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const savingRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  // ── Draft mode: validate + check today's plan ────────────────────────────
  useEffect(() => {
    if (!isDraftMode) { setDraftItems([]); return; }
    setDraftLoading(true);

    Promise.all([
      fetch(`/api/fba/fnskus/validate?fnskus=${encodeURIComponent(fnskus.join(','))}&persist_missing=1`).then((r) => r.json()),
      fetch(fbaPaths.today()).then((r) => r.json()),
    ])
      .then(([validateData, todayData]) => {
        const todayItems: string[] = todayData?.shipment?.items?.map((i: any) => String(i.fnsku)) ?? [];
        const todaySet = new Set(todayItems);
        setTodayPlanId(todayData?.shipment?.id ?? null);

        if (Array.isArray(validateData?.results)) {
          setDraftItems((prev) => {
            const prevQty = Object.fromEntries(prev.map((p) => [p.fnsku, p.qty]));
            return validateData.results.map((r: any) => ({
              fnsku: r.fnsku,
              found: Boolean(r.found),
              alreadyInPlan: todaySet.has(String(r.fnsku)),
              product_title: r.product_title || null,
              asin: r.asin || null,
              qty: prevQty[r.fnsku] ?? 1,
            }));
          });
          const notFound: string[] = validateData.results.filter((r: any) => !r.found).map((r: any) => r.fnsku as string);
          if (notFound.length > 0) {
            try {
              const existing: { fnsku: string; savedAt: string }[] = JSON.parse(localStorage.getItem('fba_unknown_fnskus') || '[]');
              const existingSet = new Set(existing.map((e) => e.fnsku));
              const merged = [...existing, ...notFound.filter((f) => !existingSet.has(f)).map((f) => ({ fnsku: f, savedAt: new Date().toISOString() }))];
              localStorage.setItem('fba_unknown_fnskus', JSON.stringify(merged));
              window.dispatchEvent(new Event('fba-unknown-fnskus-changed'));
            } catch { /* no-op */ }
          }
        }
      })
      .catch(() => {})
      .finally(() => setDraftLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fnskus.join(','), isDraftMode]);

  // ── Plan / today mode: load items ────────────────────────────────────────
  const parsePlanItemsFromApi = (items: any[]): PlanItem[] =>
    items.map((i: any) => ({
      id: Number(i.id),
      fnsku: i.fnsku,
      display_title: i.display_title || i.product_title || null,
      product_title: i.product_title || null,
      asin: i.asin || null,
      sku: i.sku || null,
      expected_qty: Number(i.expected_qty) || 1,
      status: i.status || 'PLANNED',
      notes: i.notes || null,
      ready_by_staff_id: i.ready_by_staff_id || null,
      ready_by_name: i.ready_by_name || null,
      verified_by_staff_id: i.verified_by_staff_id || null,
      verified_by_name: i.verified_by_name || null,
    }));

  const loadPlanItems = useCallback(async (id?: number) => {
    const targetId = id ?? planId;
    if (!targetId) return;
    setPlanLoading(true);
    try {
      const [shipRes, itemsRes] = await Promise.all([
        fetch(fbaPaths.plan(targetId)),
        fetch(fbaPaths.planItems(targetId)),
      ]);
      const shipData = await shipRes.json();
      const itemsData = await itemsRes.json();
      if (shipData?.shipment) {
        setPlanRef(shipData.shipment.shipment_ref || '');
        setPlanDueDate(shipData.shipment.due_date || null);
        const amz = shipData.shipment.amazon_shipment_id;
        setPlanAmazonShipmentId(amz != null && String(amz).trim() ? String(amz).trim() : null);
        setPlanTrackingNumbers(
          Array.isArray(shipData.shipment.tracking_numbers) ? shipData.shipment.tracking_numbers : []
        );
      } else {
        setPlanTrackingNumbers([]);
      }
      if (Array.isArray(itemsData?.items)) {
        setPlanItems(parsePlanItemsFromApi(itemsData.items));
      }
    } catch { /* no-op */ }
    finally { setPlanLoading(false); }
  }, [planId]);

  const loadTodayPlan = useCallback(async () => {
    setPlanLoading(true);
    try {
      const res = await fetch(fbaPaths.today());
      const data = await res.json();
      if (data?.shipment) {
        setTodayPlanId(data.shipment.id);
        setPlanRef(data.shipment.shipment_ref || '');
        setPlanDueDate(data.shipment.due_date || null);
        const amz = data.shipment.amazon_shipment_id;
        setPlanAmazonShipmentId(amz != null && String(amz).trim() ? String(amz).trim() : null);
        setPlanTrackingNumbers(
          Array.isArray(data.shipment.tracking_numbers) ? data.shipment.tracking_numbers : []
        );
        setPlanItems(parsePlanItemsFromApi(data.shipment.items || []));
      } else {
        setPlanItems([]);
        setTodayPlanId(null);
        setPlanAmazonShipmentId(null);
        setPlanTrackingNumbers([]);
      }
    } catch { /* no-op */ }
    finally { setPlanLoading(false); }
  }, []);

  useEffect(() => {
    if (isTodayMode) loadTodayPlan();
    else if (!isDraftMode) loadPlanItems();
  }, [isTodayMode, isDraftMode, loadPlanItems, loadTodayPlan]);

  useEffect(() => {
    if (!isTodayMode) return;
    const h = () => loadTodayPlan();
    window.addEventListener('fba-plan-created', h);
    return () => window.removeEventListener('fba-plan-created', h);
  }, [isTodayMode, loadTodayPlan]);

  // ── Auto-save qty ─────────────────────────────────────────────────────────
  const activePlanId = planId ?? todayPlanId;

  const saveItemQty = useCallback((itemId: number, qty: number) => {
    const id = activePlanId;
    if (!id) return;
    clearTimeout(savingRef.current[itemId]);
    savingRef.current[itemId] = setTimeout(async () => {
      try {
        await fetch(fbaPaths.planItem(id, itemId), {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expected_qty: qty }),
        });
      } catch { /* no-op */ }
    }, 600);
  }, [activePlanId]);

  const adjustPlanQty = useCallback((itemId: number, delta: number) => {
    setPlanItems((prev) => prev.map((item) => {
      if (item.id !== itemId) return item;
      const next = Math.max(1, item.expected_qty + delta);
      saveItemQty(itemId, next);
      return { ...item, expected_qty: next };
    }));
  }, [saveItemQty]);

  // ── Draft mode qty ───────────────────────────────────────────────────────
  const adjustDraftQty = useCallback((fnsku: string, delta: number) =>
    setDraftItems((prev) => prev.map((item) => item.fnsku === fnsku ? { ...item, qty: Math.max(1, item.qty + delta) } : item)),
  []);

  const removeDraftItem = useCallback((fnsku: string) =>
    setDraftItems((prev) => prev.filter((i) => i.fnsku !== fnsku)),
  []);

  // ── Draft: add to today's plan ───────────────────────────────────────────
  const newDraftItems = draftItems.filter((i) => !i.alreadyInPlan);
  const alreadyInPlanCount = draftItems.filter((i) => i.alreadyInPlan).length;
  const notFoundCount = draftItems.filter((i) => !i.found).length;

  const handleAddToTodayPlan = useCallback(async () => {
    if (newDraftItems.length === 0) { setCreateError('No new items to add'); return; }
    setCreating(true); setCreateError(null);
    try {
      const res = await fetch(fbaPaths.todayItems(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: newDraftItems.map((i) => ({
            fnsku: i.fnsku, expected_qty: i.qty,
            product_title: i.product_title, asin: i.asin,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setCreateError(data?.error || 'Failed'); return; }
      setCreated(true);
      setAddedCount(data.added?.length ?? newDraftItems.length);
      setSkippedCount(data.skipped?.length ?? 0);
      window.dispatchEvent(new Event('fba-plan-created'));
      onCreated?.(data.shipment_id, data.shipment_ref);
      setTimeout(() => onClear?.(), 2600);
    } catch (e: any) { setCreateError(e?.message || 'Failed'); }
    finally { setCreating(false); }
  }, [newDraftItems, onCreated, onClear]);

  // ── Computed ─────────────────────────────────────────────────────────────
  const visiblePlanItems = useMemo(
    () => planItems.filter((item) => isPlanChecklistVisibleItem(item)),
    [planItems]
  );

  const normalizedFilter = (statusFilter || 'ALL').toUpperCase();
  const filteredPlanItems = useMemo(() => {
    const isViewMode = !isDraftMode;
    if (!isViewMode) return planItems;
    if (normalizedFilter === 'ALL') return visiblePlanItems;
    return visiblePlanItems.filter((i) => {
      if (normalizedFilter === 'READY_TO_GO') return i.status === 'READY_TO_GO' || i.status === 'SHIPPED';
      return i.status === normalizedFilter;
    });
  }, [isDraftMode, planItems, normalizedFilter, visiblePlanItems]);

  // ── Move item to print queue (with undo) ────────────────────────────────
  const handleMoveToPrint = useCallback((itemId: number) => {
    if (!activePlanId) return;
    const item = planItems.find((i) => i.id === itemId);
    if (!item) return;

    setPlanItems((prev) => prev.filter((i) => i.id !== itemId));

    if (undoRef.current) clearTimeout(undoRef.current);
    const timer = setTimeout(async () => {
      setUndoToast(null);
      try {
        await fetch(fbaPaths.planItem(activePlanId, itemId), {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'READY_TO_GO' }),
        });
        window.dispatchEvent(new Event('fba-plan-created'));
      } catch {
        if (item) setPlanItems((prev) => [...prev, item].sort((a, b) => a.id - b.id));
      }
    }, 5000);
    undoRef.current = timer;
    setUndoToast({ itemId, label: item.display_title || item.fnsku, timer });
  }, [activePlanId, planItems]);

  const handleUndoMoveToPrint = useCallback(() => {
    if (!undoToast) return;
    clearTimeout(undoToast.timer);
    setUndoToast(null);
    if (isTodayMode) loadTodayPlan(); else loadPlanItems();
  }, [undoToast, isTodayMode, loadTodayPlan, loadPlanItems]);

  // ── Tap-dot to cycle status ─────────────────────────────────────────────
  const handleCycleStatus = useCallback(async (itemId: number, currentStatus: string) => {
    const nextStatus = STATUS_CYCLE[currentStatus];
    if (!nextStatus || !activePlanId) return;
    setCyclingItemId(itemId);
    try {
      const res = await fetch(fbaPaths.planItem(activePlanId, itemId), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        setPlanItems((prev) => prev.map((i) => i.id === itemId ? { ...i, status: nextStatus } : i));
        window.dispatchEvent(new Event('fba-plan-created'));
      }
    } catch { /* no-op */ } finally {
      setCyclingItemId(null);
    }
  }, [activePlanId]);

  // ── Notes editing ───────────────────────────────────────────────────────
  const handleOpenNote = useCallback((item: PlanItem) => {
    setExpandedNoteId(item.id);
    setNoteText(item.notes || '');
  }, []);

  const handleNoteChange = useCallback((itemId: number, text: string) => {
    setNoteText(text);
    setPlanItems((prev) => prev.map((i) => i.id === itemId ? { ...i, notes: text || null } : i));
    if (noteSaveRef.current) clearTimeout(noteSaveRef.current);
    if (!activePlanId) return;
    noteSaveRef.current = setTimeout(async () => {
      try {
        await fetch(fbaPaths.planItem(activePlanId, itemId), {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes: text.trim() || null }),
        });
      } catch { /* no-op */ }
    }, 600);
  }, [activePlanId]);

  // ── Listen for saved FNSKU events ───────────────────────────────────────
  useEffect(() => {
    const handleSavedFnsku = (event: Event) => {
      const detail = (event as CustomEvent<{
        fnsku?: string;
        product_title?: string | null;
        asin?: string | null;
      }>).detail;
      const normalizedFnsku = String(detail?.fnsku || '').trim().toUpperCase();
      if (!normalizedFnsku) return;
      setDraftItems((prev) =>
        prev.map((item) =>
          item.fnsku === normalizedFnsku
            ? { ...item, found: true, product_title: detail?.product_title ?? item.product_title, asin: detail?.asin ?? item.asin }
            : item,
        ),
      );
    };
    window.addEventListener(FBA_FNSKU_SAVED_EVENT, handleSavedFnsku as EventListener);
    return () => window.removeEventListener(FBA_FNSKU_SAVED_EVENT, handleSavedFnsku as EventListener);
  }, []);

  return {
    // Mode flags
    isDraftMode,
    isTodayMode,
    isViewMode: !isDraftMode,

    // Draft data
    draftItems,
    draftLoading,
    newDraftItems,
    alreadyInPlanCount,
    notFoundCount,

    // Plan data
    planItems,
    planLoading,
    planRef,
    planDueDate,
    planAmazonShipmentId,
    planTrackingNumbers,
    activePlanId,
    visiblePlanItems,
    filteredPlanItems,

    // Create state
    creating,
    createError,
    created,
    addedCount,
    skippedCount,

    // Status cycling
    cyclingItemId,

    // Notes
    expandedNoteId,
    noteText,
    setExpandedNoteId,

    // Undo toast
    undoToast,

    // Actions
    adjustPlanQty,
    adjustDraftQty,
    removeDraftItem,
    handleAddToTodayPlan,
    handleMoveToPrint,
    handleUndoMoveToPrint,
    handleCycleStatus,
    handleOpenNote,
    handleNoteChange,
    loadPlanItems,
    loadTodayPlan,
  };
}
