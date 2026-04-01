'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Minus, Plus } from '@/components/Icons';
import type { FbaBoardItem } from '@/components/fba/FbaBoardTable';
import { FbaSelectedLineRow } from '@/components/fba/sidebar/FbaSelectedLineRow';
import { DeferredQtyInput } from '@/design-system/primitives';
import { FormField } from '@/design-system/components';
import { microBadge } from '@/design-system/tokens/typography/presets';
import type { StationTheme } from '@/utils/staff-colors';
import { fbaSidebarThemeChrome } from '@/utils/staff-colors';
import { getUniqueSelectedShipmentIds } from '@/lib/fba/pairing';

interface FbaPairedReviewPanelProps {
  selectedItems: FbaBoardItem[];
  stationTheme?: StationTheme;
}

export function FbaPairedReviewPanel({
  selectedItems,
  stationTheme = 'green',
}: FbaPairedReviewPanelProps) {
  const chrome = fbaSidebarThemeChrome[stationTheme];

  const [amazonShipmentId, setAmazonShipmentId] = useState('');
  const [upsTracking, setUpsTracking] = useState('');
  const [qtyOverrides, setQtyOverrides] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const shipmentIds = getUniqueSelectedShipmentIds(selectedItems);

  // Clean up overrides for items that left the selection
  useEffect(() => {
    const currentIds = new Set(selectedItems.map((i) => i.item_id));
    setQtyOverrides((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const id of Object.keys(next)) {
        if (!currentIds.has(Number(id))) { delete next[Number(id)]; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [selectedItems]);

  const getQty = useCallback(
    (item: FbaBoardItem) => {
      const override = qtyOverrides[item.item_id];
      if (override !== undefined) return Math.max(0, Number(override));
      return Math.max(1, Number(item.actual_qty || 0));
    },
    [qtyOverrides],
  );

  const adjustQty = useCallback((item: FbaBoardItem, delta: number) => {
    const cur = getQty(item);
    const next = cur + delta;
    if (next <= 0) {
      window.dispatchEvent(new CustomEvent('fba-board-deselect-item', { detail: item.item_id }));
      setQtyOverrides((prev) => {
        const copy = { ...prev };
        delete copy[item.item_id];
        return copy;
      });
      return;
    }
    setQtyOverrides((prev) => ({ ...prev, [item.item_id]: next }));
  }, [getQty]);

  const removeSelectedItem = useCallback((item: FbaBoardItem) => {
    window.dispatchEvent(new CustomEvent('fba-board-deselect-item', { detail: item.item_id }));
    setQtyOverrides((prev) => {
      const copy = { ...prev };
      delete copy[item.item_id];
      return copy;
    });
  }, []);

  const handleAttach = useCallback(async () => {
    const trackingRaw = upsTracking.trim();
    if (!trackingRaw) {
      setError('Enter a UPS tracking number');
      return;
    }
    if (shipmentIds.length === 0) {
      setError('No items selected');
      return;
    }

    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const selectedLines = selectedItems
        .map((item) => ({ item, selectedQty: getQty(item) }))
        .filter((row) => row.selectedQty > 0);

      if (selectedLines.length === 0) {
        throw new Error('Select at least one qty');
      }

      // Persist selected qty for the selected board rows so combine+save is one action.
      for (const { item, selectedQty } of selectedLines) {
        const qty = Math.max(1, selectedQty);
        if (qty === Number(item.expected_qty || 0)) continue;
        await fetch(`/api/fba/shipments/${item.shipment_id}/items/${item.item_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expected_qty: qty }),
        });
      }

      for (const sid of shipmentIds) {
        const shipmentAllocations = selectedLines
          .filter(({ item }) => Number(item.shipment_id) === sid)
          .map(({ item, selectedQty }) => ({
            shipment_item_id: Number(item.item_id),
            quantity: Math.max(1, selectedQty),
          }));
        if (shipmentAllocations.length === 0) continue;

        const res = await fetch(`/api/fba/shipments/${sid}/tracking`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tracking_number: trackingRaw,
            carrier: 'UPS',
            label: 'UPS',
            allocations: shipmentAllocations,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Failed for shipment ${sid}`);
      }

      if (amazonShipmentId.trim()) {
        for (const sid of shipmentIds) {
          await fetch(`/api/fba/shipments/${sid}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amazon_shipment_id: amazonShipmentId.trim() }),
          });
        }
      }

      setUpsTracking('');
      setAmazonShipmentId('');
      setQtyOverrides({});
      const msg = `Saved ${selectedLines.length} line${selectedLines.length === 1 ? '' : 's'} across ${shipmentIds.length} shipment${shipmentIds.length === 1 ? '' : 's'}`;
      setSuccess(msg);
      window.dispatchEvent(new CustomEvent('fba-scan-status', { detail: msg }));
      window.dispatchEvent(new CustomEvent('fba-print-shipped'));
      window.dispatchEvent(new CustomEvent('fba-active-shipments-refresh'));
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch (err: any) {
      setError(err?.message || 'Failed to attach tracking');
    } finally {
      setSaving(false);
    }
  }, [upsTracking, amazonShipmentId, shipmentIds, selectedItems, getQty]);

  if (selectedItems.length === 0) return null;

  return (
    <div className="space-y-2 border-b border-gray-100 px-3 py-3">
      <FormField label="FBA Shipment ID">
        <input
          value={amazonShipmentId}
          onChange={(e) => setAmazonShipmentId(e.target.value.toUpperCase())}
          placeholder="FBA1234ABCD"
          disabled={saving}
          className={chrome.monoInput}
        />
      </FormField>

      <FormField label="UPS Tracking">
        <input
          value={upsTracking}
          onChange={(e) => setUpsTracking(e.target.value.toUpperCase())}
          placeholder="1Z999AA10123456784"
          disabled={saving}
          className={chrome.monoInput}
        />
      </FormField>

      {error && <p className={`${microBadge} tracking-wider text-red-600`}>{error}</p>}
      {success && <p className={`${microBadge} tracking-wider text-emerald-600`}>{success}</p>}

      <button
        type="button"
        onClick={() => void handleAttach()}
        disabled={saving}
        className={`flex h-10 items-center justify-center gap-1.5 ${chrome.primaryButton}`}
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-white" /> : null}
        Save Shipment + UPS
      </button>

      <div className="border-t border-gray-200">
        {selectedItems.map((item) => {
          const qty = getQty(item);
          const baseline = Math.max(1, Number(item.actual_qty || 0));
          const overPlanned = qty > baseline;
          return (
            <FbaSelectedLineRow
              key={item.item_id}
              displayTitle={item.display_title || 'No title'}
              fnsku={String(item.fnsku || '').toUpperCase()}
              stationTheme={stationTheme}
              checked
              onCheckedChange={(nextChecked) => {
                if (!nextChecked) removeSelectedItem(item);
              }}
              rightSlot={
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      adjustQty(item, 1);
                    }}
                    className="flex h-6 w-10 items-center justify-center rounded-t-md border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50"
                    aria-label={`Increase ${item.fnsku} quantity`}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                  <DeferredQtyInput
                    value={qty}
                    min={0}
                    onChange={(v) => {
                      if (v <= 0) {
                        removeSelectedItem(item);
                        return;
                      }
                      setQtyOverrides((prev) => ({ ...prev, [item.item_id]: v }));
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className={`h-7 w-10 border-x bg-white text-center text-[13px] font-black tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
                      overPlanned
                        ? 'border-amber-300 text-amber-700'
                        : 'border-gray-200 text-gray-900'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      adjustQty(item, -1);
                    }}
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
        })}
      </div>
    </div>
  );
}
