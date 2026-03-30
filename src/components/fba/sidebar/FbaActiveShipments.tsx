'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { AnimatePresence } from 'framer-motion';
import { Loader2 } from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import {
  FbaShipmentCard,
  type ActiveShipment,
  type ShipmentCardItem,
} from '@/components/station/upnext/FbaShipmentCard';

/* ── Component ─────────────────────────────────────────────────────── */

export function FbaActiveShipments() {
  const [shipments, setShipments] = useState<ActiveShipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [reassigning, setReassigning] = useState(false);

  /* ── Fetch active shipments (have tracking, not shipped) ────────── */
  const fetchShipments = useCallback(async () => {
    try {
      // Get non-shipped shipments
      const res = await fetch('/api/fba/shipments?status=PLANNED,READY_TO_GO,LABEL_ASSIGNED&limit=50', {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.shipments)) return;

      // Filter to only those with tracking numbers
      const withTracking = data.shipments.filter(
        (s: any) => Array.isArray(s.tracking_numbers) && s.tracking_numbers.length > 0,
      );

      // Fetch items for each shipment
      const enriched: ActiveShipment[] = await Promise.all(
        withTracking.map(async (s: any) => {
          let items: ShipmentCardItem[] = [];
          try {
            const itemsRes = await fetch(`/api/fba/shipments/${s.id}/items`, { cache: 'no-store' });
            const itemsData = await itemsRes.json();
            if (itemsData.success && Array.isArray(itemsData.items)) {
              items = itemsData.items
                .filter((i: any) => i.status !== 'SHIPPED')
                .map((i: any) => ({
                  item_id: i.id,
                  fnsku: i.fnsku,
                  display_title: i.display_title || i.product_title || i.fnsku,
                  expected_qty: Number(i.expected_qty) || 0,
                  actual_qty: Number(i.actual_qty) || 0,
                  status: i.status,
                  shipment_id: s.id,
                }));
            }
          } catch {
            // skip items fetch failure
          }
          return {
            id: s.id,
            shipment_ref: s.shipment_ref,
            amazon_shipment_id: s.amazon_shipment_id || null,
            status: s.status,
            tracking_numbers: (s.tracking_numbers || []).map((t: any) => ({
              tracking_number: t.tracking_number,
              carrier: t.carrier || '',
            })),
            items,
          };
        }),
      );

      // Only show shipments that have items
      setShipments(enriched.filter((s) => s.items.length > 0));
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchShipments();
  }, [fetchShipments]);

  // Listen for refresh events
  useEffect(() => {
    const handler = () => fetchShipments();
    window.addEventListener('usav-refresh-data', handler);
    window.addEventListener('fba-print-shipped', handler);
    window.addEventListener('fba-active-shipments-refresh', handler);
    return () => {
      window.removeEventListener('usav-refresh-data', handler);
      window.removeEventListener('fba-print-shipped', handler);
      window.removeEventListener('fba-active-shipments-refresh', handler);
    };
  }, [fetchShipments]);

  /* ── DnD sensors (pointer + touch for mobile) ──────────────────── */
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 8 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 200, tolerance: 5 },
  });
  const sensors = useSensors(pointerSensor, touchSensor);

  /* ── Handle drop: reassign item to target shipment ─────────────── */
  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;

      const draggedItem = active.data.current?.item as ShipmentCardItem | undefined;
      const targetShipment = over.data.current?.shipment as ActiveShipment | undefined;

      if (!draggedItem || !targetShipment) return;
      if (draggedItem.shipment_id === targetShipment.id) return;

      setReassigning(true);
      try {
        const res = await fetch(
          `/api/fba/shipments/${draggedItem.shipment_id}/items/${draggedItem.item_id}/reassign`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_shipment_id: targetShipment.id }),
          },
        );
        const data = await res.json();
        if (data.success) {
          // Optimistic update: move item between cards locally
          setShipments((prev) =>
            prev
              .map((s) => {
                if (s.id === draggedItem.shipment_id) {
                  return { ...s, items: s.items.filter((i) => i.item_id !== draggedItem.item_id) };
                }
                if (s.id === targetShipment.id) {
                  return {
                    ...s,
                    items: [...s.items, { ...draggedItem, shipment_id: targetShipment.id }],
                  };
                }
                return s;
              })
              .filter((s) => s.items.length > 0),
          );
          window.dispatchEvent(new CustomEvent('usav-refresh-data'));
        }
      } catch {
        // silent — will refresh
      } finally {
        setReassigning(false);
      }
    },
    [],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center px-3 py-4">
        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
      </div>
    );
  }

  if (shipments.length === 0) return null;

  return (
    <div className="border-b border-gray-100 px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <p className={sectionLabel}>
          Active Shipments ({shipments.length})
        </p>
        {reassigning && <Loader2 className="h-3 w-3 animate-spin text-purple-500" />}
      </div>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {shipments.map((shipment) => (
              <FbaShipmentCard
                key={shipment.id}
                shipment={shipment}
                onRefresh={fetchShipments}
              />
            ))}
          </AnimatePresence>
        </div>
      </DndContext>
    </div>
  );
}
