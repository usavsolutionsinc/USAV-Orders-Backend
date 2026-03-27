'use client';

import { useCallback, useState } from 'react';
import { Loader2, Minus, Plus } from '@/components/Icons';
import { DeferredQtyInput } from '@/design-system/primitives';
import type { FbaBoardItem } from '@/components/fba/FbaBoardTable';
import { FbaSelectedLineRow } from '@/components/fba/sidebar/FbaSelectedLineRow';
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

  const defaultQty = (item: FbaBoardItem) => Math.max(1, Number(item.actual_qty || 0));
  const getQty = (item: FbaBoardItem) => qtyOverrides[item.item_id] ?? defaultQty(item);

  const adjustQty = (item: FbaBoardItem, delta: number, max: number) => {
    const cur = qtyOverrides[item.item_id] ?? defaultQty(item);
    const next = cur + delta;
    if (next <= 0) {
      window.dispatchEvent(new CustomEvent('fba-board-deselect-item', { detail: item.item_id }));
      setQtyOverrides((prev) => { const n = { ...prev }; delete n[item.item_id]; return n; });
      return;
    }
    setQtyOverrides((prev) => ({ ...prev, [item.item_id]: Math.min(max, next) }));
  };

  const shipmentIds = Array.from(new Set(selectedItems.map((i) => i.shipment_id)));

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
      for (const sid of shipmentIds) {
        const res = await fetch(`/api/fba/shipments/${sid}/tracking`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tracking_number: trackingRaw,
            carrier: 'UPS',
            label: 'UPS',
            amazon_shipment_id: amazonShipmentId.trim() || undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Failed for shipment ${sid}`);
      }

      if (amazonShipmentId.trim()) {
        for (const sid of shipmentIds) {
          await fetch(`/api/fba/shipments/${sid}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amazon_shipment_id: amazonShipmentId.trim() }),
          }).catch(() => {});
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
  }, [upsTracking, amazonShipmentId, shipmentIds]);

  if (selectedItems.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      {/* FBA Shipment ID */}
      <div>
        <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-gray-600">
          Amazon Shipment ID
        </label>
        <input
          value={amazonShipmentId}
          onChange={(e) => setAmazonShipmentId(e.target.value.toUpperCase())}
          placeholder="FBA1234ABCD"
          disabled={saving}
          className={chrome.monoInput}
        />
      </div>

      {/* UPS Tracking */}
      <div>
        <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-gray-600">
          UPS Tracking Number
        </label>
        <input
          value={upsTracking}
          onChange={(e) => setUpsTracking(e.target.value.toUpperCase())}
          placeholder="1Z999AA10123456784"
          disabled={saving}
          className={chrome.monoInput}
        />
      </div>

      {error && <p className="text-[10px] font-semibold text-red-600">{error}</p>}
      {success && <p className="text-[10px] font-semibold text-emerald-600">{success}</p>}

      <button
        type="button"
        onClick={() => void handleAttach()}
        disabled={saving}
        className={`flex h-10 items-center justify-center gap-1.5 ${chrome.primaryButton}`}
      >
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
        ) : (
          <Plus className="h-3.5 w-3.5" />
        )}
        Attach Tracking
      </button>

      {/* Selected FNSKUs */}
      <div className="divide-y divide-gray-200">
        {selectedItems.map((item) => {
          const qty = getQty(item);
          return (
            <FbaSelectedLineRow
              key={item.item_id}
              displayTitle={item.display_title}
              fnsku={item.fnsku}
              rightSlot={
                <>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); adjustQty(item, 1, item.expected_qty); }}
                    className="flex h-6 w-10 items-center justify-center rounded-t-md border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50"
                    aria-label={`Increase ${item.fnsku} quantity`}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                  <DeferredQtyInput
                    value={qty}
                    min={0}
                    max={item.expected_qty}
                    onChange={(v) => {
                      if (v <= 0) {
                        window.dispatchEvent(new CustomEvent('fba-board-deselect-item', { detail: item.item_id }));
                        setQtyOverrides((prev) => { const n = { ...prev }; delete n[item.item_id]; return n; });
                      } else {
                        setQtyOverrides((prev) => ({ ...prev, [item.item_id]: v }));
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-7 w-10 border-x border-gray-200 bg-white text-center text-[13px] font-black tabular-nums text-gray-900 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); adjustQty(item, -1, item.expected_qty); }}
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
