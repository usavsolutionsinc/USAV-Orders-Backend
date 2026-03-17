'use client';

import { useEffect, useRef, useState } from 'react';
import type { Order, RepairQueueItem, FBAQueueItem, ReceivingQueueItem } from '@/components/station/upnext/upnext-types';
import { fetchPendingOrdersData } from '@/lib/dashboard-table-data';
import { parsePositiveInt } from '@/utils/number';

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
      const [pendingOrders, repairRes] = await Promise.all([
        fetchPendingOrdersData({ testedBy: parsedTechId ?? undefined }),
        fetch(parsedTechId === null ? '/api/repair-service/next' : `/api/repair-service/next?techId=${parsedTechId}`),
      ]);

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

      if (repairRes.ok) {
        const repairData = await repairRes.json();
        setAllRepairs(Array.isArray(repairData.repairs) ? repairData.repairs : []);
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const refresh = () => {
    fetchOrders();
    fetchFbaShipments();
    fetchReceivingQueue();
  };

  // Keep a stable ref so event listeners always call the latest refresh without
  // needing to re-register on every render.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [techId]);

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
