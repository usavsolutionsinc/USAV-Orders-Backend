'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from '@/components/Icons';
import { FbaSelectedLineRow } from '@/components/fba/sidebar/FbaSelectedLineRow';
import { FbaQtyStepper } from '@/components/fba/sidebar/FbaQtyStepper';
import {
  SidebarIntakeFormShell,
  SidebarIntakeFormField,
  SIDEBAR_INTAKE_INPUT_MONO_CLASS,
} from '@/design-system/components';
import { fbaPaths } from '@/lib/fba/api-paths';
import { patchFbaItem, deleteFbaItem } from '@/lib/fba/patch';
import { FBA_ACTIVE_SHIPMENTS_REFRESH, USAV_REFRESH_DATA, FBA_FNSKU_SAVED } from '@/lib/fba/events';
import { useFbaEvent } from '@/components/fba/hooks/useFbaEvent';
import { emitOpenQuickAddFnsku } from '@/components/fba/FbaQuickAddFnskuModal';
import type { StationTheme } from '@/utils/staff-colors';
import { fbaSidebarThemeChrome } from '@/utils/staff-colors';
import type { ActiveShipment, ShipmentCardItem, TrackingBundle } from '@/lib/fba/types';

interface TrackingRowDraft {
  /** null for newly added rows */
  link_id: number | null;
  tracking_number: string;
  carrier: string;
  /** Marked for deletion on save */
  deleted?: boolean;
}

interface FbaShipmentEditorFormProps {
  shipment: ActiveShipment;
  stationTheme?: StationTheme;
  onClose: () => void;
  onChanged: () => void;
}

export function FbaShipmentEditorForm({
  shipment,
  stationTheme = 'green',
  onClose,
  onChanged,
}: FbaShipmentEditorFormProps) {
  const chrome = fbaSidebarThemeChrome[stationTheme];

  // ── Editable state ──
  const [amazonShipmentId, setAmazonShipmentId] = useState(shipment.amazon_shipment_id || '');
  const [trackingRows, setTrackingRows] = useState<TrackingRowDraft[]>(() =>
    shipment.bundles.length > 0
      ? shipment.bundles.map((b) => ({ link_id: b.link_id, tracking_number: b.tracking_number, carrier: b.carrier }))
      : shipment.tracking_numbers.map((t, i) => ({ link_id: null, tracking_number: t.tracking_number, carrier: t.carrier })),
  );
  const [items, setItems] = useState<ShipmentCardItem[]>(shipment.items);
  const [qtyOverrides, setQtyOverrides] = useState<Record<number, number>>({});
  const [removedItemIds, setRemovedItemIds] = useState<Set<number>>(new Set());

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Sync if shipment prop changes ──
  useEffect(() => {
    setAmazonShipmentId(shipment.amazon_shipment_id || '');
    setTrackingRows(
      shipment.bundles.length > 0
        ? shipment.bundles.map((b) => ({ link_id: b.link_id, tracking_number: b.tracking_number, carrier: b.carrier }))
        : shipment.tracking_numbers.map((t) => ({ link_id: null, tracking_number: t.tracking_number, carrier: t.carrier })),
    );
    setItems(shipment.items);
    setQtyOverrides({});
    setRemovedItemIds(new Set());
    setError(null);
  }, [shipment]);

  // ── Listen for newly saved FNSKUs to add ──
  useFbaEvent(FBA_FNSKU_SAVED, () => {
    // Refresh items from API after a catalog save
    fetch(fbaPaths.planItems(shipment.id), { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && Array.isArray(data.items)) {
          setItems(
            data.items.map((i: any) => ({
              item_id: Number(i.id),
              fnsku: i.fnsku,
              display_title: i.display_title || i.product_title || i.fnsku,
              expected_qty: Number(i.expected_qty) || 0,
              actual_qty: Number(i.actual_qty) || 0,
              status: i.status,
              shipment_id: shipment.id,
            })),
          );
        }
      })
      .catch(() => {});
  });

  // ── Helpers ──
  const getQty = useCallback(
    (item: ShipmentCardItem) => qtyOverrides[item.item_id] ?? item.expected_qty,
    [qtyOverrides],
  );

  const visibleItems = items.filter((i) => !removedItemIds.has(i.item_id));
  const totalQty = visibleItems.reduce((s, i) => s + getQty(i), 0);
  const visibleTrackingRows = trackingRows.filter((r) => !r.deleted);

  // ── Tracking CRUD ──
  const addTrackingRow = () => {
    setTrackingRows((prev) => [...prev, { link_id: null, tracking_number: '', carrier: 'UPS' }]);
  };

  const updateTrackingRow = (index: number, value: string) => {
    setTrackingRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, tracking_number: value.toUpperCase() } : r)),
    );
  };

  const removeTrackingRow = (index: number) => {
    setTrackingRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, deleted: true } : r)),
    );
  };

  // ── Item CRUD ──
  const handleQtyChange = (itemId: number, qty: number) => {
    if (qty <= 0) {
      setRemovedItemIds((prev) => new Set(prev).add(itemId));
      return;
    }
    setQtyOverrides((prev) => ({ ...prev, [itemId]: qty }));
  };

  const restoreItem = (itemId: number) => {
    setRemovedItemIds((prev) => {
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
  };

  // ── Save all changes ──
  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      // 1. Update FBA Shipment ID if changed
      const newAmazon = amazonShipmentId.trim().toUpperCase();
      if (newAmazon !== (shipment.amazon_shipment_id || '').trim().toUpperCase()) {
        const res = await fetch(fbaPaths.plan(shipment.id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amazon_shipment_id: newAmazon || null }),
        });
        if (!res.ok) throw new Error('Failed to update FBA Shipment ID');
      }

      // 2. Delete removed tracking numbers
      for (const row of trackingRows) {
        if (row.deleted && row.link_id) {
          await fetch(`${fbaPaths.planTracking(shipment.id)}?link_id=${row.link_id}`, {
            method: 'DELETE',
          });
        }
      }

      // 3. Add new tracking numbers
      for (const row of trackingRows) {
        if (!row.deleted && !row.link_id && row.tracking_number.trim()) {
          await fetch(fbaPaths.planTracking(shipment.id), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tracking_number: row.tracking_number.trim(),
              carrier: row.carrier || 'UPS',
            }),
          });
        }
      }

      // 4. Update changed tracking numbers (existing rows with modified values)
      for (const row of trackingRows) {
        if (!row.deleted && row.link_id) {
          const original = shipment.bundles.find((b) => b.link_id === row.link_id);
          if (original && original.tracking_number !== row.tracking_number.trim()) {
            await fetch(fbaPaths.planTracking(shipment.id), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                link_id: row.link_id,
                tracking_number: row.tracking_number.trim(),
                carrier: row.carrier || 'UPS',
              }),
            });
          }
        }
      }

      // 5. Delete removed items
      for (const itemId of removedItemIds) {
        await deleteFbaItem(shipment.id, itemId);
      }

      // 6. Update changed item quantities
      for (const [itemIdStr, qty] of Object.entries(qtyOverrides)) {
        const itemId = Number(itemIdStr);
        if (removedItemIds.has(itemId)) continue;
        const original = items.find((i) => i.item_id === itemId);
        if (original && original.expected_qty !== qty) {
          await patchFbaItem(shipment.id, itemId, { expected_qty: qty });
        }
      }

      // Done — emit refresh and close
      window.dispatchEvent(new CustomEvent(FBA_ACTIVE_SHIPMENTS_REFRESH));
      window.dispatchEvent(new CustomEvent(USAV_REFRESH_DATA));
      onChanged();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SidebarIntakeFormShell
      title="Edit Shipment"
      subtitle="FBA Shipment Editor"
      subtitleAccent="purple"
      onClose={onClose}
      footer={
        <div className="space-y-2">
          {error && <p className="text-[11px] font-semibold text-red-600">{error}</p>}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className={chrome.primaryButton}
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </span>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      }
    >
      {/* ── FBA Shipment ID ── */}
      <SidebarIntakeFormField label="FBA Shipment ID">
        <input
          type="text"
          value={amazonShipmentId}
          onChange={(e) => setAmazonShipmentId(e.target.value.toUpperCase())}
          placeholder="FBA1234ABCD"
          className={chrome.monoInput}
        />
      </SidebarIntakeFormField>

      {/* ── UPS Tracking Numbers ── */}
      <SidebarIntakeFormField
        label="UPS Tracking Numbers"
        hintBelow={
          visibleTrackingRows.length === 0 ? (
            <p className="text-[10px] text-gray-400">No tracking numbers yet</p>
          ) : null
        }
      >
        <div className="space-y-2">
          {trackingRows.map((row, idx) => {
            if (row.deleted) return null;
            return (
              <div key={row.link_id ?? `new-${idx}`} className="flex items-center gap-2">
                <input
                  type="text"
                  value={row.tracking_number}
                  onChange={(e) => updateTrackingRow(idx, e.target.value)}
                  placeholder="1Z..."
                  className={`${chrome.monoInput} flex-1`}
                />
                <button
                  type="button"
                  onClick={() => removeTrackingRow(idx)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-red-200 text-red-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  aria-label="Remove tracking number"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            onClick={addTrackingRow}
            className={chrome.secondaryButton}
          >
            <Plus className="h-3 w-3" />
            Add Tracking Number
          </button>
        </div>
      </SidebarIntakeFormField>

      {/* ── Items ── */}
      <div>
        <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-purple-700">
          Items ({visibleItems.length} SKUs · {totalQty} units)
        </p>
        <div className="divide-y divide-gray-100 rounded-xl border border-purple-100 bg-purple-50/30">
          {visibleItems.map((item) => {
            const qty = getQty(item);
            return (
              <FbaSelectedLineRow
                key={item.item_id}
                displayTitle={item.display_title || 'No title'}
                fnsku={String(item.fnsku || '').toUpperCase()}
                stationTheme={stationTheme}
                checked
                onCheckedChange={() => handleQtyChange(item.item_id, 0)}
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
                  <FbaQtyStepper
                    value={qty}
                    onChange={(v) => handleQtyChange(item.item_id, v)}
                    fnsku={item.fnsku}
                  />
                }
              />
            );
          })}
          {visibleItems.length === 0 && (
            <p className="px-3 py-4 text-center text-[11px] font-bold text-gray-400">
              No items in this shipment
            </p>
          )}
        </div>

        {/* Add FNSKU button */}
        <button
          type="button"
          onClick={() =>
            emitOpenQuickAddFnsku({
              fnsku: null,
              product_title: null,
              asin: null,
              sku: null,
              condition: null,
            })
          }
          className={`mt-2 ${chrome.secondaryButton}`}
        >
          <Plus className="h-3 w-3" />
          Add FNSKU
        </button>
      </div>
    </SidebarIntakeFormShell>
  );
}
