'use client';

import { useMemo, useState } from 'react';
import { Loader2 } from '@/components/Icons';
import type { FbaBoardItem } from '@/components/fba/FbaBoardTable';
import type { StationTheme } from '@/utils/staff-colors';
import type { FbaPlanQueueItem } from './upnext-types';

export interface FbaShipmentCardProps {
  shipment?: FbaPlanQueueItem;
  stationTheme: StationTheme;
  isActive?: boolean;
  stickyMode?: boolean;
  stickyTitle?: string;
  combinedItems?: FbaBoardItem[];
  amazonShipmentId?: string;
  upsTracking?: string;
  onAmazonShipmentIdChange?: (value: string) => void;
  onUpsTrackingChange?: (value: string) => void;
  onSaveTracking?: () => void | Promise<void>;
  trackingSaving?: boolean;
}

function getPrimaryUps(item: FbaBoardItem) {
  const rows = Array.isArray(item.tracking_numbers) ? item.tracking_numbers : [];
  const ups = rows.find((t) => String(t.carrier || '').toUpperCase() === 'UPS');
  return String(ups?.tracking_number || rows[0]?.tracking_number || '').toUpperCase();
}

export function FbaShipmentCard({
  shipment,
  isActive = false,
  stickyMode = false,
  stickyTitle = 'Combined Pending',
  combinedItems = [],
  amazonShipmentId = '',
  upsTracking = '',
  onAmazonShipmentIdChange,
  onUpsTrackingChange,
  onSaveTracking,
  trackingSaving = false,
}: FbaShipmentCardProps) {
  const [openStickyDetails, setOpenStickyDetails] = useState(false);

  const groupedCombined = useMemo(() => {
    const byShipment = new Map<
      string,
      { shipmentId: number; ups: string; fnskus: Map<string, number> }
    >();
    for (const item of combinedItems) {
      const shipmentId = Number(item.shipment_id || 0);
      const ups = getPrimaryUps(item);
      const key = `${shipmentId}::${ups}`;
      const current = byShipment.get(key) || { shipmentId, ups, fnskus: new Map<string, number>() };
      const fnsku = String(item.fnsku || '').toUpperCase();
      if (fnsku) current.fnskus.set(fnsku, (current.fnskus.get(fnsku) || 0) + 1);
      byShipment.set(key, current);
    }
    return Array.from(byShipment.values());
  }, [combinedItems]);

  if (stickyMode) {
    return (
      <div className="sticky top-0 z-20 border-b border-gray-200 bg-white px-3 py-2">
        <button
          type="button"
          onClick={() => setOpenStickyDetails((v) => !v)}
          className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-purple-300 bg-purple-50 px-3 py-2 text-left"
        >
          <div className="min-w-0">
            <p className="truncate text-[11px] font-black uppercase tracking-widest text-purple-700">{stickyTitle}</p>
            <p className="truncate text-[11px] font-bold text-gray-700">
              {groupedCombined.length} shipment group{groupedCombined.length !== 1 ? 's' : ''}
            </p>
          </div>
          <span className="text-[10px] font-black uppercase tracking-wider text-purple-700">
            {openStickyDetails ? 'Hide' : 'Show'}
          </span>
        </button>

        {openStickyDetails ? (
          <div className="mt-2 space-y-2 rounded-lg border border-gray-200 bg-white p-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="min-w-0">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-gray-500">FBA Shipment ID</span>
                <input
                  value={amazonShipmentId}
                  onChange={(e) => onAmazonShipmentIdChange?.(e.target.value.toUpperCase())}
                  className="h-9 w-full rounded-md border border-gray-300 px-2 font-mono text-xs font-bold text-gray-900 outline-none focus:border-purple-500"
                  placeholder="FBA17XXXXXXXX"
                />
              </label>
              <label className="min-w-0">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-gray-500">UPS Tracking</span>
                <input
                  value={upsTracking}
                  onChange={(e) => onUpsTrackingChange?.(e.target.value.toUpperCase())}
                  className="h-9 w-full rounded-md border border-gray-300 px-2 font-mono text-xs font-bold text-gray-900 outline-none focus:border-purple-500"
                  placeholder="1Z..."
                />
              </label>
            </div>

            <button
              type="button"
              onClick={() => void onSaveTracking?.()}
              disabled={trackingSaving || !combinedItems.length}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-purple-300 bg-purple-50 px-2.5 text-[10px] font-black uppercase tracking-wider text-purple-800 disabled:opacity-50"
            >
              {trackingSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Save Pending Shipment
            </button>

            <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-gray-100 bg-gray-50 p-2">
              {groupedCombined.length === 0 ? (
                <p className="text-[10px] font-semibold text-gray-400">No pending FNSKUs selected</p>
              ) : (
                groupedCombined.map((group) => (
                  <div key={`${group.shipmentId}-${group.ups || 'none'}`} className="rounded-md border border-gray-200 bg-white p-2">
                    <p className="font-mono text-[10px] font-black text-gray-700">
                      Shipment #{group.shipmentId} {group.ups ? `· UPS ${group.ups}` : '· UPS —'}
                    </p>
                    <ul className="mt-1 divide-y divide-gray-100">
                      {Array.from(group.fnskus.entries()).map(([fnsku, count]) => (
                        <li key={fnsku} className="flex items-center justify-between py-1">
                          <span className="font-mono text-[10px] font-black text-gray-700">{fnsku}</span>
                          <span className="text-[10px] font-black tabular-nums text-gray-500">{count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  const shipmentRef = String(shipment?.shipment_ref || '').trim() || `#${shipment?.id ?? '—'}`;
  const itemsLabel = `${Number(shipment?.total_items || 0)} pending item${Number(shipment?.total_items || 0) === 1 ? '' : 's'}`;

  return (
    <button
      type="button"
      className={`w-full border-b-2 px-3 py-3 text-left transition-colors ${
        isActive ? 'border-purple-500 bg-white' : 'border-purple-300 bg-white hover:border-purple-500'
      }`}
      onClick={() => {
        if (!shipment) return;
        window.dispatchEvent(
          new CustomEvent('fba-print-focus-plan', {
            detail: { shipmentId: shipment.id, shipmentRef: shipmentRef || null },
          }),
        );
      }}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="truncate text-[12px] font-black text-gray-900">{itemsLabel}</span>
        <span className="shrink-0 rounded border border-gray-300 px-1.5 py-0.5 font-mono text-[10px] font-black text-gray-700">
          {shipmentRef}
        </span>
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
        Pending
      </p>
    </button>
  );
}
