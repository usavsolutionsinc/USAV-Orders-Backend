'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import type { BundleItemAllocation, TrackingBundleDraft } from '@/components/fba/sidebar/FbaTrackingBundleCard';
import { fbaPaths } from '@/lib/fba/api-paths';
import { deleteFbaItem } from '@/lib/fba/patch';
import { FBA_ACTIVE_SHIPMENTS_REFRESH, USAV_REFRESH_DATA, FBA_FNSKU_SAVED } from '@/lib/fba/events';
import { useFbaEvent } from '@/components/fba/hooks/useFbaEvent';
import { useFnskuSearch, type FnskuSearchResult } from '@/components/fba/hooks/useFnskuSearch';
import { emitAppEvent, useResourceMutation } from '@/hooks';
import { fbaSidebarThemeChrome } from '@/utils/staff-colors';
import type { ShipmentCardItem } from '@/lib/fba/types';
import {
  UNALLOCATED_ID,
  UNDO_EXPIRY_MS,
  buildInitialBundles,
  droppableIdForBundle,
  loadUndoStack,
  mapPlanItems,
  parseBundleIndex,
  saveUndoStack,
  type FbaShipmentEditorFormProps,
  type MoveUndoEntry,
  type UndoEntry,
} from './shipment-editor-helpers';

/**
 * Owns the entire FBA shipment editor: amazon id + bundle drafts + working item
 * list, the multi-step save, multi-select, undo + move-undo stacks, FNSKU
 * search/add, bundle CRUD, allocation qty edits, and the group-aware drag-and-drop
 * with qty-split. Returns a controller bag the thin `FbaShipmentEditorForm`
 * shell renders from.
 */
export function useShipmentEditor({
  shipment,
  stationTheme = 'green',
  onClose,
  onChanged,
}: FbaShipmentEditorFormProps) {
  const chrome = fbaSidebarThemeChrome[stationTheme];

  const [amazonShipmentId, setAmazonShipmentId] = useState(shipment.amazon_shipment_id || '');
  const [bundles, setBundles] = useState<TrackingBundleDraft[]>(() => buildInitialBundles(shipment));
  const [items, setItems] = useState<ShipmentCardItem[]>(shipment.items);
  const [removedItemIds, setRemovedItemIds] = useState<Set<number>>(new Set());

  // ── Save (multi-step write) ──
  const saveMut = useResourceMutation(
    async () => {
      // Every write below is checked: a non-OK response throws so the modal
      // surfaces the failure instead of closing as if the save succeeded.
      const ensureOk = async (res: Response, fallback: string) => {
        if (res.ok) return;
        const data = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(String(data?.error || `${fallback} (${res.status})`));
      };
      const newAmazon = amazonShipmentId.trim().toUpperCase();
      if (newAmazon !== (shipment.amazon_shipment_id || '').trim().toUpperCase()) {
        const res = await fetch(fbaPaths.plan(shipment.id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amazon_shipment_id: newAmazon || null }) });
        await ensureOk(res, 'Failed to update FBA Shipment ID');
      }
      const currentLinkIds = new Set(bundles.map((b) => b.link_id).filter(Boolean));
      for (const ob of shipment.bundles) {
        if (!currentLinkIds.has(ob.link_id)) {
          const res = await fetch(`${fbaPaths.planTracking(shipment.id)}?link_id=${ob.link_id}`, { method: 'DELETE' });
          await ensureOk(res, 'Failed to remove tracking');
        }
      }
      for (const bundle of bundles) {
        const allocations = bundle.allocations.map((a) => ({ shipment_item_id: a.item_id, qty: a.qty }));
        if (bundle.link_id) {
          const res = await fetch(fbaPaths.planTracking(shipment.id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ link_id: bundle.link_id, tracking_number: bundle.tracking_number.trim(), carrier: bundle.carrier || 'UPS', allocations }) });
          await ensureOk(res, 'Failed to update tracking');
        } else if (bundle.tracking_number.trim()) {
          const res = await fetch(fbaPaths.planTracking(shipment.id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tracking_number: bundle.tracking_number.trim(), carrier: bundle.carrier || 'UPS', allocations }) });
          await ensureOk(res, 'Failed to add tracking');
        }
      }
      for (const itemId of removedItemIds) {
        const result = await deleteFbaItem(shipment.id, itemId);
        if (!result.ok) throw new Error(result.error || 'Failed to remove item');
      }
      saveUndoStack(shipment.id, []);
    },
    {
      onSuccess: () => {
        emitAppEvent(FBA_ACTIVE_SHIPMENTS_REFRESH);
        emitAppEvent(USAV_REFRESH_DATA);
        onChanged();
        onClose();
      },
    },
  );
  const saving = saveMut.isPending;
  const saveError = saveMut.error?.message ?? null;

  // ── Multi-select ──
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const toggleSelect = useCallback((itemId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  const selectAllInBundle = useCallback((bundleIndex: number) => {
    const bundle = bundles[bundleIndex];
    if (!bundle) return;
    const ids = bundle.allocations.map((a) => a.item_id);
    if (ids.length === 0) return;
    setSelectedIds((sel) => {
      const next = new Set(sel);
      const allSelected = ids.every((id) => next.has(id));
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }, [bundles]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // ── Undo ──
  const [undoStack, setUndoStack] = useState<UndoEntry[]>(() => loadUndoStack(shipment.id));

  const pushUndo = useCallback(
    (entry: Omit<UndoEntry, 'removedAt'>) => {
      setUndoStack((prev) => {
        const next = [...prev.filter((e) => e.item_id !== entry.item_id), { ...entry, removedAt: Date.now() }];
        saveUndoStack(shipment.id, next);
        return next;
      });
    },
    [shipment.id],
  );

  const popUndo = useCallback(
    (itemId: number) => {
      const entry = undoStack.find((e) => e.item_id === itemId);
      if (!entry) return;
      setRemovedItemIds((prev) => { const n = new Set(prev); n.delete(itemId); return n; });
      if (entry.bundleIndex != null) {
        setBundles((prev) => {
          if (entry.bundleIndex! >= prev.length) return prev;
          return prev.map((b, i) => {
            if (i !== entry.bundleIndex || b.allocations.some((a) => a.item_id === itemId)) return b;
            return { ...b, allocations: [...b.allocations, { item_id: entry.item_id, fnsku: entry.fnsku, display_title: entry.display_title, qty: entry.expected_qty, max_qty: entry.expected_qty }] };
          });
        });
      }
      setUndoStack((prev) => { const n = prev.filter((e) => e.item_id !== itemId); saveUndoStack(shipment.id, n); return n; });
    },
    [undoStack, shipment.id],
  );

  const dismissUndo = useCallback(
    (itemId: number) => {
      setUndoStack((prev) => { const n = prev.filter((e) => e.item_id !== itemId); saveUndoStack(shipment.id, n); return n; });
    },
    [shipment.id],
  );

  useEffect(() => {
    const now = Date.now();
    setUndoStack((prev) => {
      const valid = prev.filter((e) => now - e.removedAt < UNDO_EXPIRY_MS);
      if (valid.length !== prev.length) saveUndoStack(shipment.id, valid);
      return valid;
    });
  }, [shipment.id]);

  const visibleUndos = useMemo(
    () => undoStack.filter((e) => removedItemIds.has(e.item_id)),
    [undoStack, removedItemIds],
  );

  // ── FNSKU search ──
  const [fnskuSearchOpen, setFnskuSearchOpen] = useState(false);
  const [fnskuQuery, setFnskuQuery] = useState('');
  const [addingFnsku, setAddingFnsku] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { results: fnskuResults, searching: fnskuSearching } = useFnskuSearch(fnskuQuery, fnskuSearchOpen);

  useEffect(() => {
    if (fnskuSearchOpen) setTimeout(() => searchInputRef.current?.focus(), 40);
    else setFnskuQuery('');
  }, [fnskuSearchOpen]);

  // Reload the canonical plan-items list into the editor's working state.
  const reloadItems = useCallback(async () => {
    const res = await fetch(fbaPaths.planItems(shipment.id), { cache: 'no-store' });
    const data = await res.json();
    if (data.success && Array.isArray(data.items)) setItems(mapPlanItems(data.items, shipment.id));
  }, [shipment.id]);

  const addItemMut = useResourceMutation((result: FnskuSearchResult) =>
    fetch(fbaPaths.planItems(shipment.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fnsku: result.fnsku, expected_qty: 1, product_title: result.product_title, asin: result.asin, sku: result.sku }),
    }).then((r) => r.json() as Promise<{ success?: boolean }>),
  );

  const handleAddFnskuToShipment = useCallback(
    async (result: FnskuSearchResult) => {
      if (items.some((i) => i.fnsku.toUpperCase() === result.fnsku.toUpperCase())) return;
      setAddingFnsku(result.fnsku);
      try {
        const data = await addItemMut.mutateAsync(result);
        if (data.success) {
          await reloadItems();
          setFnskuQuery('');
          setFnskuSearchOpen(false);
        }
      } catch { /* ignore — the original add flow swallowed errors too */ }
      setAddingFnsku(null);
    },
    [items, addItemMut, reloadItems],
  );

  // ── DnD ──
  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const [splitState, setSplitState] = useState<{
    itemId: number; fnsku: string; sourceContainer: string; destContainer: string; maxQty: number;
  } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Sync on prop change
  useEffect(() => {
    setAmazonShipmentId(shipment.amazon_shipment_id || '');
    setBundles(buildInitialBundles(shipment));
    setItems(shipment.items);
    setRemovedItemIds(new Set());
    setSelectedIds(new Set());
    saveMut.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipment]);

  useFbaEvent(FBA_FNSKU_SAVED, () => { void reloadItems(); });

  // ── Derived ──
  const unallocatedItems = useMemo(() => {
    const allocatedIds = new Set<number>();
    for (const b of bundles) for (const a of b.allocations) allocatedIds.add(a.item_id);
    return items.filter((i) => !allocatedIds.has(i.item_id) && !removedItemIds.has(i.item_id));
  }, [items, bundles, removedItemIds]);

  const totalAllocated = bundles.reduce((s, b) => s + b.allocations.reduce((ss, a) => ss + a.qty, 0), 0);
  const totalUnallocated = unallocatedItems.reduce((s, i) => s + i.expected_qty, 0);
  const selectionCount = selectedIds.size;

  // ── Bundle CRUD ──
  const addBundle = useCallback(() => {
    setBundles((prev) => {
      const allocatedIds = new Set<number>();
      for (const b of prev) for (const a of b.allocations) allocatedIds.add(a.item_id);
      const unallocated = items.filter((i) => !allocatedIds.has(i.item_id) && !removedItemIds.has(i.item_id));

      let initialAllocations: BundleItemAllocation[] = [];
      if (unallocated.length === 1) {
        const it = unallocated[0];
        initialAllocations = [
          {
            item_id: it.item_id,
            fnsku: it.fnsku,
            display_title: it.display_title || 'No title',
            qty: it.expected_qty,
            max_qty: it.expected_qty,
          },
        ];
      }

      // Prepend so newly added tracking sits above already-added ones
      return [
        { link_id: null, tracking_number: '', carrier: 'UPS', allocations: initialAllocations, collapsed: false },
        ...prev,
      ];
    });
  }, [items, removedItemIds]);

  const removeBundle = useCallback((index: number) => {
    setBundles((prev) => {
      const bundle = prev[index];
      if (bundle && bundle.allocations.length > 0) {
        // Stash a per-item undo entry so each freshly-unallocated item can be
        // restored to this bundle (lookup by link_id / tracking_number; bundle
        // gets recreated on first undo click if it's fully gone).
        setMoveUndo((prevMap) => {
          const n = new Map(prevMap);
          for (const alloc of bundle.allocations) {
            n.set(alloc.item_id, {
              qty: alloc.qty,
              maxQty: alloc.max_qty,
              link_id: bundle.link_id,
              tracking_number: bundle.tracking_number,
              carrier: bundle.carrier,
            });
          }
          return n;
        });
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const updateTrackingNumber = useCallback((index: number, value: string) => {
    setBundles((prev) => prev.map((b, i) => (i === index ? { ...b, tracking_number: value.toUpperCase() } : b)));
  }, []);

  const toggleCollapse = useCallback((index: number) => {
    setBundles((prev) => prev.map((b, i) => (i === index ? { ...b, collapsed: !b.collapsed } : b)));
  }, []);

  const [moveUndo, setMoveUndo] = useState<Map<number, MoveUndoEntry>>(new Map());

  const deallocateItem = useCallback((bundleIndex: number, itemId: number) => {
    const bundle = bundles[bundleIndex];
    const alloc = bundle?.allocations.find((a) => a.item_id === itemId);
    if (alloc && bundle) {
      setMoveUndo((prev) => {
        const n = new Map(prev);
        n.set(itemId, {
          qty: alloc.qty,
          maxQty: alloc.max_qty,
          link_id: bundle.link_id,
          tracking_number: bundle.tracking_number,
          carrier: bundle.carrier,
        });
        return n;
      });
    }
    setBundles((prev) => prev.map((b, i) => (i !== bundleIndex ? b : { ...b, allocations: b.allocations.filter((a) => a.item_id !== itemId) })));
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(itemId); return n; });
  }, [bundles]);

  // Find an existing bundle by stable identity (link_id preferred, tracking_number as fallback)
  const findBundleIndexByIdentity = (list: TrackingBundleDraft[], link_id: number | null, tracking_number: string): number => {
    if (link_id != null) {
      const i = list.findIndex((b) => b.link_id === link_id);
      if (i >= 0) return i;
    }
    const trimmed = tracking_number.trim().toUpperCase();
    if (trimmed) {
      const i = list.findIndex((b) => b.tracking_number.trim().toUpperCase() === trimmed);
      if (i >= 0) return i;
    }
    return -1;
  };

  const restoreToBundle = useCallback((itemId: number) => {
    const entry = moveUndo.get(itemId);
    if (!entry) return;
    const item = items.find((i) => i.item_id === itemId);
    if (!item) return;
    setBundles((prev) => {
      const idx = findBundleIndexByIdentity(prev, entry.link_id, entry.tracking_number);
      const newAlloc: BundleItemAllocation = {
        item_id: itemId,
        fnsku: item.fnsku,
        display_title: item.display_title,
        qty: entry.qty,
        max_qty: entry.maxQty,
      };
      if (idx >= 0) {
        // Bundle still exists (or was recreated by a sibling undo) — merge allocation
        return prev.map((b, i) => {
          if (i !== idx) return b;
          if (b.allocations.some((a) => a.item_id === itemId)) return b;
          return { ...b, allocations: [...b.allocations, newAlloc] };
        });
      }
      // Bundle gone — recreate it (preserving link_id so save path PATCHes instead of POSTing a dupe)
      return [
        { link_id: entry.link_id, tracking_number: entry.tracking_number, carrier: entry.carrier, allocations: [newAlloc], collapsed: false },
        ...prev,
      ];
    });
    setMoveUndo((prev) => { const n = new Map(prev); n.delete(itemId); return n; });
  }, [moveUndo, items]);

  const clearMoveUndo = useCallback((itemId: number) => {
    setMoveUndo((prev) => {
      if (!prev.has(itemId)) return prev;
      const n = new Map(prev); n.delete(itemId); return n;
    });
  }, []);

  const changeAllocationQty = useCallback((bundleIndex: number, itemId: number, qty: number) => {
    setBundles((prev) => prev.map((b, i) => (i !== bundleIndex ? b : { ...b, allocations: b.allocations.map((a) => (a.item_id === itemId ? { ...a, qty } : a)) })));
  }, []);

  const removeUnallocatedItem = useCallback((itemId: number) => {
    const item = items.find((i) => i.item_id === itemId);
    if (item) pushUndo({ item_id: item.item_id, fnsku: item.fnsku, display_title: item.display_title, expected_qty: item.expected_qty, bundleIndex: null });
    setRemovedItemIds((prev) => new Set(prev).add(itemId));
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(itemId); return n; });
  }, [items, pushUndo]);

  const selectAllUnallocated = useCallback(() => {
    const ids = unallocatedItems.map((i) => i.item_id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = ids.every((id) => next.has(id));
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }, [unallocatedItems]);

  // ── Move selected items to a target container ──
  const moveSelectedTo = useCallback((destId: string) => {
    const destIdx = parseBundleIndex(destId);

    setBundles((prev) => {
      const next = prev.map((b) => ({ ...b, allocations: [...b.allocations] }));

      // Collect items to move: gather info from source containers
      const toMove: BundleItemAllocation[] = [];
      for (const itemId of selectedIds) {
        // Check bundles
        for (let i = 0; i < next.length; i++) {
          const ai = next[i].allocations.findIndex((a) => a.item_id === itemId);
          if (ai >= 0) {
            toMove.push(next[i].allocations[ai]);
            next[i].allocations.splice(ai, 1);
            break;
          }
        }
        // Check unallocated
        const unalloc = unallocatedItems.find((it) => it.item_id === itemId);
        if (unalloc && !toMove.some((m) => m.item_id === itemId)) {
          toMove.push({
            item_id: unalloc.item_id, fnsku: unalloc.fnsku, display_title: unalloc.display_title,
            qty: unalloc.expected_qty, max_qty: unalloc.expected_qty,
          });
        }
      }

      // Add to destination bundle (if unallocated, just removing from bundles is enough)
      if (destIdx != null && next[destIdx]) {
        for (const item of toMove) {
          const existing = next[destIdx].allocations.find((a) => a.item_id === item.item_id);
          if (existing) {
            const ei = next[destIdx].allocations.indexOf(existing);
            next[destIdx].allocations[ei] = { ...existing, qty: existing.qty + item.qty };
          } else {
            next[destIdx].allocations.push(item);
          }
        }
      }

      return next;
    });

    setSelectedIds(new Set());
  }, [selectedIds, unallocatedItems]);

  // ── Drag and drop (group-aware) ──
  const findAllocation = useCallback(
    (containerId: string, itemId: number): { qty: number; fnsku: string } | null => {
      if (containerId === UNALLOCATED_ID) {
        const item = unallocatedItems.find((i) => i.item_id === itemId);
        return item ? { qty: item.expected_qty, fnsku: item.fnsku } : null;
      }
      const idx = parseBundleIndex(containerId);
      if (idx == null || !bundles[idx]) return null;
      const alloc = bundles[idx].allocations.find((a) => a.item_id === itemId);
      return alloc ? { qty: alloc.qty, fnsku: alloc.fnsku } : null;
    },
    [bundles, unallocatedItems],
  );

  const moveItemBetweenContainers = useCallback(
    (sourceId: string, destId: string, itemId: number, moveQty: number) => {
      const srcIdx = parseBundleIndex(sourceId);
      const destIdx = parseBundleIndex(destId);
      let fnsku = '', displayTitle = '', maxQty = 0;
      if (sourceId === UNALLOCATED_ID) {
        const item = items.find((i) => i.item_id === itemId);
        if (!item) return;
        fnsku = item.fnsku; displayTitle = item.display_title; maxQty = item.expected_qty;
      } else if (srcIdx != null && bundles[srcIdx]) {
        const alloc = bundles[srcIdx].allocations.find((a) => a.item_id === itemId);
        if (!alloc) return;
        fnsku = alloc.fnsku; displayTitle = alloc.display_title; maxQty = alloc.max_qty;
      }
      setBundles((prev) => {
        const next = prev.map((b) => ({ ...b, allocations: [...b.allocations] }));
        if (srcIdx != null && next[srcIdx]) {
          const allocs = next[srcIdx].allocations;
          const ai = allocs.findIndex((a) => a.item_id === itemId);
          if (ai >= 0) { if (moveQty >= allocs[ai].qty) allocs.splice(ai, 1); else allocs[ai] = { ...allocs[ai], qty: allocs[ai].qty - moveQty }; }
        }
        if (destIdx != null && next[destIdx]) {
          const existing = next[destIdx].allocations.find((a) => a.item_id === itemId);
          if (existing) { const ei = next[destIdx].allocations.indexOf(existing); next[destIdx].allocations[ei] = { ...existing, qty: existing.qty + moveQty }; }
          else next[destIdx].allocations.push({ item_id: itemId, fnsku, display_title: displayTitle, qty: moveQty, max_qty: maxQty });
        }
        return next;
      });
    },
    [bundles, items],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as { itemId: number } | undefined;
    setActiveItemId(data?.itemId ?? null);
    if (data?.itemId != null) clearMoveUndo(data.itemId);
  }, [clearMoveUndo]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveItemId(null);
      const { active, over } = event;
      if (!over) return;
      const data = active.data.current as { itemId: number; sourceContainer: string } | undefined;
      if (!data) return;
      const dest = String(over.id);
      const source = data.sourceContainer;
      if (source === dest) return;

      // Group drag: if dragged item is selected & multiple selected, move all selected
      if (selectedIds.has(data.itemId) && selectedIds.size > 1) {
        moveSelectedTo(dest);
        return;
      }

      const alloc = findAllocation(source, data.itemId);
      if (!alloc) return;
      if (alloc.qty <= 1) {
        moveItemBetweenContainers(source, dest, data.itemId, alloc.qty);
      } else {
        setSplitState({ itemId: data.itemId, fnsku: alloc.fnsku, sourceContainer: source, destContainer: dest, maxQty: alloc.qty });
      }
    },
    [findAllocation, moveItemBetweenContainers, moveSelectedTo, selectedIds],
  );

  const handleDragCancel = useCallback(() => setActiveItemId(null), []);
  const confirmSplit = useCallback((moveQty: number) => {
    if (!splitState) return;
    moveItemBetweenContainers(splitState.sourceContainer, splitState.destContainer, splitState.itemId, moveQty);
    setSplitState(null);
  }, [splitState, moveItemBetweenContainers]);
  const cancelSplit = useCallback(() => setSplitState(null), []);

  const activeItem = useMemo(() => {
    if (activeItemId == null) return null;
    const item = items.find((i) => i.item_id === activeItemId);
    if (item) return item;
    for (const b of bundles) {
      const alloc = b.allocations.find((a) => a.item_id === activeItemId);
      if (alloc) return { item_id: alloc.item_id, fnsku: alloc.fnsku, display_title: alloc.display_title } as ShipmentCardItem;
    }
    return null;
  }, [activeItemId, items, bundles]);

  const dragCount = activeItemId != null && selectedIds.has(activeItemId) && selectedIds.size > 1 ? selectedIds.size : 1;

  return {
    chrome,
    shipment,
    stationTheme,
    // header / fields
    amazonShipmentId, setAmazonShipmentId,
    totalAllocated, totalUnallocated,
    // bundles + items
    bundles, items, unallocatedItems,
    // save
    saving, saveError, save: () => saveMut.mutate(),
    // multi-select
    selectedIds, selectionCount, toggleSelect, selectAllInBundle, clearSelection,
    // undo
    visibleUndos, popUndo, dismissUndo,
    // fnsku search
    fnskuSearchOpen, setFnskuSearchOpen, fnskuQuery, setFnskuQuery,
    addingFnsku, searchInputRef, fnskuResults, fnskuSearching, handleAddFnskuToShipment,
    // bundle CRUD
    addBundle, removeBundle, updateTrackingNumber, toggleCollapse,
    deallocateItem, changeAllocationQty,
    // move-undo
    moveUndo, restoreToBundle,
    // unallocated
    selectAllUnallocated, removeUnallocatedItem, moveSelectedTo,
    // dnd
    sensors, handleDragStart, handleDragEnd, handleDragCancel,
    splitState, confirmSplit, cancelSplit,
    activeItem, dragCount,
  };
}

export type ShipmentEditorController = ReturnType<typeof useShipmentEditor>;
