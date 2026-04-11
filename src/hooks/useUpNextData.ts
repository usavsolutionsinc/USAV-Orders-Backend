'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Order, RepairQueueItem, FBAQueueItem, ReceivingQueueItem } from '@/components/station/upnext/upnext-types';
import { parsePositiveInt } from '@/utils/number';
import { getOrdersChannelName, getRepairsChannelName, getStationChannelName, getFbaChannelName } from '@/lib/realtime/channels';
import { useAblyChannel } from '@/hooks/useAblyChannel';

interface UseUpNextDataOptions {
  techId: string;
  onAllCompleted?: () => void;
}

export function useUpNextData({ techId, onAllCompleted }: UseUpNextDataOptions) {
  const [allOrders, setAllOrders]           = useState<Order[]>([]);
  const [allRepairs, setAllRepairs]         = useState<RepairQueueItem[]>([]);
  const [fbaItems, setFbaItems]             = useState<FBAQueueItem[]>([]);
  const [receivingItems, setReceivingItems] = useState<ReceivingQueueItem[]>([]);
  const [loading, setLoading]               = useState(true);
  const [allCompletedToday, setAllCompletedToday] = useState(false);
  const parsedTechId = parsePositiveInt(techId);

  const fetchFbaShipments = async () => {
    try {
      const res = await fetch('/api/fba/items/queue?limit=100');
      if (res.ok) {
        const data = await res.json();
        setFbaItems(Array.isArray(data?.items) ? data.items : []);
      }
    } catch (error) {
      console.error('Error fetching FBA queue:', error);
    }
  };

  const fetchReceivingQueue = async () => {
    if (parsedTechId === null) return;
    try {
      const res = await fetch(
        `/api/assignments?entity_type=RECEIVING&work_type=TEST&assigned_tech_id=${parsedTechId}&limit=50`
      );
      if (!res.ok) return;
      const data = await res.json();
      const assignments: any[] = Array.isArray(data?.assignments) ? data.assignments : [];

      const enriched = await Promise.all(
        assignments.map(async (a): Promise<ReceivingQueueItem> => {
          let trackingNumber: string | null = null;
          let carrier: string | null = null;
          let qaStatus: string | null = null;
          let workflowStatus: string | null = null;
          let lineCount = 0;
          let lineSkus: string[] = [];

          try {
            const matchRes = await fetch(`/api/receiving/match?receiving_id=${a.entity_id}`);
            if (matchRes.ok) {
              const matchData = await matchRes.json();
              if (matchData.receiving) {
                trackingNumber = matchData.receiving.receiving_tracking_number ?? null;
                carrier        = matchData.receiving.carrier ?? null;
                qaStatus       = matchData.receiving.qa_status ?? null;
                workflowStatus = matchData.receiving.workflow_status ?? null;
              }
              const lines: any[] = Array.isArray(matchData.matched_lines) ? matchData.matched_lines : [];
              lineCount = lines.length;
              lineSkus  = lines.map((l: any) => l.sku).filter(Boolean).slice(0, 3);
            }
          } catch {
            // non-critical
          }

          return {
            assignment_id:      Number(a.id),
            receiving_id:       Number(a.entity_id),
            assigned_tech_id:   a.assigned_tech_id ?? null,
            assigned_tech_name: a.assigned_tech_name ?? null,
            status:             a.status,
            priority:           a.priority,
            notes:              a.notes ?? null,
            assigned_at:        a.assigned_at ?? null,
            tracking_number:    trackingNumber,
            carrier,
            qa_status:          qaStatus,
            workflow_status:    workflowStatus,
            line_count:         lineCount,
            line_skus:          lineSkus,
          };
        })
      );
      setReceivingItems(enriched);
    } catch (error) {
      console.error('Error fetching receiving queue:', error);
    }
  };

  const fetchOrders = async () => {
    try {
      const repairRequest =
        parsedTechId === null
          ? Promise.resolve(null)
          : fetch(`/api/repair-service/next?techId=${parsedTechId}`);
      const ordersRequest =
        parsedTechId === null
          ? Promise.resolve(null)
          : fetch(`/api/orders/next?techId=${parsedTechId}&all=true&outOfStock=false`);

      const [ordersRes, repairRes] = await Promise.all([
        ordersRequest,
        repairRequest,
      ]);

      const ordersData = ordersRes?.ok ? await ordersRes.json() : null;
      const pendingOrders = Array.isArray(ordersData?.orders) ? ordersData.orders : [];

      const normalizedOrders: Order[] = pendingOrders.map((row: any) => ({
        id: Number(row.id),
        ship_by_date: row.ship_by_date ?? row.deadline_at ?? null,
        created_at: row.created_at ?? null,
        order_id: String(row.order_id || ''),
        product_title: String(row.product_title || ''),
        item_number: row.item_number ?? null,
        account_source: row.account_source ?? null,
        sku: String(row.sku || ''),
        condition: row.condition ?? null,
        quantity: row.quantity ?? null,
        status: String(row.status || ''),
        shipping_tracking_number: String(row.shipping_tracking_number || row.tracking_number || ''),
        out_of_stock: row.out_of_stock ?? null,
        tester_id: row.tester_id ?? null,
        tester_name: row.tester_name ?? null,
        has_tech_scan: Boolean(row.has_tech_scan),
        is_shipped: Boolean(row.is_shipped),
      }));

      const deduped = normalizedOrders.filter((row, idx, arr) =>
        arr.findIndex((cand) => Number(cand.id) === Number(row.id)) === idx
      );
      const currentOrders = deduped.filter((order: Order) => !String(order.out_of_stock || '').trim());
      const allCompleted = currentOrders.length === 0;

      setAllOrders(deduped);
      setAllCompletedToday(allCompleted);
      if (allCompleted && onAllCompleted) {
        onAllCompleted();
      }

      if (repairRes?.ok) {
        const repairData = await repairRes.json();
        setAllRepairs(Array.isArray(repairData.repairs) ? repairData.repairs : []);
      } else if (parsedTechId === null) {
        setAllRepairs([]);
      }

    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const refresh = () => {
    if (parsedTechId === null) return;
    fetchOrders();
    fetchFbaShipments();
    fetchReceivingQueue();
  };

  // Keep a stable ref so event listeners always call the latest refresh without
  // needing to re-register on every render.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // Debounced refresh to prevent rapid-fire when multiple Ably events arrive
  // within a short window (e.g. bulk assignment updates).
  const lastRefreshAtRef = useRef(0);
  const debouncedRefresh = useCallback(() => {
    const now = Date.now();
    if (now - lastRefreshAtRef.current < 2000) return;
    lastRefreshAtRef.current = now;
    refreshRef.current();
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 120000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [techId]);

  const ordersChannelName = getOrdersChannelName();
  const repairsChannelName = getRepairsChannelName();
  const stationChannelName = getStationChannelName();
  const fbaChannelName = getFbaChannelName();

  useAblyChannel(
    ordersChannelName,
    'order.assignments',
    (message: any) => {
      const d = message?.data;
      const orderId = Number(d?.orderId);
      if (!Number.isFinite(orderId)) return;

      setAllOrders((prev) => {
        let hit = false;
        const next = prev.map((o) => {
          if (Number(o.id) !== orderId) return o;
          hit = true;
          return {
            ...o,
            tester_id: d.testerId ?? null,
            tester_name: d.testerName ?? null,
            packer_id: d.packerId ?? null,
            packer_name: d.packerName ?? null,
            ship_by_date:
              d.deadlineAt != null && String(d.deadlineAt).trim() !== ''
                ? String(d.deadlineAt)
                : o.ship_by_date,
          };
        });
        return hit ? next : prev;
      });
    },
    true,
  );

  useAblyChannel(
    ordersChannelName,
    'queue.assignments',
    debouncedRefresh,
    true,
  );

  // Refresh when orders are created/updated/deleted (e.g. Google Sheets transfer,
  // shipping status changes, order adds/deletes).
  useAblyChannel(ordersChannelName, 'order.changed', debouncedRefresh, true);

  // Refresh when an order is tested (removes it from the tech queue).
  useAblyChannel(ordersChannelName, 'order.tested', debouncedRefresh, true);

  // Refresh when repairs change (new intake, status change, pickup).
  useAblyChannel(repairsChannelName, 'repair.changed', debouncedRefresh, true);

  // Refresh when receiving entries change (new scan, match, update).
  useAblyChannel(stationChannelName, 'receiving-log.changed', debouncedRefresh, true);

  // Refresh when FBA items change (scan, ready, shipped).
  useAblyChannel(fbaChannelName, 'fba.item.changed', debouncedRefresh, true);
  useAblyChannel(fbaChannelName, 'fba.shipment.changed', debouncedRefresh, true);
  useAblyChannel(fbaChannelName, 'fba.catalog.changed', debouncedRefresh, true);

  // Mirror the real-time update strategy from PendingOrdersTable: respond to
  // broadcast refresh events so data stays in sync without waiting for the poll.
  useEffect(() => {
    const handleRefresh = () => refreshRef.current();
    window.addEventListener('usav-refresh-data', handleRefresh);
    window.addEventListener('dashboard-refresh', handleRefresh);
    return () => {
      window.removeEventListener('usav-refresh-data', handleRefresh);
      window.removeEventListener('dashboard-refresh', handleRefresh);
    };
  }, []);

  return {
    allOrders,
    allRepairs,
    fbaItems,
    receivingItems,
    loading,
    allCompletedToday,
    refresh,
    fetchOrders,
  };
}
