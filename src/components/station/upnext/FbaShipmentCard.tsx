'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Minus, Package, Plus } from '@/components/Icons';
import { FnskuChip } from '@/components/ui/CopyChip';
import { PrintTableCheckbox } from '@/components/fba/table/Checkbox';
import { FbaSelectedLineRow } from '@/components/fba/sidebar/FbaSelectedLineRow';
import { ChevronToggle, DeferredQtyInput } from '@/design-system/primitives';
import type { StationTheme } from '@/utils/staff-colors';

/* ── Types ─────────────────────────────────────────────────────────── */

export interface ShipmentCardItem {
  item_id: number;
  fnsku: string;
  display_title: string;
  expected_qty: number;
  actual_qty: number;
  status: string;
  shipment_id: number;
}

export interface ActiveShipment {
  id: number;
  shipment_ref: string;
  amazon_shipment_id: string | null;
  status: string;
  shipped_at?: string | null;
  tracking_numbers: { tracking_number: string; carrier: string }[];
  tracking_link_id?: number | null;
  tracking_number_raw?: string | null;
  tracking_carrier?: string | null;
  items: ShipmentCardItem[];
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

  // Keep items in sync when parent data refreshes
  useEffect(() => {
    setItems(shipment.items);
    setSelectedIds(new Set(shipment.items.map((i) => i.item_id)));
    setQtyOverrides({});
    setError(null);
  }, [shipment.items]);

  const primaryTracking =
    shipment.tracking_number_raw ||
    shipment.tracking_numbers[0]?.tracking_number ||
    '—';
  const carrier =
    shipment.tracking_carrier ||
    shipment.tracking_numbers[0]?.carrier ||
    '';
  const totalQty = items.reduce((s, i) => s + Math.max(0, Number(qtyOverrides[i.item_id] ?? i.expected_qty)), 0);
  const isShipped = shipment.status === 'SHIPPED';
  const shippedDateLabel = (() => {
    if (!shipment.shipped_at) return null;
    try {
      const d = new Date(shipment.shipped_at);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return null; }
  })();

  const getQty = (item: ShipmentCardItem) => Math.max(0, Number(qtyOverrides[item.item_id] ?? item.expected_qty));

  const adjustQty = (item: ShipmentCardItem, delta: number) => {
    const next = getQty(item) + delta;
    if (next < 0) return;
    setQtyOverrides((prev) => ({ ...prev, [item.item_id]: next }));
    if (next === 0) {
      setSelectedIds((prev) => {
        const copy = new Set(prev);
        copy.delete(item.item_id);
        return copy;
      });
    } else {
      setSelectedIds((prev) => {
        const copy = new Set(prev);
        copy.add(item.item_id);
        return copy;
      });
    }
  };

  const setQty = (item: ShipmentCardItem, next: number) => {
    setQtyOverrides((prev) => ({ ...prev, [item.item_id]: next }));
    setSelectedIds((prev) => {
      const copy = new Set(prev);
      if (next <= 0) copy.delete(item.item_id);
      else copy.add(item.item_id);
      return copy;
    });
  };

  const handleSaveSelection = async () => {
    if (!editable) return;
    const linkId = Number(shipment.tracking_link_id || 0);
    if (!Number.isFinite(linkId) || linkId <= 0) {
      setError('Missing tracking link');
      return;
    }
    const selected = items.filter((i) => selectedIds.has(i.item_id));
    const allocations = selected
      .map((item) => ({
        shipment_item_id: item.item_id,
        quantity: Math.max(1, getQty(item)),
      }))
      .filter((row) => row.quantity > 0);

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/fba/shipments/${shipment.id}/tracking`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          link_id: linkId,
          tracking_number: primaryTracking,
          carrier: carrier || 'UPS',
          allocations,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to update shipment allocations');
      onChanged?.();
    } catch (err: any) {
      setError(err?.message || 'Failed to update shipment allocations');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveAll = async () => {
    if (!editable) return;
    const linkId = Number(shipment.tracking_link_id || 0);
    if (!Number.isFinite(linkId) || linkId <= 0) {
      setError('Missing tracking link');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/fba/shipments/${shipment.id}/tracking?link_id=${linkId}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to remove tracking');
      onChanged?.();
    } catch (err: any) {
      setError(err?.message || 'Failed to remove tracking');
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
                {carrier ? `${carrier} · ` : ''}{primaryTracking}
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
              {items.length === 0 ? (
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
                    onAdjustQty={(delta) => adjustQty(item, delta)}
                    onSetQty={(nextQty) => setQty(item, nextQty)}
                  />
                ))
              )}
              {editable ? (
                <div className="space-y-2 px-3 py-2">
                  {error ? <p className="text-[11px] font-semibold text-red-600">{error}</p> : null}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSaveSelection()}
                      disabled={saving}
                      className="flex h-8 items-center justify-center rounded-md border border-emerald-300 bg-emerald-50 text-[10px] font-black uppercase tracking-wider text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRemoveAll()}
                      disabled={saving}
                      className="h-8 rounded-md border border-red-300 bg-red-50 text-[10px] font-black uppercase tracking-wider text-red-700 hover:bg-red-100 disabled:opacity-50"
                    >
                      Remove All
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
