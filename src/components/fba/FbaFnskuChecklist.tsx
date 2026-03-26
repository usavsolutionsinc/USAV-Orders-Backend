'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, X, Plus, Minus, Loader2, Package, AlertCircle, ChevronRight, Pencil } from '@/components/Icons';
import { useFbaWorkspace } from '@/contexts/FbaWorkspaceContext';
import { FnskuChip } from '@/components/ui/CopyChip';
import {
  getStaffThemeById,
  getStaffThemeByName,
  stationThemeColors,
  fbaFnskuChecklistChrome,
  printQueueTableUi,
} from '@/utils/staff-colors';
import { PrintTableCheckbox } from '@/components/fba/table/Checkbox';
import { enrichFromApi } from '@/components/fba/table/utils';
import type { EnrichedItem, PrintSelectionPayload, ShipmentTrackingEntry } from '@/components/fba/table/types';

// ─── Types ────────────────────────────────────────────────────────────────────
interface DraftItem {
  fnsku: string;
  found: boolean;
  alreadyInPlan: boolean;
  product_title: string | null;
  asin: string | null;
  qty: number;
}

interface PlanItem {
  id: number;
  fnsku: string;
  display_title: string | null;
  product_title: string | null;
  asin: string | null;
  sku: string | null;
  expected_qty: number;
  status: string;
  notes: string | null;
  // tech (ready_by) + packer (verified_by)
  ready_by_staff_id: number | null;
  ready_by_name: string | null;
  verified_by_staff_id: number | null;
  verified_by_name: string | null;
}

function planItemToSidebarEnriched(
  item: PlanItem,
  planId: number,
  planRef: string,
  dueDate: string | null,
  amazonShipmentId: string | null,
  trackingNumbers: ShipmentTrackingEntry[]
): EnrichedItem {
  return enrichFromApi({
    item_id: item.id,
    fnsku: item.fnsku,
    expected_qty: item.expected_qty,
    actual_qty: 0,
    item_status: item.status,
    display_title: item.display_title || item.product_title || item.fnsku,
    asin: item.asin,
    sku: item.sku,
    plan_id: planId,
    plan_ref: planRef,
    shipment_id: planId,
    shipment_ref: planRef,
    amazon_shipment_id: amazonShipmentId,
    tracking_numbers: trackingNumbers,
    due_date: dueDate,
    destination_fc: null,
    item_notes: item.notes,
  });
}

// Status cycle order (tap dot to advance)
const STATUS_CYCLE: Record<string, string> = {
  PLANNED:      'PACKING',
  PACKING:      'READY_TO_GO',
  OUT_OF_STOCK: 'PLANNED',
  READY_TO_GO:  'PLANNED', // allow tap-back to re-plan
};

interface Props {
  /** Draft mode — new FNSKUs being reviewed before adding to today's plan */
  fnskus?: string[];
  /** Internal `fba_shipments.id` (URL `plan=`). Not the plan code string (`shipment_ref`). */
  planId?: number;
  /** Filter by item status: ALL | PACKING | OUT_OF_STOCK */
  statusFilter?: string;
  /** Today mode — neither prop → auto-loads today's plan */
  onClear?: () => void;
  onCreated?: (id: number, ref: string) => void;
  /** When true, list area does not scroll (parent handles layout; may clip). */
  suppressListScroll?: boolean;
  /** Selected staff — theme matches {@link FbaWorkspaceScanField} / URL `staffId`. */
  staffId?: number | string | null;
  staffRole?: 'technician' | 'packer';
}

// ─── Animated qty number ──────────────────────────────────────────────────────
function AnimatedQty({ value }: { value: number }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={value}
        initial={{ y: -8, opacity: 0, scale: 0.85 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 8, opacity: 0, scale: 0.85 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className="inline-block w-8 text-center font-mono text-[13px] font-black tabular-nums text-zinc-900"
      >
        {value}
      </motion.span>
    </AnimatePresence>
  );
}

// ─── Shimmer skeleton ─────────────────────────────────────────────────────────
function ShimmerRows({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: Math.max(count, 3) }).map((_, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-gray-50 px-4 py-2.5">
          <div className="space-y-1.5">
            <motion.div animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut', delay: i * 0.08 }}
              className="h-3 w-40 rounded bg-gradient-to-r from-zinc-100 via-zinc-200 to-zinc-100 bg-[length:200%_100%]" />
            <div className="h-2 w-24 rounded bg-zinc-100" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-5 w-14 rounded bg-zinc-100" />
            <div className="flex items-center gap-0.5">
              <div className="h-6 w-6 rounded-md bg-zinc-100" />
              <div className="h-4 w-7 rounded bg-zinc-100" />
              <div className="h-6 w-6 rounded-md bg-zinc-100" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
const STATUS_CFG: Record<string, string> = {
  PLANNED:      'bg-zinc-100 text-zinc-500',
  PACKING:      'bg-amber-100 text-amber-700',
  OUT_OF_STOCK: 'bg-red-100 text-red-600',
  READY_TO_GO:  'bg-emerald-100 text-emerald-700',
  SHIPPED:      'bg-blue-100 text-blue-700',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_CFG[status] ?? 'bg-zinc-100 text-zinc-500';
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ─── Status dot / icon (left of title, like OrdersQueueTable) ─────────────────
function StatusDot({ status }: { status: string }) {
  if (status === 'READY_TO_GO' || status === 'SHIPPED') {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100" title="Ready to print">
        <Check className="h-2.5 w-2.5 text-emerald-600" />
      </span>
    );
  }
  if (status === 'OUT_OF_STOCK') {
    return <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" title="Out of stock" />;
  }
  if (status === 'PACKING') {
    return <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-sky-500" title="Packing" />;
  }
  // PLANNED / default
  return <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" title="Planned" />;
}

// ─── Qty stepper ─────────────────────────────────────────────────────────────
function QtyControl({
  value,
  onMinus,
  onPlus,
  disabled,
  focusRingClassName = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40',
}: {
  value: number;
  onMinus: () => void;
  onPlus: () => void;
  disabled?: boolean;
  /** Theme-matched focus ring (e.g. `printQueueTableUi[theme].rowFocusRing`). */
  focusRingClassName?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={onMinus} disabled={disabled || value <= 1}
        className={`flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-zinc-50 ${focusRingClassName} disabled:cursor-not-allowed disabled:opacity-25`}>
        <Minus className="h-2.5 w-2.5" />
      </motion.button>
      <AnimatedQty value={value} />
      <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={onPlus} disabled={disabled}
        className={`flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-zinc-50 ${focusRingClassName} disabled:opacity-25`}>
        <Plus className="h-2.5 w-2.5" />
      </motion.button>
    </div>
  );
}

// ─── Row variants ─────────────────────────────────────────────────────────────
const rowVariants = {
  hidden:  { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 380, damping: 28 } },
  exit:    { opacity: 0, x: -20, transition: { duration: 0.16 } },
};

function todayLabel() {
  return new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Matches {@link StaffSelector} / assignment chips: theme from staff id, else name. */
function staffRolePillClass(
  staffId: number | null | undefined,
  displayName: string | null | undefined,
  role: 'technician' | 'packer'
): string {
  const id = staffId != null ? Number(staffId) : NaN;
  const hasValidId = Number.isFinite(id) && id > 0;
  const theme = hasValidId
    ? getStaffThemeById(id, role)
    : getStaffThemeByName(String(displayName || '').trim(), role);
  const c = stationThemeColors[theme];
  return `${c.light} ${c.text} border ${c.border}`;
}

// ─────────────────────────────────────────────────────────────────────────────
export function FbaFnskuChecklist({
  fnskus = [],
  planId,
  statusFilter,
  onClear,
  onCreated,
  suppressListScroll = false,
  staffId = null,
  staffRole = 'technician',
}: Props) {
  const { clearSelection, clearSelectionVersion, setSelection } = useFbaWorkspace();
  const isDraftMode = fnskus.length > 0 && !planId;
  const isTodayMode = !planId && fnskus.length === 0;
  const selectionOwnerRef = useRef(`fba-plan-checklist-${Math.random().toString(36).slice(2)}`);

  const stationTheme = useMemo(() => getStaffThemeById(staffId, staffRole), [staffId, staffRole]);
  const themeColors = stationThemeColors[stationTheme];
  const checklistChrome = fbaFnskuChecklistChrome[stationTheme];
  const printUi = printQueueTableUi[stationTheme];

  // Draft state
  const [draftItems,   setDraftItems]   = useState<DraftItem[]>([]);
  const [draftLoading, setDraftLoading] = useState(false);
  const [todayPlanId,  setTodayPlanId]  = useState<number | null>(null);

  // Plan / today state
  const [planItems,   setPlanItems]   = useState<PlanItem[]>([]);
  const [planLoading, setPlanLoading] = useState(false);
  const [planRef,     setPlanRef]     = useState('');
  const [planDueDate, setPlanDueDate] = useState<string | null>(null);
  const [planAmazonShipmentId, setPlanAmazonShipmentId] = useState<string | null>(null);
  const [planTrackingNumbers, setPlanTrackingNumbers] = useState<ShipmentTrackingEntry[]>([]);
  /** Line ids selected for the shared FBA workspace sidebar. */
  const [sidebarSelectionIds, setSidebarSelectionIds] = useState<Set<number>>(new Set());
  const savingRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  // Create state
  const [creating,     setCreating]     = useState(false);
  const [createError,  setCreateError]  = useState<string | null>(null);
  const [created,      setCreated]      = useState(false);
  const [addedCount,   setAddedCount]   = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);

  // Print override busy tracking
  const [printingItemId, setPrintingItemId] = useState<number | null>(null);

  // Status cycling
  const [cyclingItemId, setCyclingItemId] = useState<number | null>(null);

  // Notes editing (per item id)
  const [expandedNoteId, setExpandedNoteId] = useState<number | null>(null);
  const [noteText, setNoteText] = useState('');
  const noteSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Toast + undo for move-to-print
  const [undoToast, setUndoToast] = useState<{ itemId: number; label: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const undoRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Draft mode: validate + check today's plan ────────────────────────────
  useEffect(() => {
    if (!isDraftMode) { setDraftItems([]); return; }
    setDraftLoading(true);

    Promise.all([
      fetch(`/api/fba/fnskus/validate?fnskus=${encodeURIComponent(fnskus.join(','))}`).then((r) => r.json()),
      fetch('/api/fba/shipments/today').then((r) => r.json()),
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
          // Save not-found FNSKUs to localStorage
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
  const loadPlanItems = useCallback(async (id?: number) => {
    const targetId = id ?? planId;
    if (!targetId) return;
    setPlanLoading(true);
    try {
      const [shipRes, itemsRes] = await Promise.all([
        fetch(`/api/fba/shipments/${targetId}`),
        fetch(`/api/fba/shipments/${targetId}/items`),
      ]);
      const shipData  = await shipRes.json();
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
        setPlanItems(itemsData.items.map((i: any) => ({
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
        })));
      }
    } catch { /* no-op */ }
    finally { setPlanLoading(false); }
  }, [planId]);

  // Today mode: auto-load today's plan
  const loadTodayPlan = useCallback(async () => {
    setPlanLoading(true);
    try {
      const res  = await fetch('/api/fba/shipments/today');
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
        setPlanItems((data.shipment.items || []).map((i: any) => ({
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
        })));
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

  // Refresh on plan-created events
  useEffect(() => {
    if (!isTodayMode) return;
    const h = () => loadTodayPlan();
    window.addEventListener('fba-plan-created', h);
    return () => window.removeEventListener('fba-plan-created', h);
  }, [isTodayMode, loadTodayPlan]);

  // ── Plan mode: auto-save qty ─────────────────────────────────────────────
  const saveItemQty = useCallback((itemId: number, qty: number) => {
    const id = planId ?? todayPlanId;
    if (!id) return;
    clearTimeout(savingRef.current[itemId]);
    savingRef.current[itemId] = setTimeout(async () => {
      try {
        await fetch(`/api/fba/shipments/${id}/items/${itemId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expected_qty: qty }),
        });
      } catch { /* no-op */ }
    }, 600);
  }, [planId, todayPlanId]);

  const adjustPlanQty = (itemId: number, delta: number) => {
    setPlanItems((prev) => prev.map((item) => {
      if (item.id !== itemId) return item;
      const next = Math.max(1, item.expected_qty + delta);
      saveItemQty(itemId, next);
      return { ...item, expected_qty: next };
    }));
  };

  // ── Draft mode qty ───────────────────────────────────────────────────────
  const adjustDraftQty = (fnsku: string, delta: number) =>
    setDraftItems((prev) => prev.map((item) => item.fnsku === fnsku ? { ...item, qty: Math.max(1, item.qty + delta) } : item));

  const removeDraftItem = (fnsku: string) => setDraftItems((prev) => prev.filter((i) => i.fnsku !== fnsku));

  // ── Draft: add to today's plan ───────────────────────────────────────────
  const newDraftItems = draftItems.filter((i) => i.found && !i.alreadyInPlan);
  const alreadyInPlanCount = draftItems.filter((i) => i.alreadyInPlan).length;
  const notFoundCount = draftItems.filter((i) => !i.found).length;

  const handleAddToTodayPlan = async () => {
    if (newDraftItems.length === 0) { setCreateError('No new items to add'); return; }
    setCreating(true); setCreateError(null);
    try {
      const res = await fetch('/api/fba/shipments/today/items', {
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
  };

  // ── Computed IDs ────────────────────────────────────────────────────────
  const activePlanId = planId ?? todayPlanId;

  // ── Bulk-assign event (fired by sidebar) ─────────────────────────────────
  useEffect(() => {
    const h = (e: Event) => {
      const staffId = (e as CustomEvent).detail?.staffId;
      if (!staffId || !activePlanId) return;
      const planned = planItems.filter((i) => i.status === 'PLANNED' || i.status === 'PACKING');
      Promise.all(
        planned.map((item) =>
          fetch(`/api/fba/shipments/${activePlanId}/items/${item.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ staff_id: staffId }),
          })
        )
      ).then(() => {
        if (isTodayMode) loadTodayPlan(); else loadPlanItems();
      }).catch(() => {});
    };
    window.addEventListener('fba-bulk-assign', h);
    return () => window.removeEventListener('fba-bulk-assign', h);
  }, [activePlanId, planItems, isTodayMode, loadTodayPlan, loadPlanItems]);

  // ── Move item to print queue (with undo toast) ───────────────────────────
  const handleMoveToPrint = useCallback((itemId: number) => {
    if (!activePlanId) return;
    const item = planItems.find((i) => i.id === itemId);
    if (!item) return;

    // Optimistically remove from list
    setPlanItems((prev) => prev.filter((i) => i.id !== itemId));
    setPrintingItemId(null);

    // Show undo toast for 5 seconds
    if (undoRef.current) clearTimeout(undoRef.current);
    const timer = setTimeout(async () => {
      // Commit the move
      setUndoToast(null);
      try {
        await fetch(`/api/fba/shipments/${activePlanId}/items/${itemId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'READY_TO_GO' }),
        });
        window.dispatchEvent(new Event('fba-plan-created'));
      } catch {
        // Revert on failure
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
    // Restore item — reload to get latest data
    if (isTodayMode) loadTodayPlan(); else loadPlanItems();
  }, [undoToast, isTodayMode, loadTodayPlan, loadPlanItems]);

  // ── Tap-dot to cycle status ──────────────────────────────────────────────
  const handleCycleStatus = useCallback(async (itemId: number, currentStatus: string) => {
    const nextStatus = STATUS_CYCLE[currentStatus];
    if (!nextStatus || !activePlanId) return;
    setCyclingItemId(itemId);
    try {
      const res = await fetch(`/api/fba/shipments/${activePlanId}/items/${itemId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        setPlanItems((prev) => prev.map((i) => i.id === itemId ? { ...i, status: nextStatus } : i));
        window.dispatchEvent(new Event('fba-plan-created')); // refresh sidebar counts
      }
    } catch { /* no-op */ } finally {
      setCyclingItemId(null);
    }
  }, [activePlanId]);

  // ── Notes editing (inline, auto-save) ────────────────────────────────────
  const handleOpenNote = (item: PlanItem) => {
    setExpandedNoteId(item.id);
    setNoteText(item.notes || '');
  };

  const handleNoteChange = (itemId: number, text: string) => {
    setNoteText(text);
    setPlanItems((prev) => prev.map((i) => i.id === itemId ? { ...i, notes: text || null } : i));
    if (noteSaveRef.current) clearTimeout(noteSaveRef.current);
    if (!activePlanId) return;
    noteSaveRef.current = setTimeout(async () => {
      try {
        await fetch(`/api/fba/shipments/${activePlanId}/items/${itemId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes: text.trim() || null }),
        });
      } catch { /* no-op */ }
    }, 600);
  };

  const isViewMode = !isDraftMode;
  const normalizedFilter = (statusFilter || 'ALL').toUpperCase();
  const filteredPlanItems = useMemo(() => {
    if (!isViewMode) return planItems;
    if (normalizedFilter === 'ALL') return planItems;
    return planItems.filter((i) => {
      if (normalizedFilter === 'READY_TO_GO') return i.status === 'READY_TO_GO' || i.status === 'SHIPPED';
      return i.status === normalizedFilter;
    });
  }, [isViewMode, planItems, normalizedFilter]);

  useEffect(() => {
    setSidebarSelectionIds(new Set());
  }, [activePlanId]);

  useEffect(() => {
    const valid = new Set(planItems.map((i) => i.id));
    setSidebarSelectionIds((prev) => {
      const next = new Set(Array.from(prev).filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [planItems]);

  const buildSidebarSelectionPayload = useCallback((selectionIds: Set<number>): PrintSelectionPayload => {
    if (!isViewMode || !activePlanId) {
      return {
        selectedItems: [],
        planIds: [],
        shipmentIds: [],
        readyCount: 0,
        pendingCount: 0,
        needsPrintCount: 0,
      };
    }

    const selected = planItems.filter((i) => selectionIds.has(i.id));
    const enriched = selected.map((i) =>
      planItemToSidebarEnriched(i, activePlanId, planRef, planDueDate, planAmazonShipmentId, planTrackingNumbers)
    );
    const readyCount = enriched.filter((i) => i.status === 'ready_to_print').length;
    const pendingCount = enriched.filter(
      (i) => i.status === 'pending_out_of_stock' || i.status === 'pending_qc_fail'
    ).length;
    const needsPrintCount = enriched.filter((i) => i.status === 'needs_print').length;
    const planIds = Array.from(new Set(enriched.map((i) => i.plan_id)));

    return {
      selectedItems: enriched,
      planIds,
      shipmentIds: planIds,
      readyCount,
      pendingCount,
      needsPrintCount,
    };
  }, [isViewMode, activePlanId, planItems, planRef, planDueDate, planAmazonShipmentId, planTrackingNumbers]);

  const toggleSidebarLineImmediate = useCallback((itemId: number) => {
    setSidebarSelectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  const toggleSidebarSelectAllFilteredImmediate = useCallback(() => {
    const ids = filteredPlanItems.map((i) => i.id);
    setSidebarSelectionIds((prev) => {
      const allOn = ids.length > 0 && ids.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allOn) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [filteredPlanItems]);

  useEffect(() => {
    setSelection(selectionOwnerRef.current, buildSidebarSelectionPayload(sidebarSelectionIds));
  }, [buildSidebarSelectionPayload, setSelection, sidebarSelectionIds]);

  useEffect(() => {
    if (clearSelectionVersion === 0) return;
    setSidebarSelectionIds(new Set());
  }, [clearSelectionVersion]);

  useEffect(() => () => clearSelection(selectionOwnerRef.current), [clearSelection]);

  // ── Success screen ───────────────────────────────────────────────────────
  if (created) {
    return (
      <div className="flex h-full items-center justify-center">
        <motion.div initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 22 }} className="text-center px-8">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 18, delay: 0.1 }} className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <Check className="h-8 w-8 text-emerald-600" />
          </motion.div>
          <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }} className="text-[15px] font-black uppercase tracking-tight text-zinc-900">Added to Today&apos;s Plan</motion.p>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.32 }} className="mt-1 text-[12px] font-bold text-zinc-400">
            {addedCount} item{addedCount !== 1 ? 's' : ''} added{skippedCount > 0 ? ` · ${skippedCount} already existed` : ''}
          </motion.p>
        </motion.div>
      </div>
    );
  }

  const loading       = isDraftMode ? draftLoading : planLoading;
  const loadingCount  = isDraftMode ? fnskus.length : planItems.length;

  const sidebarSelectFilteredCount = filteredPlanItems.filter((i) => sidebarSelectionIds.has(i.id)).length;
  const sidebarAllFilteredSelected =
    filteredPlanItems.length > 0 && sidebarSelectFilteredCount === filteredPlanItems.length;
  const sidebarSomeFilteredSelected =
    sidebarSelectFilteredCount > 0 && !sidebarAllFilteredSelected;

  // Header content
  const headerTitle = isDraftMode
    ? 'Review for Today'
    : isTodayMode
      ? `Today · ${todayLabel()}`
      : planRef || 'Plan Details';
  const headerEyebrow = isDraftMode ? 'Draft intake' : isTodayMode ? 'Today plan' : 'Shipment plan';

  const filterLabel = normalizedFilter === 'ALL' ? '' : ` · ${normalizedFilter === 'OUT_OF_STOCK' ? 'OOS' : normalizedFilter.charAt(0) + normalizedFilter.slice(1).toLowerCase()} filter`;
  const headerSubtitle = loading
    ? isDraftMode ? `Validating ${fnskus.length} FNSKUs…` : 'Loading…'
    : isDraftMode
      ? `${draftItems.length} FNSKUs · ${newDraftItems.length} new${alreadyInPlanCount > 0 ? ` · ${alreadyInPlanCount} already planned` : ''}${notFoundCount > 0 ? ` · ${notFoundCount} not in catalog` : ''}`
      : `${filteredPlanItems.length}${filteredPlanItems.length !== planItems.length ? `/${planItems.length}` : ''} items${planDueDate ? ` · Due ${new Date(planDueDate).toLocaleDateString()}` : ''}${filterLabel}`;
  const emptyTitle = isDraftMode
    ? 'Nothing to review'
    : isTodayMode
      ? 'Today’s plan is clear'
      : 'No matching items';
  const emptyDescription = isDraftMode
    ? 'Paste FNSKUs from the sidebar to validate and queue them for today.'
    : isTodayMode
      ? 'Paste FNSKUs in the sidebar to start building today’s plan.'
      : 'Change the filter or return to the full shipment plan.';

  return (
    <>
      <div className={checklistChrome.shell}>

        {/* Header */}
        <div
          className={`flex items-start justify-between gap-3 bg-white/90 px-4 py-4 backdrop-blur-sm ${checklistChrome.headerBarDivider}`}
        >
          <div className="min-w-0">
            <p className={`text-[10px] font-black uppercase tracking-[0.16em] ${themeColors.text}`}>{headerEyebrow}</p>
            <h2 className="mt-2 text-[15px] font-black tracking-tight text-zinc-900">{headerTitle}</h2>
            <p className="mt-1 max-w-md text-[11px] leading-5 text-zinc-500">{headerSubtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Draft mode: Add to plan button */}
            {isDraftMode && !loading && (
              <AnimatePresence initial={false}>
                <motion.button
                  type="button"
                  key="add-btn"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleAddToTodayPlan}
                  disabled={creating || newDraftItems.length === 0}
                  className={`flex h-9 items-center gap-1.5 rounded-full px-4 text-[10px] font-black uppercase tracking-[0.14em] text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${themeColors.bg} ${themeColors.hover}`}
                >
                  {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Package className="h-3 w-3" />}
                  Add {newDraftItems.length > 0 ? `${newDraftItems.length} ` : ''}to plan
                </motion.button>
              </AnimatePresence>
            )}
            {onClear && (
              <button
                type="button"
                onClick={onClear}
                aria-label="Close plan panel"
                className="rounded-full border border-zinc-200 bg-white p-2 text-zinc-400 transition-colors hover:border-zinc-300 hover:text-zinc-700"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Error bar */}
        <AnimatePresence>
          {createError && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden border-b border-red-100 bg-red-50 px-4 py-2.5">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-red-700">
                <AlertCircle className="h-3 w-3" />{createError}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Already-in-plan notice */}
        <AnimatePresence>
          {isDraftMode && alreadyInPlanCount > 0 && !loading && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className={`overflow-hidden border-b px-4 py-2.5 ${themeColors.border} ${themeColors.light}`}
            >
              <div className={`flex items-center gap-1.5 text-[10px] font-semibold ${themeColors.text}`}>
                <Check className="h-3 w-3" />
                {alreadyInPlanCount} FNSKU{alreadyInPlanCount !== 1 ? 's' : ''} already in today&apos;s plan — skipped
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Column header — 44px */}
        <div
          className={`sticky top-0 z-10 flex h-12 items-center gap-2 border-b bg-white/95 px-4 backdrop-blur-sm ${themeColors.border}`}
        >
          <div className="flex w-9 shrink-0 items-center justify-center">
            {isViewMode && filteredPlanItems.length > 0 ? (
              <PrintTableCheckbox
                checked={sidebarAllFilteredSelected}
                indeterminate={sidebarSomeFilteredSelected}
                stationTheme="lightblue"
                reducedMotion={false}
                label={
                  sidebarAllFilteredSelected
                    ? 'Clear sidebar selection for visible rows'
                    : 'Select visible rows for print sidebar'
                }
                onChange={() => toggleSidebarSelectAllFilteredImmediate()}
              />
            ) : null}
          </div>
          <p className="min-w-0 flex-1 text-[9px] font-black uppercase tracking-[0.16em] text-zinc-400">Item</p>
          <div className="flex items-center gap-2 pr-0.5">
            <p className="w-16 text-right text-[9px] font-black uppercase tracking-[0.16em] text-zinc-400">FNSKU</p>
            <p className="w-24 text-center text-[9px] font-black uppercase tracking-[0.16em] text-zinc-400">Units</p>
            {isViewMode && <p className="w-[7.5rem] text-center text-[9px] font-black uppercase tracking-[0.16em] text-zinc-400">Print queue</p>}
          </div>
          {isViewMode && sidebarSelectionIds.size > 0 ? (
            <p className="ml-auto shrink-0 text-[9px] font-black uppercase tracking-[0.16em] text-sky-600">
              {sidebarSelectionIds.size} selected
            </p>
          ) : null}
        </div>

        {/* Rows */}
        <div
          className={`min-h-0 flex-1 bg-white ${suppressListScroll ? 'overflow-hidden' : 'overflow-y-auto'}`}
        >
          {loading ? (
            <ShimmerRows count={Math.min(loadingCount || 4, 6)} />
          ) : (isDraftMode ? draftItems.length === 0 : filteredPlanItems.length === 0) ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
              <div
                className={`flex h-14 w-14 items-center justify-center rounded-3xl border-2 ${themeColors.border} ${themeColors.light}`}
              >
                <Package className={`h-6 w-6 ${printUi.toolbarAccent}`} />
              </div>
              <p className="text-sm font-semibold text-zinc-700">{emptyTitle}</p>
              <p className="max-w-sm text-xs leading-5 text-zinc-500">{emptyDescription}</p>
            </motion.div>
          ) : (
            <AnimatePresence initial={false}>

              {/* ── DRAFT ROWS ── */}
              {isDraftMode && draftItems.map((item, idx) => (
                <motion.div
                  key={item.fnsku}
                  variants={rowVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  transition={{ delay: idx * 0.03 }}
                  layout
                  className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-zinc-100 px-4 py-3 transition-colors hover:bg-stone-50 ${item.alreadyInPlan ? 'opacity-50' : !item.found ? 'opacity-60' : ''}`}
                >
                  {/* Left: Title */}
                  <div className="min-w-0 flex flex-col">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <p className="truncate text-[12px] font-semibold text-zinc-900">
                        {item.product_title || item.fnsku}
                      </p>
                      {item.alreadyInPlan && (
                        <span
                          className={`shrink-0 rounded-full border-2 px-2 py-1 text-[8px] font-black uppercase tracking-[0.14em] ${themeColors.border} ${themeColors.light} ${themeColors.text}`}
                        >
                          In today&apos;s plan
                        </span>
                      )}
                      {!item.found && !item.alreadyInPlan && (
                        <span className="shrink-0 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-1 text-[8px] font-black uppercase tracking-[0.14em] text-zinc-500">
                          Not in catalog
                        </span>
                      )}
                    </div>
                    <div className="mt-1 truncate text-[10px] font-medium text-zinc-500">
                      {[item.asin].filter(Boolean).join(' · ') || 'No metadata'}
                    </div>
                  </div>

                  {/* Right: FNSKU chip + qty + remove */}
                  <div className="flex shrink-0 items-center gap-2">
                    <FnskuChip value={item.fnsku} />
                    <QtyControl
                      value={item.qty}
                      onMinus={() => adjustDraftQty(item.fnsku, -1)}
                      onPlus={() => adjustDraftQty(item.fnsku, 1)}
                      disabled={item.alreadyInPlan || !item.found}
                      focusRingClassName={printUi.rowFocusRing}
                    />
                    <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={() => removeDraftItem(item.fnsku)}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-transparent text-zinc-300 transition-colors hover:border-red-100 hover:bg-red-50 hover:text-red-500">
                      <X className="h-3 w-3" />
                    </motion.button>
                  </div>
                </motion.div>
              ))}

              {/* ── PLAN / TODAY ROWS ── */}
              {isViewMode && filteredPlanItems.map((item, idx) => {
                const isCompleted  = item.status === 'READY_TO_GO' || item.status === 'SHIPPED';
                const isCycling    = cyclingItemId === item.id;
                const noteOpen     = expandedNoteId === item.id;
                const isSidebarSelected = sidebarSelectionIds.has(item.id);
                return (
                  <motion.div
                    key={item.id}
                    variants={rowVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    transition={{ delay: idx * 0.025 }}
                    layout
                    onClick={() => toggleSidebarLineImmediate(item.id)}
                    className={`border-b border-zinc-100 transition-colors hover:bg-stone-50 ${
                      isSidebarSelected
                        ? 'border-l-4 border-l-sky-400 bg-sky-50/70'
                        : isCompleted
                          ? 'bg-emerald-50/30'
                          : 'bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-2 px-4 py-3">
                      <div
                        className="flex w-9 shrink-0 items-center justify-center"
                        role="presentation"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <PrintTableCheckbox
                          checked={sidebarSelectionIds.has(item.id)}
                          stationTheme="lightblue"
                          reducedMotion={false}
                          label={
                            sidebarSelectionIds.has(item.id)
                              ? `Remove ${item.fnsku} from print sidebar`
                              : `Add ${item.fnsku} to print sidebar`
                          }
                          onChange={() => toggleSidebarLineImmediate(item.id)}
                        />
                      </div>
                      {/* Clickable status dot */}
                      <motion.button
                        type="button"
                        whileTap={{ scale: 0.75 }}
                        onClick={() => handleCycleStatus(item.id, item.status)}
                        disabled={isCycling || item.status === 'SHIPPED'}
                        className="mt-[2px] shrink-0 cursor-pointer rounded-full p-1 transition-colors hover:bg-zinc-100 disabled:cursor-default"
                        title={`Status: ${item.status} — tap to advance`}
                      >
                        {isCycling
                          ? <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
                          : <StatusDot status={item.status} />
                        }
                      </motion.button>

                      {/* Left: Title + sub-info */}
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className={`truncate text-[12px] font-semibold text-zinc-900 ${isCompleted ? 'text-zinc-600' : ''}`}>
                            {item.display_title || item.fnsku}
                          </p>
                          <StatusBadge status={item.status} />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] font-medium text-zinc-500">
                          {item.asin && <span className="truncate">{item.asin}</span>}
                          {(item.ready_by_name || item.verified_by_name) && <span className="shrink-0 opacity-40">·</span>}
                          {item.ready_by_name && (
                            <span
                              className={`shrink-0 truncate rounded-full px-2 py-0.5 ${staffRolePillClass(
                                item.ready_by_staff_id,
                                item.ready_by_name,
                                'technician'
                              )}`}
                              title="Tech"
                            >
                              Tech {item.ready_by_name}
                            </span>
                          )}
                          {item.ready_by_name && item.verified_by_name && <span className="shrink-0 opacity-40">·</span>}
                          {item.verified_by_name && (
                            <span
                              className={`shrink-0 truncate rounded-full px-2 py-0.5 ${staffRolePillClass(
                                item.verified_by_staff_id,
                                item.verified_by_name,
                                'packer'
                              )}`}
                              title="Packer"
                            >
                              Pack {item.verified_by_name}
                            </span>
                          )}
                          {item.notes && !noteOpen && (
                            <>
                              <span className="shrink-0 opacity-40">·</span>
                              <span className="truncate italic text-amber-600" title={item.notes}>{item.notes}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Right: FNSKU chip + qty + notes + print */}
                      <div className="flex shrink-0 items-center gap-2">
                        <FnskuChip value={item.fnsku} />
                        <QtyControl
                          value={item.expected_qty}
                          onMinus={() => adjustPlanQty(item.id, -1)}
                          onPlus={() => adjustPlanQty(item.id, 1)}
                          disabled={isCompleted}
                          focusRingClassName={printUi.rowFocusRing}
                        />
                        {/* Note toggle */}
                        <motion.button
                          type="button"
                          whileTap={{ scale: 0.88 }}
                          onClick={() => {
                            if (noteOpen) { setExpandedNoteId(null); }
                            else { handleOpenNote(item); }
                          }}
                          title={item.notes ? 'Edit note' : 'Add note'}
                          className={`flex h-7 w-7 items-center justify-center rounded-full border transition-colors ${
                            noteOpen || item.notes
                              ? 'border-amber-200 bg-amber-50 text-amber-600'
                              : 'border-zinc-200 bg-white text-zinc-400 hover:border-amber-200 hover:text-amber-500'
                          }`}
                        >
                          <Pencil className="h-3 w-3" />
                        </motion.button>
                        {/* Print override */}
                        <motion.button
                          type="button"
                          whileTap={{ scale: 0.92 }}
                          disabled={isCompleted}
                          onClick={() => handleMoveToPrint(item.id)}
                          title="Move to print queue"
                          className={`flex h-7 w-[7.5rem] items-center justify-center gap-1 rounded-full border text-[8px] font-black uppercase tracking-[0.14em] transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                            isCompleted
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                              : 'border-zinc-200 bg-white text-zinc-500 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700'
                          }`}
                        >
                          <span>Send to print</span><ChevronRight className="h-2.5 w-2.5" />
                        </motion.button>
                      </div>
                    </div>

                    {/* Inline notes editor */}
                    <AnimatePresence initial={false}>
                      {noteOpen && (
                        <motion.div
                          key="note"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                          className="overflow-hidden"
                        >
                          <div className="mx-4 mb-3 flex items-end gap-2 rounded-2xl border border-amber-100 bg-amber-50/70 px-3 py-2">
                            <textarea
                              value={noteText}
                              onChange={(e) => handleNoteChange(item.id, e.target.value)}
                              placeholder="Add a note for this item…"
                              rows={2}
                              autoFocus
                              className="flex-1 resize-none bg-transparent text-[10px] font-medium leading-5 text-zinc-700 outline-none placeholder:text-zinc-400"
                            />
                            <button
                              type="button"
                              onClick={() => setExpandedNoteId(null)}
                              className="rounded-full p-1 text-zinc-300 transition-colors hover:bg-white/70 hover:text-zinc-600"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}

            </AnimatePresence>
          )}
        </div>
      </div>

      {/* ── Undo toast ── */}
      <AnimatePresence>
        {undoToast && (
          <motion.div
            key="undo"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="absolute bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-emerald-200 bg-white px-3 py-2.5 shadow-lg shadow-zinc-200/80"
          >
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
            <p className="max-w-[200px] truncate text-[10px] font-bold text-zinc-700">Moved to print: <span className="text-zinc-500">{undoToast.label}</span></p>
            <button
              type="button"
              onClick={handleUndoMoveToPrint}
              className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
            >
              Undo
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
