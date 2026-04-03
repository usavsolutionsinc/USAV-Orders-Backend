'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { fbaPaths } from '@/lib/fba/api-paths';
import { Loader2, Minus, Package, Plus, X } from '@/components/Icons';
import { FnskuChip } from '@/components/ui/CopyChip';
import { PrintTableCheckbox } from '@/components/fba/table/Checkbox';
import { FbaSelectedLineRow } from '@/components/fba/sidebar/FbaSelectedLineRow';
import { InlineEditableValue } from '@/design-system/components';
import { UndoToast } from '@/components/fba/table/UndoToast';
import { ChevronToggle, DeferredQtyInput } from '@/design-system/primitives';
import type { StationTheme } from '@/utils/staff-colors';
import { emitOpenQuickAddFnsku } from '@/components/fba/FbaQuickAddFnskuModal';
import type { FbaBoardItem } from '@/components/fba/FbaBoardTable';
import { FBA_PAIRED_REVIEW_TOGGLE } from '@/lib/fba/events';

/* ── Types ─────────────────────────────────────────────────────────── */

export interface ShipmentCardItem {
  item_id: number;
  fnsku: string;
  display_title: string;
  expected_qty: number;
  actual_qty: number;
  status: string;
  shipment_id: number;
  /** UPS tracking number this item is allocated to (from fba_tracking_item_allocations). */
  tracking_number?: string | null;
  tracking_carrier?: string | null;
}

/** One UPS tracking bundle within a shipment — its own items and link_id. */
export interface TrackingBundle {
  link_id: number;
  tracking_number: string;
  carrier: string;
  items: ShipmentCardItem[];
}

export interface ActiveShipment {
  id: number;
  shipment_ref: string;
  amazon_shipment_id: string | null;
  status: string;
  shipped_at?: string | null;
  /** All tracking bundles for this shipment (one per UPS tracking number). */
  bundles: TrackingBundle[];
  /** @deprecated Compat — first bundle's values. */
  tracking_numbers: { tracking_number: string; carrier: string }[];
  tracking_link_id?: number | null;
  tracking_number_raw?: string | null;
  tracking_carrier?: string | null;
  items: ShipmentCardItem[];
}

function shipmentItemsToBoardItems(
  shipment: Pick<ActiveShipment, 'id' | 'shipment_ref' | 'amazon_shipment_id'>,
  rows: ShipmentCardItem[],
  getQty: (i: ShipmentCardItem) => number,
): FbaBoardItem[] {
  return rows.map((item) => ({
    item_id: item.item_id,
    fnsku: item.fnsku,
    expected_qty: getQty(item),
    actual_qty: item.actual_qty,
    item_status: item.status,
    display_title: item.display_title,
    asin: null,
    sku: null,
    item_notes: null,
    shipment_id: shipment.id,
    shipment_ref: shipment.shipment_ref,
    amazon_shipment_id: shipment.amazon_shipment_id,
    due_date: null,
    shipment_status: item.status,
    destination_fc: null,
    tracking_numbers: [],
    condition: null,
  }));
}

/** Bundles from API, or a single synthetic bundle when legacy flat `items` + primary link. */
function resolveBundlesForSave(shipment: ActiveShipment, flatItems: ShipmentCardItem[]): TrackingBundle[] {
  if ((shipment.bundles?.length ?? 0) > 0) return shipment.bundles;
  const linkId = Number(shipment.tracking_link_id || 0);
  if (!linkId) return [];
  const tn = shipment.tracking_number_raw || shipment.tracking_numbers[0]?.tracking_number || '';
  if (!String(tn).trim()) return [];
  return [
    {
      link_id: linkId,
      tracking_number: String(tn).trim(),
      carrier: shipment.tracking_carrier || shipment.tracking_numbers[0]?.carrier || 'UPS',
      items: flatItems,
    },
  ];
}

/* ── FNSKU row ─────────────────────────────────────────────────────── */

function FnskuRow({
  item,
  stationTheme = 'green',
  checked = true,
  qty,
  onCheckedChange,
  onAdjustQty,
  onSetQty,
  editable = false,
}: {
  item: ShipmentCardItem;
  stationTheme?: StationTheme;
  checked?: boolean;
  qty: number;
  onCheckedChange?: (next: boolean) => void;
  onAdjustQty?: (delta: number) => void;
  onSetQty?: (qty: number) => void;
  editable?: boolean;
}) {
  if (!editable) {
    return (
      <div className="flex items-start gap-2 px-0 py-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="whitespace-normal break-words text-[12px] font-bold leading-snug text-gray-900">
            {item.display_title}
          </p>
          <FnskuChip value={item.fnsku} />
        </div>

        <div className="flex shrink-0 flex-col items-center text-center">
          <span className="text-[14px] font-black tabular-nums text-gray-900">{item.expected_qty}</span>
          <span className="text-[9px] font-bold text-gray-400">qty</span>
        </div>
      </div>
    );
  }

  return (
    <FbaSelectedLineRow
      displayTitle={item.display_title}
      fnsku={String(item.fnsku || '').toUpperCase()}
      stationTheme={stationTheme}
      checked={checked}
      onCheckedChange={(next) => onCheckedChange?.(next)}
      onEditDetails={() =>
        emitOpenQuickAddFnsku({
          fnsku: String(item.fnsku || '').trim(),
          product_title: item.display_title || null,
          asin: null,
          sku: null,
          condition: null,
        })
      }
      rightSlot={
        <>
          <button
            type="button"
            onClick={() => onAdjustQty?.(1)}
            className="flex h-6 w-10 items-center justify-center rounded-t-md border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50"
            aria-label={`Increase ${item.fnsku} quantity`}
          >
            <Plus className="h-3 w-3" />
          </button>
          <DeferredQtyInput
            value={qty}
            min={0}
            onChange={(v) => onSetQty?.(Math.max(0, v))}
            className="h-7 w-10 border-x border-gray-200 bg-white text-center text-[13px] font-black tabular-nums text-gray-900 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <button
            type="button"
            onClick={() => onAdjustQty?.(-1)}
            disabled={qty <= 0}
            className={`flex h-6 w-10 items-center justify-center rounded-b-md border transition-colors ${
              qty <= 1
                ? 'border-red-300 text-red-500 hover:bg-red-50'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50'
            } disabled:opacity-40`}
            aria-label={`Decrease ${item.fnsku} quantity`}
          >
            <Minus className="h-3 w-3" />
          </button>
        </>
      }
    />
  );
}

/* ── Tracking section — header with inline edit + items ───────────── */

function TrackingSection({
  bundle,
  shipment,
  editable,
  stationTheme,
  items,
  selectedIds,
  getQty,
  onCheckedChange,
  onAdjustQty,
  onSetQty,
  onChanged,
}: {
  bundle: TrackingBundle;
  shipment: Pick<ActiveShipment, 'id' | 'shipment_ref' | 'amazon_shipment_id'>;
  editable: boolean;
  stationTheme: StationTheme;
  items: ShipmentCardItem[];
  selectedIds: Set<number>;
  getQty: (item: ShipmentCardItem) => number;
  onCheckedChange: (itemId: number, next: boolean) => void;
  onAdjustQty: (item: ShipmentCardItem, delta: number) => void;
  onSetQty: (item: ShipmentCardItem, qty: number) => void;
  onChanged?: () => void;
}) {
  const [editVal, setEditVal] = useState(bundle.tracking_number);

  useEffect(() => { setEditVal(bundle.tracking_number); }, [bundle.tracking_number]);

  const saveTracking = async () => {
    const next = editVal.trim().toUpperCase();
    if (!next || next === bundle.tracking_number) return;
    try {
      const res = await fetch(fbaPaths.planTracking(shipment.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link_id: bundle.link_id, tracking_number: next, carrier: 'UPS' }),
      });
      if (res.ok) onChanged?.();
      else setEditVal(bundle.tracking_number);
    } catch {
      setEditVal(bundle.tracking_number);
    }
  };

  const selectedRows = items.filter((i) => selectedIds.has(i.item_id));
  const selectedCount = selectedRows.length;
  const selectedUnits = selectedRows.reduce((s, i) => s + getQty(i), 0);

  /** Toggles combine review panel; when expanding from collapsed with a selection, prefill + send lines to paired review. */
  const togglePairedReviewFromShipment = () => {
    window.dispatchEvent(
      new CustomEvent(FBA_PAIRED_REVIEW_TOGGLE, {
        detail: {
          sendToPaired:
            selectedCount > 0
              ? {
                  items: shipmentItemsToBoardItems(shipment, selectedRows, getQty),
                  amazonShipmentId: String(shipment.amazon_shipment_id || '').trim(),
                  upsTracking: String(bundle.tracking_number || '').trim(),
                  activeShipmentSplit: {
                    sourcePlanId: shipment.id,
                    prefilledAmazonShipmentId: String(shipment.amazon_shipment_id || '').trim(),
                  },
                }
              : undefined,
        },
      }),
    );
  };

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      {/* Selection counts — own row so UPS can use full width below */}
      <div className="flex items-center px-2 py-1 bg-blue-50/25">
        <span className="tabular-nums text-[9px] font-bold text-blue-400">
          {selectedCount} · {selectedUnits}
        </span>
      </div>

      {/* UPS tracking — full-width band; FbaSelectedLineRow (via FnskuRow) starts on the next row */}
      <div className="w-full min-w-0 border-t border-blue-100/70 bg-blue-50/50 px-2 py-2">
        <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-blue-400/90">UPS tracking</p>
        {editable ? (
          <InlineEditableValue
            className="w-full min-w-0"
            value={editVal}
            placeholder="UPS 1Z…"
            onChange={(v) => setEditVal(v.toUpperCase())}
            onSubmit={() => void saveTracking()}
            monospace
            tone="blue"
            showEditIcon
            editIconPosition="end"
            valueClassName="text-[11px] text-blue-800 break-all !whitespace-normal"
            inputClassName="text-[11px]"
            accessory={
              <button
                type="button"
                onClick={togglePairedReviewFromShipment}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                aria-label="Toggle combine review panel"
                title="Show or hide combine review; when opening from collapsed with a selection, prefill FBA ID and UPS"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            }
          />
        ) : (
          <p className="w-full break-words font-mono text-[11px] font-bold leading-snug text-blue-800">
            {bundle.tracking_number}
          </p>
        )}
      </div>

      {/* Items — each row is FbaSelectedLineRow */}
      {items.map((item) => (
        <FnskuRow
          key={item.item_id}
          item={item}
          stationTheme={stationTheme}
          editable={editable}
          checked={selectedIds.has(item.item_id)}
          qty={getQty(item)}
          onCheckedChange={(next) => onCheckedChange(item.item_id, next)}
          onAdjustQty={(delta) => onAdjustQty(item, delta)}
          onSetQty={(nextQty) => onSetQty(item, nextQty)}
        />
      ))}
    </div>
  );
}

/* ── Shipment card ─────────────────────────────────────────────────── */

export interface FbaShipmentCardProps {
  shipment: ActiveShipment;
  stationTheme?: StationTheme;
  editable?: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onChanged?: () => void;
}

export function FbaShipmentCard({
  shipment,
  stationTheme = 'green',
  editable = false,
  isExpanded,
  onToggleExpand,
  onChanged,
}: FbaShipmentCardProps) {
  const [items, setItems] = useState<ShipmentCardItem[]>(shipment.items);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set(shipment.items.map((i) => i.item_id)));
  const [qtyOverrides, setQtyOverrides] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Inline-editable fields ──────────────────────────────────────────
  const [editableTracking, setEditableTracking] = useState(
    shipment.tracking_number_raw || shipment.tracking_numbers[0]?.tracking_number || '',
  );
  const [editableAmazonId, setEditableAmazonId] = useState(shipment.amazon_shipment_id || '');

  // ── Undo toast ──────────────────────────────────────────────────────
  const [undoState, setUndoState] = useState<{
    open: boolean;
    label: string;
    rollback: (() => Promise<void>) | null;
  }>({ open: false, label: '', rollback: null });
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showUndoToast = useCallback((label: string, rollback: () => Promise<void>) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoState({ open: true, label, rollback });
    undoTimerRef.current = setTimeout(() => {
      setUndoState({ open: false, label: '', rollback: null });
    }, 4500);
  }, []);

  const handleUndo = useCallback(async () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    const rollback = undoState.rollback;
    setUndoState({ open: false, label: '', rollback: null });
    if (rollback) {
      try { await rollback(); onChanged?.(); } catch { /* silent */ }
    }
  }, [undoState.rollback, onChanged]);

  // ── Inline field save handlers ──────────────────────────────────────
  const saveTrackingNumber = useCallback(async () => {
    const newVal = editableTracking.trim().toUpperCase();
    const linkId = Number(shipment.tracking_link_id || 0);
    if (!linkId || !newVal) return;

    const prevVal = shipment.tracking_number_raw || shipment.tracking_numbers[0]?.tracking_number || '';
    if (newVal === prevVal.trim().toUpperCase()) return;

    try {
      const res = await fetch(fbaPaths.planTracking(shipment.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link_id: linkId, tracking_number: newVal, carrier: 'UPS' }),
      });
      if (!res.ok) { setEditableTracking(prevVal); return; }

      showUndoToast(`Tracking → ${newVal.slice(0, 12)}…`, async () => {
        await fetch(fbaPaths.planTracking(shipment.id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ link_id: linkId, tracking_number: prevVal, carrier: 'UPS' }),
        });
        setEditableTracking(prevVal);
      });
      onChanged?.();
    } catch {
      setEditableTracking(prevVal);
    }
  }, [editableTracking, shipment, showUndoToast, onChanged]);

  const saveAmazonShipmentId = useCallback(async () => {
    const newVal = editableAmazonId.trim().toUpperCase();
    const prevVal = shipment.amazon_shipment_id || '';
    if (newVal === prevVal.trim().toUpperCase()) return;

    try {
      const res = await fetch(fbaPaths.plan(shipment.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amazon_shipment_id: newVal || null }),
      });
      if (!res.ok) { setEditableAmazonId(prevVal); return; }

      showUndoToast(`FBA ID → ${newVal || '(cleared)'}`, async () => {
        await fetch(fbaPaths.plan(shipment.id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amazon_shipment_id: prevVal || null }),
        });
        setEditableAmazonId(prevVal);
      });
      onChanged?.();
    } catch {
      setEditableAmazonId(prevVal);
    }
  }, [editableAmazonId, shipment, showUndoToast, onChanged]);

  // Keep items in sync when parent data refreshes
  useEffect(() => {
    setItems(shipment.items);
    setSelectedIds(new Set(shipment.items.map((i) => i.item_id)));
    setQtyOverrides({});
    setError(null);
    setEditableTracking(shipment.tracking_number_raw || shipment.tracking_numbers[0]?.tracking_number || '');
    setEditableAmazonId(shipment.amazon_shipment_id || '');
  }, [shipment]);

  const primaryTracking =
    shipment.tracking_number_raw ||
    shipment.tracking_numbers[0]?.tracking_number ||
    '—';
  const carrier =
    shipment.tracking_carrier ||
    shipment.tracking_numbers[0]?.carrier ||
    '';
  const totalQty = items.reduce((s, i) => s + Math.max(0, Number(qtyOverrides[i.item_id] ?? i.expected_qty)), 0);
  const selectedRowsCard = items.filter((i) => selectedIds.has(i.item_id));
  const footerSelectedCount = selectedRowsCard.length;
  const footerSelectedUnits = selectedRowsCard.reduce(
    (s, i) => s + Math.max(0, Number(qtyOverrides[i.item_id] ?? i.expected_qty)),
    0,
  );
  const isShipped = shipment.status === 'SHIPPED';
  const shippedDateLabel = (() => {
    if (!shipment.shipped_at) return null;
    try {
      const d = new Date(shipment.shipped_at);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return null; }
  })();

  const getQty = (item: ShipmentCardItem) => Math.max(0, Number(qtyOverrides[item.item_id] ?? item.expected_qty));

  const syntheticBundle = useMemo((): TrackingBundle | null => {
    if ((shipment.bundles?.length ?? 0) > 0) return null;
    const linkId = Number(shipment.tracking_link_id || 0);
    if (!linkId) return null;
    const tn = shipment.tracking_number_raw || shipment.tracking_numbers[0]?.tracking_number || '';
    if (!String(tn).trim()) return null;
    return {
      link_id: linkId,
      tracking_number: String(tn).trim(),
      carrier: shipment.tracking_carrier || shipment.tracking_numbers[0]?.carrier || 'UPS',
      items,
    };
  }, [shipment, items]);

  const applyBundleAllocations = useCallback(
    async (
      bundle: TrackingBundle,
      sel: Set<number>,
      overrides: Record<number, number>,
      opts?: { notify?: boolean },
    ) => {
      const linkId = Number(bundle.link_id);
      if (!Number.isFinite(linkId) || linkId <= 0) {
        throw new Error('Missing tracking link');
      }
      const getQ = (i: ShipmentCardItem) =>
        Math.max(0, Number(overrides[i.item_id] ?? i.expected_qty));

      const allocations = bundle.items
        .filter((i) => sel.has(i.item_id))
        .map((i) => ({
          shipment_item_id: i.item_id,
          quantity: Math.max(1, getQ(i)),
        }))
        .filter((row) => row.quantity > 0);

      const tracking = String(bundle.tracking_number || '').trim();
      const car = bundle.carrier || 'UPS';

      const res = await fetch(fbaPaths.planTracking(shipment.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          link_id: linkId,
          tracking_number: tracking,
          carrier: car,
          allocations,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to update allocations');

      if (opts?.notify !== false) onChanged?.();
    },
    [shipment.id, onChanged],
  );

  const adjustQtyLegacy = (item: ShipmentCardItem, delta: number) => {
    const next = Math.max(0, getQty(item) + delta);
    setQtyOverrides((prev) => ({ ...prev, [item.item_id]: next }));
    setSelectedIds((prev) => {
      const copy = new Set(prev);
      if (next === 0) copy.delete(item.item_id);
      else copy.add(item.item_id);
      return copy;
    });
  };

  const setQtyLegacy = (item: ShipmentCardItem, raw: number) => {
    const next = Math.max(0, raw);
    setQtyOverrides((prev) => ({ ...prev, [item.item_id]: next }));
    setSelectedIds((prev) => {
      const copy = new Set(prev);
      if (next <= 0) copy.delete(item.item_id);
      else copy.add(item.item_id);
      return copy;
    });
  };

  const adjustQtyInBundle = (bundle: TrackingBundle, item: ShipmentCardItem, delta: number) => {
    const next = Math.max(0, getQty(item) + delta);
    const overridesAfter = { ...qtyOverrides, [item.item_id]: next };
    const selAfter = new Set(selectedIds);
    if (next === 0) selAfter.delete(item.item_id);
    else selAfter.add(item.item_id);

    setQtyOverrides((prev) => ({ ...prev, [item.item_id]: next }));
    setSelectedIds((prev) => {
      const copy = new Set(prev);
      if (next === 0) copy.delete(item.item_id);
      else copy.add(item.item_id);
      return copy;
    });

    if (editable && next === 0) {
      void applyBundleAllocations(bundle, selAfter, overridesAfter).catch((err: Error) =>
        setError(err?.message || 'Failed to update allocations'),
      );
    }
  };

  const setQtyInBundle = (bundle: TrackingBundle, item: ShipmentCardItem, raw: number) => {
    const next = Math.max(0, raw);
    const overridesAfter = { ...qtyOverrides, [item.item_id]: next };
    const selAfter = new Set(selectedIds);
    if (next <= 0) selAfter.delete(item.item_id);
    else selAfter.add(item.item_id);

    setQtyOverrides((prev) => ({ ...prev, [item.item_id]: next }));
    setSelectedIds((prev) => {
      const copy = new Set(prev);
      if (next <= 0) copy.delete(item.item_id);
      else copy.add(item.item_id);
      return copy;
    });

    if (editable && next === 0) {
      void applyBundleAllocations(bundle, selAfter, overridesAfter).catch((err: Error) =>
        setError(err?.message || 'Failed to update allocations'),
      );
    }
  };

  const handleSaveSelection = async () => {
    if (!editable) return;
    const bundles = resolveBundlesForSave(shipment, items);
    if (bundles.length === 0) {
      setError('Missing tracking link');
      return;
    }

    const prevSnapshots = bundles.map((b) => ({
      bundle: b,
      prev: b.items.map((i) => ({ shipment_item_id: i.item_id, quantity: i.expected_qty })),
    }));

    setSaving(true);
    setError(null);
    try {
      for (const b of bundles) {
        await applyBundleAllocations(b, selectedIds, qtyOverrides, { notify: false });
      }
      onChanged?.();

      const totalSaved = bundles.reduce((acc, b) => {
        const getQ = (i: ShipmentCardItem) =>
          Math.max(0, Number(qtyOverrides[i.item_id] ?? i.expected_qty));
        const lineUnits = b.items
          .filter((i) => selectedIds.has(i.item_id))
          .reduce((s, i) => s + getQ(i), 0);
        return acc + lineUnits;
      }, 0);
      const countSaved = bundles.reduce(
        (acc, b) => acc + b.items.filter((i) => selectedIds.has(i.item_id)).length,
        0,
      );

      showUndoToast(`Saved ${countSaved} items · ${totalSaved} units`, async () => {
        for (const snap of prevSnapshots) {
          await fetch(fbaPaths.planTracking(shipment.id), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              link_id: snap.bundle.link_id,
              tracking_number: String(snap.bundle.tracking_number || '').trim(),
              carrier: snap.bundle.carrier || 'UPS',
              allocations: snap.prev,
            }),
          });
        }
        onChanged?.();
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to update allocations');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="[overflow:clip] border border-gray-200 bg-white transition-colors"
    >
      {/* Header — sticky within the sidebar scroll container */}
      <button
        type="button"
        onClick={onToggleExpand}
        className="flex w-full items-center justify-between gap-2 bg-white px-3 py-2.5 text-left transition-colors hover:bg-gray-50"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Package className="h-4 w-4 shrink-0 text-purple-500" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 items-baseline gap-1.5">
              {shipment.amazon_shipment_id && (
                <span className="truncate font-mono text-[12px] font-black text-gray-900">
                  {shipment.amazon_shipment_id}
                </span>
              )}
              <span className="shrink-0 text-[10px] font-bold text-gray-400">
                {items.length} SKU · {totalQty} units
              </span>
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="truncate font-mono text-[10px] font-bold text-gray-400">
                {shipment.tracking_numbers.length > 1
                  ? `${shipment.tracking_numbers.length} trackings`
                  : `${carrier ? `${carrier} · ` : ''}${primaryTracking}`}
              </p>
              {isShipped && shippedDateLabel ? (
                <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-black text-emerald-700">
                  {shippedDateLabel}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <ChevronToggle isExpanded={isExpanded} tone="purple" />
      </button>

      {/* Expanded: FNSKU list */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-gray-100 px-3">
              {/* Inline-editable FBA Shipment ID */}
              {editable && isExpanded ? (
                <div className="border-b border-gray-100 py-2.5">
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">FBA Shipment ID</p>
                  <InlineEditableValue
                    value={editableAmazonId}
                    placeholder="FBA1234ABCD"
                    onChange={(v) => setEditableAmazonId(v.toUpperCase())}
                    onSubmit={saveAmazonShipmentId}
                    monospace
                    tone="purple"
                    showEditIcon
                  />
                </div>
              ) : null}

              {/* Items grouped by tracking number — each tracking is a header with pencil edit */}
              {(shipment.bundles?.length ?? 0) > 0 ? (
                shipment.bundles.map((bundle) => (
                  <TrackingSection
                    key={bundle.link_id}
                    bundle={bundle}
                    shipment={shipment}
                    editable={editable}
                    stationTheme={stationTheme}
                    items={bundle.items}
                    selectedIds={selectedIds}
                    getQty={getQty}
                    onCheckedChange={(itemId, next) => {
                      setSelectedIds((prev) => {
                        const copy = new Set(prev);
                        if (next) copy.add(itemId);
                        else copy.delete(itemId);
                        return copy;
                      });
                    }}
                    onAdjustQty={(item, d) => adjustQtyInBundle(bundle, item, d)}
                    onSetQty={(item, raw) => setQtyInBundle(bundle, item, raw)}
                    onChanged={onChanged}
                  />
                ))
              ) : items.length === 0 ? (
                <p className="py-3 text-center text-[11px] font-bold text-gray-400">No items</p>
              ) : (
                items.map((item) => (
                  <FnskuRow
                    key={item.item_id}
                    item={item}
                    stationTheme={stationTheme}
                    editable={editable}
                    checked={selectedIds.has(item.item_id)}
                    qty={getQty(item)}
                    onCheckedChange={(next) => {
                      setSelectedIds((prev) => {
                        const copy = new Set(prev);
                        if (next) copy.add(item.item_id);
                        else copy.delete(item.item_id);
                        return copy;
                      });
                    }}
                    onAdjustQty={(delta) =>
                      syntheticBundle
                        ? adjustQtyInBundle(syntheticBundle, item, delta)
                        : adjustQtyLegacy(item, delta)
                    }
                    onSetQty={(nextQty) =>
                      syntheticBundle
                        ? setQtyInBundle(syntheticBundle, item, nextQty)
                        : setQtyLegacy(item, nextQty)
                    }
                  />
                ))
              )}
              {editable ? (
                <div className="space-y-2 px-3 py-2">
                  {error ? <p className="text-[11px] font-semibold text-red-600">{error}</p> : null}
                  <div className="flex items-center justify-between gap-3">
                    <span className="shrink-0 tabular-nums text-[10px] font-bold text-gray-400">
                      {footerSelectedCount} · {footerSelectedUnits} · {totalQty}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleSaveSelection()}
                      disabled={saving}
                      className="flex h-8 min-w-[4.5rem] shrink-0 items-center justify-center rounded-md border border-emerald-300 bg-emerald-50 px-3 text-[10px] font-black uppercase tracking-wider text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Undo toast — rendered per-card, positioned fixed */}
      <UndoToast
        open={undoState.open}
        label={undoState.label}
        onUndo={() => void handleUndo()}
      />
    </motion.div>
  );
}
