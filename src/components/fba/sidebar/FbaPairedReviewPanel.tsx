'use client';

import { useCallback, useState } from 'react';
import { Loader2, Minus, Plus } from '@/components/Icons';
import type { FbaBoardItem } from '@/components/fba/FbaBoardTable';
import { FbaSelectedLineRow } from '@/components/fba/sidebar/FbaSelectedLineRow';
import { DeferredQtyInput } from '@/design-system/primitives';
import type { StationTheme } from '@/utils/staff-colors';
import { fbaSidebarThemeChrome } from '@/utils/staff-colors';

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

  const shipmentIds = Array.from(
    new Set(
      selectedItems.flatMap((i) => {
        const grouped = Array.isArray(i.shipment_ids) ? i.shipment_ids : [];
        if (grouped.length > 0) return grouped.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
        const single = Number(i.shipment_id || 0);
        return Number.isFinite(single) && single > 0 ? [single] : [];
      }),
    ),
  );

  const defaultQty = useCallback((item: FbaBoardItem) => {
    const expected = Math.max(0, Number(item.expected_qty || 0));
    if (expected > 0) return expected;
    return Math.max(1, Number(item.actual_qty || 0));
  }, []);

  const getQty = useCallback(
    (item: FbaBoardItem) => {
      const next = Number(qtyOverrides[item.item_id]);
      if (Number.isFinite(next)) return Math.max(0, Math.min(defaultQty(item), next));
      return defaultQty(item);
    },
    [defaultQty, qtyOverrides],
  );

  const adjustQty = useCallback((item: FbaBoardItem, delta: number) => {
    const max = Math.max(1, Number(item.expected_qty || 0));
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
    setQtyOverrides((prev) => ({ ...prev, [item.item_id]: Math.min(max, next) }));
  }, [getQty]);

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
        const clamped = Math.max(1, Math.min(Math.max(1, Number(item.expected_qty || 0)), selectedQty));
        if (clamped === Number(item.expected_qty || 0)) continue;
        await fetch(`/api/fba/shipments/${item.shipment_id}/items/${item.item_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expected_qty: clamped }),
        });
      }

      for (const sid of shipmentIds) {
        const res = await fetch(`/api/fba/shipments/${sid}/tracking`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tracking_number: trackingRaw,
            carrier: 'UPS',
            label: 'UPS',
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
      setSuccess(`Tracking attached to ${shipmentIds.length} shipment${shipmentIds.length > 1 ? 's' : ''}`);
      window.dispatchEvent(new CustomEvent('fba-print-shipped'));
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
      <label className="block">
        <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-gray-600">FBA Shipment ID</span>
        <input
          value={amazonShipmentId}
          onChange={(e) => setAmazonShipmentId(e.target.value.toUpperCase())}
          placeholder="FBA1234ABCD"
          disabled={saving}
          className={chrome.monoInput}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-gray-600">UPS Tracking</span>
        <input
          value={upsTracking}
          onChange={(e) => setUpsTracking(e.target.value.toUpperCase())}
          placeholder="1Z999AA10123456784"
          disabled={saving}
          className={chrome.monoInput}
        />
      </label>

      {error && <p className="text-[10px] font-semibold text-red-600">{error}</p>}
      {success && <p className="text-[10px] font-semibold text-emerald-600">{success}</p>}

      <button
        type="button"
        onClick={() => void handleAttach()}
        disabled={saving}
        className={`flex h-10 items-center justify-center gap-1.5 ${chrome.primaryButton}`}
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-white" /> : null}
        Save Shipment + UPS
      </button>

      <div className="divide-y divide-gray-200 border-t border-gray-200">
        {selectedItems.map((item) => {
          const qty = getQty(item);
          const max = Math.max(1, Number(item.expected_qty || 0));
          return (
            <FbaSelectedLineRow
              key={item.item_id}
              displayTitle={item.display_title || 'No title'}
              fnsku={String(item.fnsku || '').toUpperCase()}
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
                    max={max}
                    onChange={(v) => {
                      if (v <= 0) {
                        window.dispatchEvent(new CustomEvent('fba-board-deselect-item', { detail: item.item_id }));
                        setQtyOverrides((prev) => {
                          const copy = { ...prev };
                          delete copy[item.item_id];
                          return copy;
                        });
                        return;
                      }
                      setQtyOverrides((prev) => ({ ...prev, [item.item_id]: Math.min(max, v) }));
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-7 w-10 border-x border-gray-200 bg-white text-center text-[13px] font-black tabular-nums text-gray-900 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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
