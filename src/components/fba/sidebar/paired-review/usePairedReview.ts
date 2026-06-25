'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FbaBoardItem } from '@/components/fba/FbaBoardTable';
import { safeRandomUUID } from '@/lib/safe-uuid';
import { useFbaDragAndDrop } from '@/components/fba/sidebar/useFbaDragAndDrop';
import type { StationTheme } from '@/utils/staff-colors';
import { fbaSidebarThemeChrome, stationThemeColors } from '@/utils/staff-colors';
import { getUniquePlanIds } from '@/lib/fba/pairing';
import { fbaPaths } from '@/lib/fba/api-paths';
import type { PanelAllocations, TrackingBucket as TrackingBucketType } from '@/lib/fba/types';
import {
  FBA_BOARD_DESELECT_ITEM,
  FBA_BOARD_REMOVE_ITEMS,
  FBA_PAIRED_SELECTION,
  FBA_PRINT_SHIPPED,
  FBA_REEDIT_SHIPMENT,
  FBA_SELECTION_ADJUSTED,
  FBA_SEND_SHIPMENT_TO_PAIRED_REVIEW,
  USAV_REFRESH_DATA,
  FBA_SCAN_STATUS,
  FBA_ACTIVE_SHIPMENTS_REFRESH,
} from '@/lib/fba/events';

export interface FbaPairedReviewPanelProps {
  selectedItems: FbaBoardItem[];
  stationTheme?: StationTheme;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  /**
   * 'panel'     — narrow vertical stack for the sidebar (legacy).
   * 'workspace' — wide horizontal kanban for the center crossfade: Unallocated
   *               tray + one column per UPS box, FBA ID + Save in a top toolbar.
   */
  layout?: 'panel' | 'workspace';
}

/**
 * Owns the FBA combine-review panel: FBA-Shipment-ID + bucket allocations, the
 * selection↔allocation sync, the cross-component event wiring (send-to-review,
 * re-edit, adjusted totals), drag-and-drop (via {@link useFbaDragAndDrop}), and
 * the multi-step Save (qty overrides, split-into-new-plan or per-bucket tracking
 * POST + FBA-ID stamp). Returns a controller bag the layout components render.
 */
export function usePairedReview({
  selectedItems,
  stationTheme = 'green',
  layout = 'panel',
}: FbaPairedReviewPanelProps) {
  const chrome = fbaSidebarThemeChrome[stationTheme];
  const themeColors = stationThemeColors[stationTheme];

  // Kanban (workspace layout): translate a vertical scroll wheel into horizontal
  // scroll so the UPS-box columns can be panned left/right with the mouse wheel.
  const kanbanScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (layout !== 'workspace') return;
    const el = kanbanScrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      // Let native horizontal gestures (trackpad) pass through untouched.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (el.scrollWidth <= el.clientWidth) return; // nothing to pan
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [layout]);

  const [amazonShipmentId, setAmazonShipmentId] = useState('');
  const [lockedFbaId, setLockedFbaId] = useState<string | null>(null);
  const [allocations, setAllocations] = useState<PanelAllocations>({ unallocated: [], buckets: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [stampedPlanIds, setStampedPlanIds] = useState<Set<number>>(new Set());
  const [activeSplit, setActiveSplit] = useState<{
    sourcePlanId: number;
    prefilledAmazonShipmentId: string;
  } | null>(null);

  const planIds = getUniquePlanIds(selectedItems);
  const activeFbaId = lockedFbaId || amazonShipmentId.trim();

  const itemMap = useMemo(
    () => new Map(selectedItems.map((i) => [i.item_id, i])),
    [selectedItems],
  );

  const getItemFnsku = useCallback(
    (itemId: number) => String(itemMap.get(itemId)?.fnsku || '').toUpperCase(),
    [itemMap],
  );

  // Sync selected items with allocations. Always keep at least one UPS box so
  // there's somewhere to allocate; when it's the only box, newly-selected items
  // drop straight into it (the common single-box case). Extra boxes still pull
  // from Unallocated by dragging.
  useEffect(() => {
    if (selectedItems.length === 0) return; // keep state (locked-FBA flow) when nothing selected
    const currentIds = new Set(selectedItems.map((i) => i.item_id));

    setAllocations((prev) => {
      // Seed one UPS box if there are none yet.
      const seededBuckets = prev.buckets.length > 0
        ? prev.buckets
        : [{ bucketId: safeRandomUUID(), trackingNumber: '', carrier: 'UPS', allocations: [], collapsed: false }];

      // Collect all item IDs currently in allocations
      const allocatedIds = new Set<number>();
      for (const a of prev.unallocated) allocatedIds.add(a.item_id);
      for (const b of seededBuckets) {
        for (const a of b.allocations) allocatedIds.add(a.item_id);
      }

      const newAllocs = selectedItems
        .filter((i) => !allocatedIds.has(i.item_id))
        .map((i) => ({ item_id: i.item_id, qty: Math.max(1, Number(i.actual_qty || 0)) }));

      // Remove items no longer in selection
      const filterAllocs = (list: { item_id: number; qty: number }[]) =>
        list.filter((a) => currentIds.has(a.item_id));

      const singleBox = seededBuckets.length === 1;
      const nextUnallocated = singleBox
        ? filterAllocs(prev.unallocated)
        : [...filterAllocs(prev.unallocated), ...newAllocs];
      const nextBuckets = seededBuckets.map((b, i) => ({
        ...b,
        allocations: singleBox && i === 0
          ? [...filterAllocs(b.allocations), ...newAllocs]
          : filterAllocs(b.allocations),
      }));

      return { unallocated: nextUnallocated, buckets: nextBuckets };
    });
  }, [selectedItems]);

  // Compute total qty across all allocations for adjusted event
  const totalQty = useMemo(() => {
    let sum = 0;
    for (const a of allocations.unallocated) sum += a.qty;
    for (const b of allocations.buckets) {
      for (const a of b.allocations) sum += a.qty;
    }
    return sum;
  }, [allocations]);

  // Emit adjusted totals so microcopy stays in sync
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(FBA_SELECTION_ADJUSTED, {
      detail: { selected: selectedItems.length, selectedQty: totalQty },
    }));
  }, [selectedItems.length, totalQty]);

  // Active shipment card → prefill FBA ID + UPS and set combine selection
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<{
        items: FbaBoardItem[];
        amazonShipmentId: string;
        upsTracking: string;
        activeShipmentSplit?: { sourcePlanId: number; prefilledAmazonShipmentId: string };
      }>).detail;
      if (!d?.items?.length) return;

      const fbaId = String(d.amazonShipmentId || '').trim().toUpperCase();
      const ups = String(d.upsTracking || '').trim().toUpperCase();

      setAmazonShipmentId(fbaId);
      setLockedFbaId(null);
      setStampedPlanIds(new Set());
      setActiveSplit(d.activeShipmentSplit ?? null);
      setError(null);
      setSuccess(null);

      // Build allocations: if UPS tracking provided, create a pre-populated bucket
      const itemAllocations = d.items.map((it) => ({
        item_id: it.item_id,
        qty: Math.max(0, Number(it.expected_qty || 0)),
      }));

      if (ups) {
        setAllocations({
          unallocated: [],
          buckets: [{
            bucketId: safeRandomUUID(),
            trackingNumber: ups,
            carrier: 'UPS',
            allocations: itemAllocations,
            collapsed: false,
          }],
        });
      } else {
        setAllocations({ unallocated: itemAllocations, buckets: [] });
      }

      window.dispatchEvent(new CustomEvent(FBA_PAIRED_SELECTION, { detail: d.items }));
    };
    window.addEventListener(FBA_SEND_SHIPMENT_TO_PAIRED_REVIEW, handler as EventListener);

    // Re-edit: lock an FBA Shipment ID from the active shipments display
    const reeditHandler = (e: Event) => {
      const d = (e as CustomEvent<{ amazonShipmentId: string }>).detail;
      if (!d?.amazonShipmentId) return;
      const fbaId = d.amazonShipmentId.trim().toUpperCase();
      setLockedFbaId(fbaId);
      setAmazonShipmentId(fbaId);
      setAllocations({ unallocated: [], buckets: [] });
      setError(null);
      setSuccess('Select items to add or reassign under this FBA Shipment ID');
    };
    window.addEventListener(FBA_REEDIT_SHIPMENT, reeditHandler as EventListener);

    return () => {
      window.removeEventListener(FBA_SEND_SHIPMENT_TO_PAIRED_REVIEW, handler as EventListener);
      window.removeEventListener(FBA_REEDIT_SHIPMENT, reeditHandler as EventListener);
    };
  }, []);

  // DnD hook
  const {
    activeItemId,
    sensors,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
    splitState,
    confirmSplit,
    cancelSplit,
  } = useFbaDragAndDrop({ allocations, setAllocations, getItemFnsku });

  const activeItem = activeItemId != null ? itemMap.get(activeItemId) : null;

  // Qty change handler — updates qty in whichever container the item lives in
  const handleQtyChange = useCallback((itemId: number, qty: number) => {
    setAllocations((prev) => {
      const inUnalloc = prev.unallocated.find((a) => a.item_id === itemId);
      if (inUnalloc) {
        return {
          ...prev,
          unallocated: prev.unallocated.map((a) => a.item_id === itemId ? { ...a, qty } : a),
        };
      }
      return {
        ...prev,
        buckets: prev.buckets.map((b) => ({
          ...b,
          allocations: b.allocations.map((a) => a.item_id === itemId ? { ...a, qty } : a),
        })),
      };
    });
  }, []);

  // Remove item from selection entirely
  const removeSelectedItem = useCallback((item: FbaBoardItem) => {
    window.dispatchEvent(new CustomEvent(FBA_BOARD_DESELECT_ITEM, { detail: item.item_id }));
    setAllocations((prev) => ({
      unallocated: prev.unallocated.filter((a) => a.item_id !== item.item_id),
      buckets: prev.buckets.map((b) => ({
        ...b,
        allocations: b.allocations.filter((a) => a.item_id !== item.item_id),
      })),
    }));
  }, []);

  // Add new UPS tracking bucket
  const addBucket = useCallback(() => {
    setAllocations((prev) => {
      const soleUnallocated = prev.unallocated.length === 1 ? prev.unallocated[0] : null;
      const newBucket = {
        bucketId: safeRandomUUID(),
        trackingNumber: '',
        carrier: 'UPS',
        allocations: soleUnallocated ? [soleUnallocated] : [],
        collapsed: false,
      };
      return {
        unallocated: soleUnallocated ? [] : prev.unallocated,
        buckets: [...prev.buckets, newBucket],
      };
    });
  }, []);

  // Update tracking number on a bucket
  const handleTrackingChange = useCallback((bucketId: string, value: string) => {
    setAllocations((prev) => ({
      ...prev,
      buckets: prev.buckets.map((b) =>
        b.bucketId === bucketId ? { ...b, trackingNumber: value } : b,
      ),
    }));
  }, []);

  // Toggle collapse on a bucket
  const handleToggleCollapse = useCallback((bucketId: string) => {
    setAllocations((prev) => ({
      ...prev,
      buckets: prev.buckets.map((b) =>
        b.bucketId === bucketId ? { ...b, collapsed: !b.collapsed } : b,
      ),
    }));
  }, []);

  // Delete a bucket — items return to unallocated
  const handleDeleteBucket = useCallback((bucketId: string) => {
    setAllocations((prev) => {
      const bucket = prev.buckets.find((b) => b.bucketId === bucketId);
      return {
        unallocated: [...prev.unallocated, ...(bucket?.allocations ?? [])],
        buckets: prev.buckets.filter((b) => b.bucketId !== bucketId),
      };
    });
  }, []);

  // Dismiss FBA ID
  const handleDismissFbaId = useCallback(() => {
    setLockedFbaId(null);
    setAmazonShipmentId('');
    setStampedPlanIds(new Set());
    setActiveSplit(null);
    setAllocations({ unallocated: [], buckets: [] });
    setSuccess(null);
    setError(null);
  }, []);

  // Save all allocations
  const handleSaveAll = useCallback(async () => {
    // Validate: buckets with items must have tracking
    const bucketsWithItems = allocations.buckets.filter((b) => b.allocations.length > 0);
    for (const b of bucketsWithItems) {
      if (!b.trackingNumber.trim()) {
        setError('Enter a UPS tracking number for every box that has items');
        return;
      }
    }
    if (bucketsWithItems.length === 0) {
      setError('Add at least one UPS tracking box with items');
      return;
    }
    if (planIds.length === 0) {
      setError('No items selected');
      return;
    }

    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      // Collect all allocated items across all buckets
      const allAllocatedItems: { item: FbaBoardItem; selectedQty: number; bucket: TrackingBucketType }[] = [];
      for (const bucket of bucketsWithItems) {
        for (const alloc of bucket.allocations) {
          const item = itemMap.get(alloc.item_id);
          if (!item || alloc.qty <= 0) continue;
          allAllocatedItems.push({ item, selectedQty: alloc.qty, bucket });
        }
      }

      if (allAllocatedItems.length === 0) {
        throw new Error('Select at least one qty');
      }

      // Persist qty overrides
      for (const { item, selectedQty } of allAllocatedItems) {
        const qty = Math.max(1, selectedQty);
        if (qty === Number(item.expected_qty || 0)) continue;
        await fetch(fbaPaths.planItem(item.shipment_id, item.item_id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expected_qty: qty }),
        });
      }

      const prefilledUpper = (activeSplit?.prefilledAmazonShipmentId ?? '').trim().toUpperCase();
      const newFbaUpper = activeFbaId.trim().toUpperCase();
      const shouldSplitNewPlan =
        activeSplit != null &&
        newFbaUpper.length > 0 &&
        newFbaUpper !== prefilledUpper;

      if (shouldSplitNewPlan) {
        if (planIds.length !== 1 || planIds[0] !== activeSplit.sourcePlanId) {
          throw new Error(
            'Changing the FBA Shipment ID here only works when every line is from the same active shipment you opened from.',
          );
        }
        // Combine all bucket items into one split payload
        const allLines = allAllocatedItems.map(({ item, selectedQty }) => ({
          shipment_item_id: Number(item.item_id),
          quantity: Math.max(1, selectedQty),
        }));
        const splitRes = await fetch(fbaPaths.splitForPairedReview(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_shipment_id: activeSplit.sourcePlanId,
            new_amazon_shipment_id: newFbaUpper,
            tracking_number: bucketsWithItems[0].trackingNumber.trim(),
            carrier: 'UPS',
            label: 'UPS',
            lines: allLines,
          }),
        });
        const splitData = await splitRes.json().catch(() => ({}));
        if (!splitRes.ok) throw new Error(splitData?.error || 'Failed to split into new shipment');
        setActiveSplit(null);
      } else {
        // Save each bucket as a separate tracking POST
        for (const bucket of bucketsWithItems) {
          const trackingRaw = bucket.trackingNumber.trim();
          for (const pid of planIds) {
            const planAllocations = bucket.allocations
              .filter((alloc) => {
                const item = itemMap.get(alloc.item_id);
                return item && Number(item.shipment_id) === pid;
              })
              .map((alloc) => ({
                shipment_item_id: Number(alloc.item_id),
                quantity: Math.max(1, alloc.qty),
              }));
            if (planAllocations.length === 0) continue;

            const res = await fetch(fbaPaths.planTracking(pid), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tracking_number: trackingRaw,
                carrier: 'UPS',
                label: 'UPS',
                allocations: planAllocations,
              }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || `Failed for plan ${pid}`);
          }
        }

        // Stamp FBA Shipment ID
        const fbaId = activeFbaId;
        if (fbaId) {
          const unstamped = planIds.filter((pid) => !stampedPlanIds.has(pid));
          for (const pid of unstamped) {
            await fetch(fbaPaths.plan(pid), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ amazon_shipment_id: fbaId }),
            });
          }
          setLockedFbaId(fbaId);
          setStampedPlanIds((prev) => {
            const next = new Set(prev);
            for (const pid of planIds) next.add(pid);
            return next;
          });
        }
        setActiveSplit(null);
      }

      // Remove combined items from the board
      const combinedIds = allAllocatedItems.map(({ item }) => item.item_id);
      window.dispatchEvent(new CustomEvent(FBA_BOARD_REMOVE_ITEMS, { detail: combinedIds }));
      window.dispatchEvent(new CustomEvent('fba-board-toggle-all', { detail: 'none' }));

      // Clear buckets for next batch — FBA Shipment ID stays locked
      setAllocations({ unallocated: [], buckets: [] });
      const lineCount = allAllocatedItems.length;
      const boxCount = bucketsWithItems.length;
      const msg = `Combined ${lineCount} line${lineCount === 1 ? '' : 's'} into ${boxCount} box${boxCount === 1 ? '' : 'es'}`;
      setSuccess(msg);
      window.dispatchEvent(new CustomEvent(FBA_SCAN_STATUS, { detail: msg }));
      window.dispatchEvent(new CustomEvent(FBA_PRINT_SHIPPED));
      window.dispatchEvent(new CustomEvent(FBA_ACTIVE_SHIPMENTS_REFRESH));
      window.dispatchEvent(new CustomEvent(USAV_REFRESH_DATA));
    } catch (err: any) {
      setError(err?.message || 'Failed to attach tracking');
    } finally {
      setSaving(false);
    }
  }, [allocations, activeFbaId, planIds, selectedItems, itemMap, stampedPlanIds, activeSplit]);

  // Total qty for collapsed strip
  const collapsedTotalQty = totalQty;

  const hasAllocatedItems = allocations.buckets.some((b) => b.allocations.length > 0);
  const hasItems = selectedItems.length > 0;

  return {
    chrome,
    themeColors,
    kanbanScrollRef,
    amazonShipmentId, setAmazonShipmentId,
    lockedFbaId,
    allocations,
    saving, error, success,
    activeSplit,
    totalQty, collapsedTotalQty,
    activeItem,
    sensors, handleDragStart, handleDragEnd, handleDragCancel,
    splitState, confirmSplit, cancelSplit,
    handleQtyChange, removeSelectedItem, addBucket,
    handleTrackingChange, handleToggleCollapse, handleDeleteBucket,
    handleDismissFbaId, handleSaveAll,
    hasAllocatedItems, hasItems,
  };
}

export type PairedReviewController = ReturnType<typeof usePairedReview>;
