'use client';

import { useCallback, useEffect, useState } from 'react';
import { fbaPaths } from '@/lib/fba/api-paths';
import { USAV_REFRESH_DATA, FBA_PRINT_SHIPPED } from '@/lib/fba/events';
import { AnimatePresence } from 'framer-motion';
import { Loader2 } from '@/components/Icons';
import {
  FbaShipmentCard,
  type ActiveShipment,
  type ShipmentCardItem,
  type TrackingBundle,
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
    let allItems: ShipmentCardItem[] = [];
    const bundles: TrackingBundle[] = [];

    try {
      const [trackingRes, itemsRes] = await Promise.all([
        fetch(fbaPaths.planTracking(s.id), { cache: 'no-store' }),
        fetch(fbaPaths.planItems(s.id), { cache: 'no-store' }),
      ]);
      const trackingData = await trackingRes.json().catch(() => ({}));
      const itemsData = await itemsRes.json().catch(() => ({}));

      // Build a lookup of all items by ID.
      const itemById = new Map<number, ShipmentCardItem>();
      if (itemsData.success && Array.isArray(itemsData.items)) {
        for (const i of itemsData.items) {
          if (!includeShipped && i.status === 'SHIPPED') continue;
          itemById.set(Number(i.id), {
            item_id: Number(i.id),
            fnsku: i.fnsku,
            display_title: i.display_title || i.product_title || i.fnsku,
            expected_qty: Number(i.expected_qty) || 0,
            actual_qty: Number(i.actual_qty) || 0,
            status: i.status,
            shipment_id: s.id,
          });
        }
      }

      // Map each tracking row's allocations to items, stamping tracking_number per item.
      if (trackingRes.ok && Array.isArray(trackingData?.tracking)) {
        const usedItemIds = new Set<number>();
        for (const row of trackingData.tracking as TrackingRow[]) {
          const linkId = Number(row.link_id) || 0;
          const trackingNumber = String(row.tracking_number_raw || '').trim();
          const carrier = String(row.carrier || '').trim();
          if (!linkId || !trackingNumber) continue;

          const allocations = Array.isArray(row.allocations) ? row.allocations : [];
          const bundleItems: ShipmentCardItem[] = [];
          for (const alloc of allocations) {
            const itemId = Number(alloc.shipment_item_id);
            const item = itemById.get(itemId);
            if (!item) continue;
            bundleItems.push({
              ...item,
              expected_qty: Math.max(1, Number(alloc.qty) || 1),
              tracking_number: trackingNumber,
              tracking_carrier: carrier,
            });
            usedItemIds.add(itemId);
          }

          if (bundleItems.length > 0) {
            bundles.push({ link_id: linkId, tracking_number: trackingNumber, carrier, items: bundleItems });
          }
        }
      }

      // Flatten all bundle items for the `items` field.
      allItems = bundles.flatMap((b) => b.items);
    } catch {
      // skip fetch failure per shipment
    }

    // Compat: first bundle's values for legacy fields.
    const primary = bundles[0] ?? null;

    return {
      id: s.id,
      shipment_ref: s.shipment_ref,
      amazon_shipment_id: s.amazon_shipment_id || null,
      status: s.status,
      shipped_at: s.shipped_at || null,
      bundles,
      tracking_numbers: bundles.map((b) => ({ tracking_number: b.tracking_number, carrier: b.carrier })),
      tracking_link_id: primary?.link_id ?? null,
      tracking_number_raw: primary?.tracking_number ?? null,
      tracking_carrier: primary?.carrier ?? null,
      items: allItems,
    };
  }, []);

  const fetchShipments = useCallback(async () => {
    try {
      const [activeRes, shippedRes] = await Promise.all([
        fetch(fbaPaths.plans() + '?status=PLANNED,READY_TO_GO,LABEL_ASSIGNED&limit=50', { cache: 'no-store' }),
        fetch(fbaPaths.plans() + '?status=SHIPPED&limit=10', { cache: 'no-store' }),
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
    window.addEventListener(USAV_REFRESH_DATA, handler);
    window.addEventListener(FBA_PRINT_SHIPPED, handler);
    window.addEventListener('fba-active-shipments-refresh', handler);
    return () => {
      window.removeEventListener(USAV_REFRESH_DATA, handler);
      window.removeEventListener(FBA_PRINT_SHIPPED, handler);
      window.removeEventListener('fba-active-shipments-refresh', handler);
    };
  }, [fetchShipments]);

  if (loading) {
    return (
      <div className="space-y-2 px-3 py-4">
        <div className="h-4 w-32 bg-zinc-100 rounded animate-pulse mb-3" />
        <div className="h-24 w-full rounded-xl bg-zinc-50 border border-zinc-100 animate-pulse" />
        <div className="h-24 w-full rounded-xl bg-zinc-50 border border-zinc-100 animate-pulse" />
      </div>
    );
  }

  if (shipments.length === 0 && recentShipped.length === 0) return null;

  return (
    <div className="space-y-3 pb-2">
      {shipments.length > 0 ? (
        <div>
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
        <div>
          <p className={`px-3 py-2 ${sectionLabel}`}>Recent shipments</p>
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
