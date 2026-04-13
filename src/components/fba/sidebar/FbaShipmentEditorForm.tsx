'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import { useDroppable } from '@dnd-kit/core';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Loader2, MapPin, Package, Plus, RotateCcw, Search, X } from '@/components/Icons';
import { getLast4 } from '@/components/ui/CopyChip';
import { FbaTrackingBundleCard } from '@/components/fba/sidebar/FbaTrackingBundleCard';
import type { BundleItemAllocation, TrackingBundleDraft } from '@/components/fba/sidebar/FbaTrackingBundleCard';
import { FbaDraggableLineRow } from '@/components/fba/sidebar/FbaDraggableLineRow';
import { FbaQtyStepper } from '@/components/fba/sidebar/FbaQtyStepper';
import { FbaQtySplitPopover } from '@/components/fba/sidebar/FbaQtySplitPopover';
import { PrintTableCheckbox } from '@/components/fba/table/Checkbox';
import { fbaPaths } from '@/lib/fba/api-paths';
import { deleteFbaItem } from '@/lib/fba/patch';
import { FBA_ACTIVE_SHIPMENTS_REFRESH, USAV_REFRESH_DATA, FBA_FNSKU_SAVED } from '@/lib/fba/events';
import { useFbaEvent } from '@/components/fba/hooks/useFbaEvent';
import type { StationTheme } from '@/utils/staff-colors';
import { fbaSidebarThemeChrome } from '@/utils/staff-colors';
import type { ActiveShipment, ShipmentCardItem } from '@/lib/fba/types';

const UNALLOCATED_ID = 'editor-unallocated';
const UNDO_STORAGE_KEY = 'fba-editor-undo';
const UNDO_EXPIRY_MS = 5 * 60 * 1000;

interface FbaShipmentEditorFormProps {
  shipment: ActiveShipment;
  stationTheme?: StationTheme;
  onClose: () => void;
  onChanged: () => void;
}

// ── Undo ─────────────────────────────────────────────────────────────────────

interface UndoEntry {
  item_id: number;
  fnsku: string;
  display_title: string;
  expected_qty: number;
  bundleIndex: number | null;
  removedAt: number;
}

function loadUndoStack(shipmentId: number): UndoEntry[] {
  try {
    const raw = localStorage.getItem(`${UNDO_STORAGE_KEY}-${shipmentId}`);
    if (!raw) return [];
    const entries: UndoEntry[] = JSON.parse(raw);
    const now = Date.now();
    return entries.filter((e) => now - e.removedAt < UNDO_EXPIRY_MS);
  } catch { return []; }
}

function saveUndoStack(shipmentId: number, stack: UndoEntry[]) {
  try {
    const now = Date.now();
    const valid = stack.filter((e) => now - e.removedAt < UNDO_EXPIRY_MS);
    if (valid.length === 0) localStorage.removeItem(`${UNDO_STORAGE_KEY}-${shipmentId}`);
    else localStorage.setItem(`${UNDO_STORAGE_KEY}-${shipmentId}`, JSON.stringify(valid));
  } catch { /* ignore */ }
}

// ── FNSKU search ─────────────────────────────────────────────────────────────

interface FnskuSearchResult {
  fnsku: string;
  product_title: string | null;
  asin: string | null;
  sku: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildInitialBundles(shipment: ActiveShipment): TrackingBundleDraft[] {
  return shipment.bundles.map((b) => ({
    link_id: b.link_id,
    tracking_number: b.tracking_number,
    carrier: b.carrier,
    collapsed: false,
    allocations: b.items.map((item) => ({
      item_id: item.item_id,
      fnsku: item.fnsku,
      display_title: item.display_title,
      qty: item.expected_qty,
      max_qty: item.expected_qty,
    })),
  }));
}

function droppableIdForBundle(idx: number): string {
  return `editor-bundle-${idx}`;
}

function parseBundleIndex(droppableId: string): number | null {
  if (droppableId === UNALLOCATED_ID) return null;
  const m = droppableId.match(/^editor-bundle-(\d+)$/);
  return m ? Number(m[1]) : null;
}

/** Find which container an item lives in. */
function findItemContainer(
  bundles: TrackingBundleDraft[],
  unallocatedItems: ShipmentCardItem[],
  itemId: number,
): string | null {
  for (let i = 0; i < bundles.length; i++) {
    if (bundles[i].allocations.some((a) => a.item_id === itemId)) return droppableIdForBundle(i);
  }
  if (unallocatedItems.some((it) => it.item_id === itemId)) return UNALLOCATED_ID;
  return null;
}

// ── Unallocated drop zone ────────────────────────────────────────────────────

function UnallocatedDropZone({
  items,
  stationTheme,
  selectedIds,
  onToggleSelect,
  onSelectAllUnallocated,
  onRemoveItem,
}: {
  items: ShipmentCardItem[];
  stationTheme: StationTheme;
  selectedIds: Set<number>;
  onToggleSelect: (itemId: number) => void;
  onSelectAllUnallocated: () => void;
  onRemoveItem: (itemId: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: UNALLOCATED_ID });
  const totalUnits = items.reduce((s, i) => s + i.expected_qty, 0);
  const allSelected = items.length > 0 && items.every((i) => selectedIds.has(i.item_id));
  const someSelected = items.some((i) => selectedIds.has(i.item_id));

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border transition-colors ${
        isOver
          ? 'border-dashed border-amber-400 bg-amber-50/40'
          : 'border-gray-200 bg-gray-50/30'
      }`}
    >
      {/* Header — matches bundle card + item row grid so checkboxes align vertically */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 px-2 py-1.5">
        <div className="flex h-5 w-5 items-center justify-center">
          {items.length > 0 ? (
            <PrintTableCheckbox
              checked={allSelected}
              indeterminate={someSelected && !allSelected}
              stationTheme={stationTheme}
              onChange={onSelectAllUnallocated}
              label={allSelected ? 'Deselect all unallocated' : 'Select all unallocated'}
            />
          ) : null}
        </div>
        <p className="text-[8px] font-black uppercase tracking-wider text-amber-700">
          Unallocated
        </p>
        {items.length > 0 && (
          <span className="shrink-0 text-[8px] font-black tabular-nums text-gray-400">
            {items.length} · {totalUnits}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="border-t border-gray-100 px-3 py-2">
          <p className="text-center text-[9px] font-bold text-gray-300">
            All items allocated to boxes
          </p>
        </div>
      ) : (
        <div className="border-t border-gray-100">
          {items.map((item) => (
            <FbaDraggableLineRow
              key={item.item_id}
              dragId={`editor-drag-${item.item_id}-unallocated`}
              dragData={{ itemId: item.item_id, sourceContainer: UNALLOCATED_ID }}
              displayTitle={item.display_title || 'No title'}
              fnsku={String(item.fnsku || '').toUpperCase()}
              stationTheme={stationTheme}
              checked
              selected={selectedIds.has(item.item_id)}
              onToggleSelect={() => onToggleSelect(item.item_id)}
              onCheckedChange={() => onRemoveItem(item.item_id)}
              rightSlot={
                <FbaQtyStepper
                  value={item.expected_qty}
                  onChange={() => {}}
                  fnsku={item.fnsku}
                />
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function FbaShipmentEditorForm({
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const [fnskuResults, setFnskuResults] = useState<FnskuSearchResult[]>([]);
  const [fnskuSearching, setFnskuSearching] = useState(false);
  const [addingFnsku, setAddingFnsku] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (fnskuSearchOpen) setTimeout(() => searchInputRef.current?.focus(), 40);
    else { setFnskuQuery(''); setFnskuResults([]); }
  }, [fnskuSearchOpen]);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const q = fnskuQuery.trim();
    if (!q || q.length < 2) { setFnskuResults([]); setFnskuSearching(false); return; }
    setFnskuSearching(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/fba/fnskus/search?q=${encodeURIComponent(q)}&limit=8`);
        const data = await res.json();
        if (data.success && Array.isArray(data.items)) setFnskuResults(data.items);
      } catch { /* ignore */ }
      setFnskuSearching(false);
    }, 250);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [fnskuQuery]);

  const handleAddFnskuToShipment = useCallback(
    async (result: FnskuSearchResult) => {
      if (items.some((i) => i.fnsku.toUpperCase() === result.fnsku.toUpperCase())) return;
      setAddingFnsku(result.fnsku);
      try {
        const res = await fetch(fbaPaths.planItems(shipment.id), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fnsku: result.fnsku, expected_qty: 1, product_title: result.product_title, asin: result.asin, sku: result.sku }),
        });
        const data = await res.json();
        if (data.success) {
          const itemsRes = await fetch(fbaPaths.planItems(shipment.id), { cache: 'no-store' });
          const itemsData = await itemsRes.json();
          if (itemsData.success && Array.isArray(itemsData.items)) {
            setItems(itemsData.items.map((i: any) => ({
              item_id: Number(i.id), fnsku: i.fnsku, display_title: i.display_title || i.product_title || i.fnsku,
              expected_qty: Number(i.expected_qty) || 0, actual_qty: Number(i.actual_qty) || 0, status: i.status, shipment_id: shipment.id,
            })));
          }
          setFnskuQuery(''); setFnskuResults([]); setFnskuSearchOpen(false);
        }
      } catch { /* ignore */ }
      setAddingFnsku(null);
    },
    [items, shipment.id],
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
    setError(null);
  }, [shipment]);

  useFbaEvent(FBA_FNSKU_SAVED, () => {
    fetch(fbaPaths.planItems(shipment.id), { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && Array.isArray(data.items)) {
          setItems(data.items.map((i: any) => ({
            item_id: Number(i.id), fnsku: i.fnsku, display_title: i.display_title || i.product_title || i.fnsku,
            expected_qty: Number(i.expected_qty) || 0, actual_qty: Number(i.actual_qty) || 0, status: i.status, shipment_id: shipment.id,
          })));
        }
      })
      .catch(() => {});
  });

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
    setBundles((prev) => [...prev, { link_id: null, tracking_number: '', carrier: 'UPS', allocations: [], collapsed: false }]);
  }, []);

  const removeBundle = useCallback((index: number) => {
    setBundles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateTrackingNumber = useCallback((index: number, value: string) => {
    setBundles((prev) => prev.map((b, i) => (i === index ? { ...b, tracking_number: value.toUpperCase() } : b)));
  }, []);

  const toggleCollapse = useCallback((index: number) => {
    setBundles((prev) => prev.map((b, i) => (i === index ? { ...b, collapsed: !b.collapsed } : b)));
  }, []);

  const deallocateItem = useCallback((bundleIndex: number, itemId: number) => {
    const bundle = bundles[bundleIndex];
    const alloc = bundle?.allocations.find((a) => a.item_id === itemId);
    if (alloc) pushUndo({ item_id: alloc.item_id, fnsku: alloc.fnsku, display_title: alloc.display_title, expected_qty: alloc.qty, bundleIndex });
    setRemovedItemIds((prev) => new Set(prev).add(itemId));
    setBundles((prev) => prev.map((b, i) => (i !== bundleIndex ? b : { ...b, allocations: b.allocations.filter((a) => a.item_id !== itemId) })));
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(itemId); return n; });
  }, [bundles, pushUndo]);

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
  }, []);

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

  // ── Save ──
  const handleSave = async () => {
    setSaving(true); setError(null);
    try {
      const newAmazon = amazonShipmentId.trim().toUpperCase();
      if (newAmazon !== (shipment.amazon_shipment_id || '').trim().toUpperCase()) {
        const res = await fetch(fbaPaths.plan(shipment.id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amazon_shipment_id: newAmazon || null }) });
        if (!res.ok) throw new Error('Failed to update FBA Shipment ID');
      }
      const currentLinkIds = new Set(bundles.map((b) => b.link_id).filter(Boolean));
      for (const ob of shipment.bundles) {
        if (!currentLinkIds.has(ob.link_id)) await fetch(`${fbaPaths.planTracking(shipment.id)}?link_id=${ob.link_id}`, { method: 'DELETE' });
      }
      for (const bundle of bundles) {
        const allocations = bundle.allocations.map((a) => ({ shipment_item_id: a.item_id, qty: a.qty }));
        if (bundle.link_id) {
          await fetch(fbaPaths.planTracking(shipment.id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ link_id: bundle.link_id, tracking_number: bundle.tracking_number.trim(), carrier: bundle.carrier || 'UPS', allocations }) });
        } else if (bundle.tracking_number.trim()) {
          await fetch(fbaPaths.planTracking(shipment.id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tracking_number: bundle.tracking_number.trim(), carrier: bundle.carrier || 'UPS', allocations }) });
        }
      }
      for (const itemId of removedItemIds) await deleteFbaItem(shipment.id, itemId);
      saveUndoStack(shipment.id, []);
      window.dispatchEvent(new CustomEvent(FBA_ACTIVE_SHIPMENTS_REFRESH));
      window.dispatchEvent(new CustomEvent(USAV_REFRESH_DATA));
      onChanged(); onClose();
    } catch (err: any) { setError(err?.message || 'Failed to save changes'); }
    finally { setSaving(false); }
  };

  // ── Render ──
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* Header */}
      <div className="relative z-20 flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-3 py-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 transition-colors hover:bg-gray-200" aria-label="Close editor">
            <X className="h-3.5 w-3.5 text-gray-600" />
          </button>
          <div>
            <h2 className="text-[11px] font-black uppercase tracking-tight text-gray-900">Edit Shipment</h2>
            <p className="text-[7px] font-bold uppercase tracking-widest text-purple-600">{shipment.shipment_ref}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[8px] font-bold tabular-nums text-gray-400">{totalAllocated} in boxes · {totalUnallocated} loose</p>
        </div>
      </div>

      {/* Selection action bar */}
      <AnimatePresence>
        {selectionCount > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden border-b border-blue-200 bg-blue-50"
          >
            <div className="px-3 py-2">
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[9px] font-black uppercase tracking-wider text-blue-800">
                  {selectionCount} selected — move to
                </p>
                <button type="button" onClick={clearSelection} className="text-[8px] font-bold text-blue-500 hover:text-blue-700">
                  Clear
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {bundles.map((bundle, idx) => {
                  const hasTracking = bundle.tracking_number.trim().length > 0;
                  return (
                    <button
                      key={bundle.link_id ?? `action-${idx}`}
                      type="button"
                      onClick={() => moveSelectedTo(droppableIdForBundle(idx))}
                      className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 transition-colors hover:bg-gray-50"
                    >
                      {hasTracking ? (
                        <>
                          <MapPin className="h-3 w-3 shrink-0 text-blue-500" />
                          <span className="border-b-2 border-blue-500 pb-0.5 font-mono text-[10px] font-black tracking-tight leading-none text-gray-900">
                            {getLast4(bundle.tracking_number)}
                          </span>
                        </>
                      ) : (
                        <>
                          <Package className="h-3 w-3 shrink-0 text-gray-500" />
                          <span className="text-[9px] font-bold uppercase tracking-wider text-gray-700">
                            Box {idx + 1}
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => moveSelectedTo(UNALLOCATED_ID)}
                  className="rounded-md border border-amber-200 bg-white px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-amber-700 transition-colors hover:bg-amber-100"
                >
                  Unallocated
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Scrollable body */}
      <div className="relative min-h-0 flex-1 space-y-3 overflow-y-auto bg-white p-3 scrollbar-hide">
        {/* FBA Shipment ID */}
        <div>
          <label className="block text-[8px] font-black uppercase tracking-widest text-gray-700">FBA Shipment ID</label>
          <input
            type="text" value={amazonShipmentId}
            onChange={(e) => setAmazonShipmentId(e.target.value.toUpperCase())}
            placeholder="FBA1234ABCD"
            className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 font-mono text-[11px] font-bold text-gray-900 outline-none transition-all placeholder:text-gray-300 focus:border-purple-400 focus:ring-1 focus:ring-purple-400"
          />
        </div>

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
          {/* UPS Tracking section — + button at top, then boxes */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[8px] font-black uppercase tracking-widest text-purple-700">UPS Tracking ({bundles.length})</p>
            </div>

            <button type="button" onClick={addBundle}
              className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 bg-gray-50/50 px-2 py-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-500 transition-colors hover:border-purple-300 hover:bg-purple-50/50 hover:text-purple-600"
            >
              <Plus className="h-2.5 w-2.5" />
              UPS Tracking
            </button>

            {bundles.map((bundle, idx) => (
              <FbaTrackingBundleCard
                key={bundle.link_id ?? `new-${idx}`}
                bundle={bundle} bundleIndex={idx} droppableId={droppableIdForBundle(idx)} stationTheme={stationTheme}
                selectedIds={selectedIds} onToggleSelect={toggleSelect} onSelectAllInBundle={selectAllInBundle}
                onUpdateTracking={updateTrackingNumber} onRemoveBundle={removeBundle} onToggleCollapse={toggleCollapse}
                onDeallocateItem={deallocateItem} onChangeAllocationQty={changeAllocationQty}
              />
            ))}
          </div>

          {/* Unallocated at bottom */}
          {unallocatedItems.length > 0 && (
            <UnallocatedDropZone
              items={unallocatedItems} stationTheme={stationTheme}
              selectedIds={selectedIds} onToggleSelect={toggleSelect}
              onSelectAllUnallocated={selectAllUnallocated} onRemoveItem={removeUnallocatedItem}
            />
          )}

          {/* Drag overlay */}
          <DragOverlay dropAnimation={null}>
            {activeItem ? (
              <div className="rounded-lg border border-blue-300 bg-blue-50 px-2.5 py-1.5 shadow-md">
                <p className="text-[10px] font-bold text-gray-900">{activeItem.display_title || activeItem.fnsku}</p>
                <div className="flex items-center gap-1.5">
                  <p className="font-mono text-[9px] text-gray-500">{activeItem.fnsku}</p>
                  {dragCount > 1 && (
                    <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[8px] font-black text-white">
                      +{dragCount - 1}
                    </span>
                  )}
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* Split popover */}
        <AnimatePresence>
          {splitState && (
            <FbaQtySplitPopover itemId={splitState.itemId} fnsku={splitState.fnsku} maxQty={splitState.maxQty} onConfirm={confirmSplit} onCancel={cancelSplit} />
          )}
        </AnimatePresence>

        {/* Undo */}
        <AnimatePresence>
          {visibleUndos.length > 0 && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="space-y-1">
                {visibleUndos.map((entry) => (
                  <div key={entry.item_id} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-2.5 py-1.5">
                    <RotateCcw className="h-3 w-3 shrink-0 text-amber-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[9px] font-bold text-gray-700">{entry.display_title || entry.fnsku}</p>
                      <p className="font-mono text-[8px] text-gray-400">{entry.fnsku} · {entry.expected_qty} qty</p>
                    </div>
                    <button type="button" onClick={() => popUndo(entry.item_id)} className="shrink-0 rounded-md bg-amber-200/80 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-amber-800 transition-colors hover:bg-amber-300">Undo</button>
                    <button type="button" onClick={() => dismissUndo(entry.item_id)} className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-amber-400 transition-colors hover:text-amber-600" aria-label="Dismiss"><X className="h-2.5 w-2.5" /></button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* FNSKU search — popup trigger */}
        <button type="button" onClick={() => setFnskuSearchOpen(true)} className="flex items-center gap-1 text-[9px] font-bold text-purple-600 transition-colors hover:text-purple-800">
          <Search className="h-2.5 w-2.5" />
          Add FNSKU to shipment
        </button>
      </div>

      {/* FNSKU search popup */}
      <AnimatePresence>
        {fnskuSearchOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[110] flex items-start justify-center p-4 pt-[12vh]"
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              aria-label="Close FNSKU search"
              onClick={() => setFnskuSearchOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.98 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="relative z-[111] w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-900/20"
            >
              {/* Header: search input */}
              <div className="border-b border-zinc-200 px-4 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-purple-600">Add FNSKU</p>
                    <h2 className="mt-0.5 text-sm font-black text-zinc-900">Search shipment catalog</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFnskuSearchOpen(false)}
                    className="rounded-full border border-zinc-200 bg-white p-2 text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-800"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={fnskuQuery}
                    onChange={(e) => setFnskuQuery(e.target.value)}
                    placeholder="Search FNSKU, ASIN, SKU, or product title..."
                    className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-10 pr-3 text-sm font-semibold text-zinc-900 outline-none transition-all placeholder:text-zinc-400 focus:border-purple-400 focus:ring-2 focus:ring-purple-400/30"
                  />
                </div>
              </div>

              {/* Body: search results */}
              <div className="max-h-[60vh] overflow-y-auto px-3 py-3">
                {fnskuQuery.trim().length < 2 ? (
                  <div className="py-12 text-center">
                    <Search className="mx-auto h-6 w-6 text-zinc-300" />
                    <p className="mt-2 text-xs font-semibold text-zinc-400">
                      Type at least 2 characters to search
                    </p>
                  </div>
                ) : fnskuSearching ? (
                  <div className="flex items-center justify-center gap-2 py-12">
                    <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                    <p className="text-xs font-semibold text-zinc-500">Searching...</p>
                  </div>
                ) : fnskuResults.length === 0 ? (
                  <div className="py-12 text-center">
                    <p className="text-xs font-semibold text-zinc-400">No matching FNSKUs found</p>
                    <p className="mt-1 text-[10px] text-zinc-400">Try a different search term</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {fnskuResults.map((result) => {
                      const alreadyAdded = items.some(
                        (i) => i.fnsku.toUpperCase() === result.fnsku.toUpperCase(),
                      );
                      const isAdding = addingFnsku === result.fnsku;
                      return (
                        <button
                          key={result.fnsku}
                          type="button"
                          disabled={alreadyAdded || isAdding}
                          onClick={() => void handleAddFnskuToShipment(result)}
                          className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                            alreadyAdded
                              ? 'cursor-default border-emerald-100 bg-emerald-50/40'
                              : 'border-zinc-200 bg-white hover:border-purple-300 hover:bg-purple-50/60'
                          }`}
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-50">
                            <Package className="h-4 w-4 text-purple-500" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-zinc-900">
                              {result.product_title || result.fnsku}
                            </p>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="font-mono text-[10px] font-bold text-purple-700">
                                {result.fnsku}
                              </span>
                              {result.asin && (
                                <span className="font-mono text-[10px] text-zinc-500">
                                  ASIN {result.asin}
                                </span>
                              )}
                              {result.sku && (
                                <span className="font-mono text-[10px] text-zinc-500">
                                  SKU {result.sku}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center">
                            {isAdding ? (
                              <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
                            ) : alreadyAdded ? (
                              <Check className="h-4 w-4 text-emerald-500" />
                            ) : (
                              <Plus className="h-4 w-4 text-purple-500" />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <div className="border-t border-gray-200 bg-white px-3 py-2">
        {error && <p className="mb-1.5 text-[10px] font-semibold text-red-600">{error}</p>}
        <button type="button" onClick={() => void handleSave()} disabled={saving} className={chrome.primaryButton}>
          {saving
            ? <span className="flex items-center justify-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /><span className="text-[10px]">Saving...</span></span>
            : <span className="text-[10px]">Save Changes</span>}
        </button>
      </div>
    </div>
  );
}
