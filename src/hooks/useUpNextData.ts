'use client';

import { useEffect, useState } from 'react';
import type { Order, RepairQueueItem, FBAQueueItem, ReceivingQueueItem } from '@/components/station/upnext/upnext-types';

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

  const hasTrackingNumber = (order: Order) =>
    String(order.shipping_tracking_number || '').trim().length > 0;

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
    if (!techId) return;
    try {
      const res = await fetch(
        `/api/assignments?entity_type=RECEIVING&work_type=TEST&assigned_tech_id=${techId}&limit=50`
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
      const [currentRes, stockRes, repairRes] = await Promise.all([
        fetch(`/api/orders/next?techId=${techId}&all=true&outOfStock=false&assignedOnly=true`),
        fetch(`/api/orders/next?techId=${techId}&all=true&outOfStock=true&assignedOnly=false`),
        fetch(`/api/repair-service/next?techId=${techId}`),
      ]);

      if (currentRes.ok) {
        const currentData = await currentRes.json();
        const currentOrders = (currentData.orders || []).filter(
          (order: Order) => !order.is_shipped && hasTrackingNumber(order)
        );
        const stockData = stockRes.ok ? await stockRes.json() : { orders: [] };
        const stockOrders = (stockData.orders || []).filter(
          (order: Order) => !order.is_shipped && hasTrackingNumber(order)
        );
        const merged = [...currentOrders, ...stockOrders];
        const deduped = merged.filter((row: Order, idx: number, arr: Order[]) =>
          arr.findIndex((cand: Order) => Number(cand.id) === Number(row.id)) === idx
        );
        setAllOrders(deduped);
        setAllCompletedToday(currentData.all_completed || false);
        if (currentData.all_completed && onAllCompleted) onAllCompleted();
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

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [techId]);

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
