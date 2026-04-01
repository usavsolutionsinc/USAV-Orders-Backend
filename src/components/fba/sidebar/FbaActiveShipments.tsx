'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Loader2 } from '@/components/Icons';
import {
  FbaShipmentCard,
  type ActiveShipment,
  type ShipmentCardItem,
} from '@/components/station/upnext/FbaShipmentCard';
import type { StationTheme } from '@/utils/staff-colors';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

type TrackingAllocation = {
  shipment_item_id: number;
  qty: number;
};

type TrackingRow = {
  link_id: number;
  tracking_number_raw: string;
  carrier: string;
  allocations?: TrackingAllocation[];
};

/* ── Component ─────────────────────────────────────────────────────── */

export function FbaActiveShipments({ stationTheme = 'green' }: { stationTheme?: StationTheme }) {
  const [shipments, setShipments] = useState<ActiveShipment[]>([]);
  const [recentShipped, setRecentShipped] = useState<ActiveShipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const toggleExpand = (id: number) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const enrichShipment = useCallback(async (s: any, includeShipped: boolean): Promise<ActiveShipment> => {
    let items: ShipmentCardItem[] = [];
    let trackingLinkId: number | null = null;
    let trackingNumberRaw: string | null = null;
    let trackingCarrier: string | null = null;
    let allocationByItemId = new Map<number, number>();

    try {
      const [trackingRes, itemsRes] = await Promise.all([
        fetch(`/api/fba/shipments/${s.id}/tracking`, { cache: 'no-store' }),
        fetch(`/api/fba/shipments/${s.id}/items`, { cache: 'no-store' }),
      ]);
      const trackingData = await trackingRes.json().catch(() => ({}));
      const itemsData = await itemsRes.json().catch(() => ({}));

      if (trackingRes.ok && Array.isArray(trackingData?.tracking) && trackingData.tracking.length > 0) {
        const primary = trackingData.tracking[0] as TrackingRow;
        trackingLinkId = Number(primary.link_id) || null;
        trackingNumberRaw = String(primary.tracking_number_raw || '').trim() || null;
        trackingCarrier = String(primary.carrier || '').trim() || null;
        const allocations = Array.isArray(primary.allocations) ? primary.allocations : [];
        allocationByItemId = new Map(
          allocations
            .map((row) => [Number(row.shipment_item_id), Math.max(1, Number(row.qty) || 1)] as const)
            .filter(([itemId]) => Number.isFinite(itemId) && itemId > 0),
        );
      }

      if (itemsData.success && Array.isArray(itemsData.items)) {
        const sourceItems = itemsData.items
          .filter((i: any) => includeShipped || i.status !== 'SHIPPED')
          .map((i: any) => ({
            item_id: i.id,
            fnsku: i.fnsku,
            display_title: i.display_title || i.product_title || i.fnsku,
            expected_qty: Number(i.expected_qty) || 0,
            actual_qty: Number(i.actual_qty) || 0,
            status: i.status,
            shipment_id: s.id,
          }));

        if (allocationByItemId.size > 0) {
          items = sourceItems
            .filter((i: any) => allocationByItemId.has(Number(i.item_id)))
            .map((i: any) => ({
              ...i,
              expected_qty: allocationByItemId.get(Number(i.item_id)) ?? i.expected_qty,
            }));
        } else {
          items = sourceItems;
        }
      }
    } catch {
      // skip fetch failure per shipment
    }

    return {
      id: s.id,
      shipment_ref: s.shipment_ref,
      amazon_shipment_id: s.amazon_shipment_id || null,
      status: s.status,
      shipped_at: s.shipped_at || null,
      tracking_numbers: (s.tracking_numbers || []).map((t: any) => ({
        tracking_number: t.tracking_number,
        carrier: t.carrier || '',
      })),
      tracking_link_id: trackingLinkId,
      tracking_number_raw: trackingNumberRaw,
      tracking_carrier: trackingCarrier,
      items,
    };
  }, []);

  const fetchShipments = useCallback(async () => {
    try {
      const [activeRes, shippedRes] = await Promise.all([
        fetch('/api/fba/shipments?status=PLANNED,READY_TO_GO,LABEL_ASSIGNED&limit=50', { cache: 'no-store' }),
        fetch('/api/fba/shipments?status=SHIPPED&limit=10', { cache: 'no-store' }),
      ]);
      const activeData = await activeRes.json().catch(() => ({}));
      const shippedData = await shippedRes.json().catch(() => ({}));

      // Active shipments (with tracking only)
      if (activeRes.ok && Array.isArray(activeData.shipments)) {
        const withTracking = activeData.shipments.filter(
          (s: any) => Array.isArray(s.tracking_numbers) && s.tracking_numbers.length > 0,
        );
        const enriched = await Promise.all(withTracking.map((s: any) => enrichShipment(s, false)));
        const next = enriched.filter((s) => s.items.length > 0);
        const nextIds = new Set(next.map((s) => s.id));
        setExpandedIds((prev) => {
          const pruned = new Set([...prev].filter((id) => nextIds.has(id)));
          return pruned.size === prev.size ? prev : pruned;
        });
        setShipments(next);
      }

      // Recent shipped (last 10, with tracking)
      if (shippedRes.ok && Array.isArray(shippedData.shipments)) {
        const withTracking = shippedData.shipments.filter(
          (s: any) => Array.isArray(s.tracking_numbers) && s.tracking_numbers.length > 0,
        );
        const enriched = await Promise.all(withTracking.map((s: any) => enrichShipment(s, true)));
        setRecentShipped(enriched.filter((s) => s.items.length > 0));
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [enrichShipment]);

  useEffect(() => {
    void fetchShipments();
  }, [fetchShipments]);

  useEffect(() => {
    const handler = () => {
      void fetchShipments();
    };
    window.addEventListener('usav-refresh-data', handler);
    window.addEventListener('fba-print-shipped', handler);
    window.addEventListener('fba-active-shipments-refresh', handler);
    return () => {
      window.removeEventListener('usav-refresh-data', handler);
      window.removeEventListener('fba-print-shipped', handler);
      window.removeEventListener('fba-active-shipments-refresh', handler);
    };
  }, [fetchShipments]);

  if (loading) {
    return (
      <div className="flex items-center justify-center px-3 py-4">
        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
      </div>
    );
  }

  if (shipments.length === 0 && recentShipped.length === 0) return null;

  return (
    <div className="space-y-3 pb-2">
      {shipments.length > 0 ? (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {shipments.map((shipment) => (
              <FbaShipmentCard
                key={shipment.id}
                shipment={shipment}
                stationTheme={stationTheme}
                editable
                isExpanded={expandedIds.has(shipment.id)}
                onToggleExpand={() => toggleExpand(shipment.id)}
                onChanged={() => {
                  window.dispatchEvent(new CustomEvent('fba-active-shipments-refresh'));
                  window.dispatchEvent(new CustomEvent('usav-refresh-data'));
                }}
              />
            ))}
          </AnimatePresence>
        </div>
      ) : null}

      {recentShipped.length > 0 ? (
        <div className="space-y-2">
          <p className={`px-1 ${sectionLabel}`}>Recent shipments</p>
          <AnimatePresence initial={false}>
            {recentShipped.map((shipment) => (
              <FbaShipmentCard
                key={shipment.id}
                shipment={shipment}
                stationTheme={stationTheme}
                isExpanded={expandedIds.has(shipment.id)}
                onToggleExpand={() => toggleExpand(shipment.id)}
              />
            ))}
          </AnimatePresence>
        </div>
      ) : null}
    </div>
  );
}
