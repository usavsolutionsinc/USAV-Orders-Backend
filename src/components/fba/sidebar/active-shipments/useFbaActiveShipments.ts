'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fbaPaths } from '@/lib/fba/api-paths';
import {
  USAV_REFRESH_DATA,
  FBA_PRINT_SHIPPED,
  FBA_ACTIVE_SHIPMENTS_REFRESH,
  FBA_OPEN_SHIPMENT_EDITOR,
  FBA_SHIPMENT_EDITOR_ACTIVE,
} from '@/lib/fba/events';
import { useFbaEvent, useFbaEvents } from '@/components/fba/hooks/useFbaEvent';
import type { ActiveShipment } from '@/lib/fba/types';
import { parseShipment } from './active-shipments-shared';

/**
 * Owns the FBA active-shipments rail: fetching active + recently-shipped
 * shipments (transformed into bundle-aware {@link ActiveShipment}s, only those
 * with tracking + items), the open-shipment-editor event + editor-active
 * broadcast, the refresh-event subscription, expand toggling, and the
 * changed-broadcast. Returns a controller bag the thin shell renders from.
 */
export function useFbaActiveShipments() {
  const [shipments, setShipments] = useState<ActiveShipment[]>([]);
  const [recentShipped, setRecentShipped] = useState<ActiveShipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [editingShipment, setEditingShipment] = useState<ActiveShipment | null>(null);

  useFbaEvent<ActiveShipment>(FBA_OPEN_SHIPMENT_EDITOR, (shipment) => {
    setEditingShipment(shipment);
  });

  // Broadcast editing state so the sidebar can hide welcome/scan bar
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(FBA_SHIPMENT_EDITOR_ACTIVE, { detail: !!editingShipment }));
    return () => {
      window.dispatchEvent(new CustomEvent(FBA_SHIPMENT_EDITOR_ACTIVE, { detail: false }));
    };
  }, [editingShipment]);

  const toggleExpand = (id: number) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const fetchShipments = useCallback(async () => {
    try {
      const res = await fetch(fbaPaths.activeWithDetails(), { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed');

      const activeRaw: any[] = Array.isArray(data.active) ? data.active : [];
      const shippedRaw: any[] = Array.isArray(data.shipped) ? data.shipped : [];

      // Only show shipments that have tracking bundles with items
      const activeWithTracking = activeRaw
        .filter((s) => Array.isArray(s.tracking) && s.tracking.length > 0)
        .map((s) => parseShipment(s, false))
        .filter((s) => s.items.length > 0);
      setShipments(activeWithTracking);

      const shippedWithTracking = shippedRaw
        .filter((s) => Array.isArray(s.tracking) && s.tracking.length > 0)
        .map((s) => parseShipment(s, true))
        .filter((s) => s.items.length > 0);
      setRecentShipped(shippedWithTracking);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchShipments(); }, [fetchShipments]);

  const refreshEvents = useMemo(
    () => [USAV_REFRESH_DATA, FBA_PRINT_SHIPPED, FBA_ACTIVE_SHIPMENTS_REFRESH] as const,
    [],
  );
  useFbaEvents(refreshEvents, () => void fetchShipments());

  const emitChanged = () => {
    window.dispatchEvent(new CustomEvent(FBA_ACTIVE_SHIPMENTS_REFRESH));
    window.dispatchEvent(new CustomEvent(USAV_REFRESH_DATA));
  };

  return {
    shipments, recentShipped, loading,
    expandedIds, toggleExpand,
    editingShipment, setEditingShipment,
    emitChanged,
  };
}
