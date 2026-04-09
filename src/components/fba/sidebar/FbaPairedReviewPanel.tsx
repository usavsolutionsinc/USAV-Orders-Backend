'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core';
import { AnimatePresence } from 'framer-motion';
import { Check, ChevronDown, ChevronUp, Loader2, Plus } from '@/components/Icons';
import type { FbaBoardItem } from '@/components/fba/FbaBoardTable';
import { FbaSelectedLineRow } from '@/components/fba/sidebar/FbaSelectedLineRow';
import { FbaUnallocatedBucket } from '@/components/fba/sidebar/FbaUnallocatedBucket';
import { FbaTrackingBucket } from '@/components/fba/sidebar/FbaTrackingBucket';
import { FbaQtySplitPopover } from '@/components/fba/sidebar/FbaQtySplitPopover';
import { useFbaDragAndDrop } from '@/components/fba/sidebar/useFbaDragAndDrop';
import { microBadge } from '@/design-system/tokens/typography/presets';
import type { StationTheme } from '@/utils/staff-colors';
import { fbaSidebarThemeChrome } from '@/utils/staff-colors';
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
import { emitOpenQuickAddFnsku } from '@/components/fba/FbaQuickAddFnskuModal';

interface FbaPairedReviewPanelProps {
  selectedItems: FbaBoardItem[];
  stationTheme?: StationTheme;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

export function FbaPairedReviewPanel({
  selectedItems,
  stationTheme = 'green',
  expanded = true,
  onToggleExpanded,
}: FbaPairedReviewPanelProps) {
  const chrome = fbaSidebarThemeChrome[stationTheme];

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

  // Sync selected items with allocations — add new items to unallocated, remove deselected items
  useEffect(() => {
    const currentIds = new Set(selectedItems.map((i) => i.item_id));

    setAllocations((prev) => {
      // Collect all item IDs currently in allocations
      const allocatedIds = new Set<number>();
      for (const a of prev.unallocated) allocatedIds.add(a.item_id);
      for (const b of prev.buckets) {
        for (const a of b.allocations) allocatedIds.add(a.item_id);
      }

      // Find new items to add to unallocated
      const newItems = selectedItems.filter((i) => !allocatedIds.has(i.item_id));

      // Remove items no longer in selection
      const filterAllocs = (list: { item_id: number; qty: number }[]) =>
        list.filter((a) => currentIds.has(a.item_id));

      const nextUnallocated = [
        ...filterAllocs(prev.unallocated),
        ...newItems.map((i) => ({ item_id: i.item_id, qty: Math.max(1, Number(i.actual_qty || 0)) })),
      ];
      const nextBuckets = prev.buckets.map((b) => ({
        ...b,
        allocations: filterAllocs(b.allocations),
      }));

      // Only update if something changed
      const unallocChanged = nextUnallocated.length !== prev.unallocated.length || newItems.length > 0;
      const bucketsChanged = nextBuckets.some((b, i) => b.allocations.length !== prev.buckets[i]?.allocations.length);

      if (!unallocChanged && !bucketsChanged) return prev;
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
            bucketId: crypto.randomUUID(),
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
    setAllocations((prev) => ({
      ...prev,
      buckets: [
        ...prev.buckets,
        {
          bucketId: crypto.randomUUID(),
          trackingNumber: '',
          carrier: 'UPS',
          allocations: [],
          collapsed: false,
        },
      ],
    }));
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

  // Compact strip when collapsed
  if (!expanded && onToggleExpanded) {
    return (
      <div className="shrink-0 border-b border-gray-100 px-3 py-2">
        <button
          type="button"
          onClick={onToggleExpanded}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50/90 px-2.5 py-2 text-left transition-colors hover:bg-gray-100"
          aria-expanded={false}
        >
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-600">
            Combine review
          </span>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            {selectedItems.length > 0 ? (
              <span className="truncate text-[10px] font-bold tabular-nums text-gray-500">
                {selectedItems.length} · {collapsedTotalQty}
              </span>
            ) : lockedFbaId ? (
              <span className="truncate font-mono text-[10px] font-bold text-emerald-700">{lockedFbaId}</span>
            ) : (
              <span className="text-[10px] font-semibold text-gray-400">Tap to expand</span>
            )}
            <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
          </div>
        </button>
      </div>
    );
  }

  // Panel stays visible when FBA ID is locked
  if (selectedItems.length === 0 && !lockedFbaId) return null;

  const hasAllocatedItems = allocations.buckets.some((b) => b.allocations.length > 0);
  const hasItems = selectedItems.length > 0;

  return (
    <div className="border-b border-gray-100">
      {onToggleExpanded ? (
        <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Combine review</p>
          <button
            type="button"
            onClick={onToggleExpanded}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Collapse combine review"
            title="Collapse"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <div className="space-y-2 px-3 pb-3 pt-1">
        {/* FBA Shipment ID — parent card header */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">FBA Shipment ID</p>
            {lockedFbaId && (
              <button
                type="button"
                onClick={handleDismissFbaId}
                className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 transition-colors hover:bg-emerald-200"
                aria-label="Done — clear FBA Shipment ID"
                title="Done with this FBA Shipment ID"
              >
                <Check className="h-3 w-3" />
              </button>
            )}
          </div>
          <input
            value={lockedFbaId || amazonShipmentId}
            onChange={(e) => {
              if (lockedFbaId) return;
              setAmazonShipmentId(e.target.value.toUpperCase());
            }}
            placeholder="FBA1234ABCD"
            disabled={saving || Boolean(lockedFbaId)}
            className={`${chrome.monoInput} ${lockedFbaId ? '!bg-emerald-50 !border-emerald-200 !text-emerald-800' : ''}`}
          />
          {activeSplit ? (
            <p className="mt-1.5 text-[9px] font-semibold leading-snug text-amber-800">
              If you change this FBA ID from the prefilled value, Save creates a new active shipment for these
              FNSKUs with this Amazon ID and UPS; the original card keeps its FBA ID for remaining lines.
            </p>
          ) : null}
        </div>

        {/* Drag-and-drop hierarchy: Unallocated + UPS Tracking Buckets */}
        {hasItems ? (
          <div className="relative space-y-2">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <FbaUnallocatedBucket
                allocations={allocations.unallocated}
                selectedItems={selectedItems}
                stationTheme={stationTheme}
                onQtyChange={handleQtyChange}
                onRemoveItem={removeSelectedItem}
              />

              {allocations.buckets.map((bucket) => (
                <FbaTrackingBucket
                  key={bucket.bucketId}
                  bucket={bucket}
                  selectedItems={selectedItems}
                  stationTheme={stationTheme}
                  saving={saving}
                  onTrackingChange={handleTrackingChange}
                  onQtyChange={handleQtyChange}
                  onRemoveItem={removeSelectedItem}
                  onToggleCollapse={handleToggleCollapse}
                  onDelete={handleDeleteBucket}
                />
              ))}

              <DragOverlay>
                {activeItem ? (
                  <div className="rounded-lg border border-blue-300 bg-white/95 shadow-lg">
                    <FbaSelectedLineRow
                      displayTitle={activeItem.display_title || 'No title'}
                      fnsku={String(activeItem.fnsku || '').toUpperCase()}
                      stationTheme={stationTheme}
                      checked
                      checkboxDisabled
                      rightSlot={null}
                    />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>

            {/* Qty split popover */}
            <AnimatePresence>
              {splitState && (
                <FbaQtySplitPopover
                  itemId={splitState.itemId}
                  fnsku={splitState.fnsku}
                  maxQty={splitState.maxQty}
                  onConfirm={confirmSplit}
                  onCancel={cancelSplit}
                />
              )}
            </AnimatePresence>
          </div>
        ) : lockedFbaId ? (
          <p className={`${microBadge} tracking-wider text-emerald-600`}>
            Select more items to add another UPS tracking to {lockedFbaId}
          </p>
        ) : null}

        {/* Add UPS Tracking bucket button */}
        {hasItems ? (
          <button
            type="button"
            onClick={addBucket}
            disabled={saving}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 text-[10px] font-bold uppercase tracking-wider text-gray-500 transition-colors hover:border-blue-400 hover:bg-blue-50/50 hover:text-blue-600 disabled:opacity-40"
          >
            <Plus className="h-3 w-3" />
            Add UPS Tracking Box
          </button>
        ) : null}

        {/* Error / success messages */}
        {error && <p className={`${microBadge} tracking-wider text-red-600`}>{error}</p>}
        {success && <p className={`${microBadge} tracking-wider text-emerald-600`}>{success}</p>}

        {/* Save button */}
        {hasAllocatedItems ? (
          <button
            type="button"
            onClick={() => void handleSaveAll()}
            disabled={saving}
            className={`flex h-10 items-center justify-center gap-1.5 ${chrome.primaryButton}`}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-white" /> : null}
            {lockedFbaId ? 'Save UPS Tracking' : 'Save Shipment + UPS'}
          </button>
        ) : hasItems && allocations.buckets.length === 0 ? (
          <p className={`${microBadge} text-center tracking-wider text-gray-400`}>
            Add a UPS tracking box, then drag items into it
          </p>
        ) : null}
      </div>
    </div>
  );
}
