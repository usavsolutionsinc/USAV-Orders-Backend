'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ShippedOrder } from '@/lib/neon/orders-queries';
import { fetchDashboardOrderRowById } from '@/lib/dashboard-table-data';
import {
  patchDashboardSelectedOrderFromAssignment,
  resolveDashboardSelectedOrderCandidate,
  normalizeDashboardDetailsContext,
  parseDashboardOpenOrderId,
  type DashboardSelectionSnapshot,
} from '@/utils/dashboard-search-state';
import {
  dispatchCloseShippedDetails,
  dispatchOpenShippedDetails,
  getOpenShippedDetailsPayload,
  type ShippedDetailsContext,
} from '@/utils/events';

const SELECTED_ORDER_SNAPSHOT_KEY = 'dashboard:selected-order';

function readStoredSelection(orderId: number): DashboardSelectionSnapshot | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(SELECTED_ORDER_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardSelectionSnapshot;
    if (Number(parsed?.order?.id) !== orderId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredSelection(order: ShippedOrder, context: ShippedDetailsContext) {
  if (typeof window === 'undefined') return;

  try {
    const snapshot: DashboardSelectionSnapshot = {
      order,
      context,
      savedAt: Date.now(),
    };
    window.sessionStorage.setItem(SELECTED_ORDER_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // Best effort only.
  }
}

function clearStoredSelection() {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.removeItem(SELECTED_ORDER_SNAPSHOT_KEY);
  } catch {
    // Best effort only.
  }
}

export function useDashboardSelectedOrder(detailsEnabled: boolean) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [selectedShipped, setSelectedShipped] = useState<ShippedOrder | null>(null);
  const [selectedContext, setSelectedContext] = useState<ShippedDetailsContext>('queue');

  const openOrderId = useMemo(() => {
    return parseDashboardOpenOrderId(searchParams.get('openOrderId'));
  }, [searchParams]);

  const replaceOpenOrderId = useCallback((orderId: number | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (orderId && Number.isFinite(orderId) && orderId > 0) {
      params.set('openOrderId', String(orderId));
    } else {
      params.delete('openOrderId');
    }
    const nextSearch = params.toString();
    const nextPath = pathname || '/dashboard';
    router.replace(nextSearch ? `${nextPath}?${nextSearch}` : nextPath);
  }, [pathname, router, searchParams]);

  const applySelectedOrder = useCallback((order: ShippedOrder, context?: ShippedDetailsContext) => {
    const nextContext = normalizeDashboardDetailsContext(order, context);
    setSelectedShipped(order);
    setSelectedContext(nextContext);
    writeStoredSelection(order, nextContext);

    if (Number(order.id) !== openOrderId) {
      replaceOpenOrderId(Number(order.id));
    }
  }, [openOrderId, replaceOpenOrderId]);

  const clearSelectedOrder = useCallback((syncUrl = true) => {
    setSelectedShipped(null);
    clearStoredSelection();
    if (syncUrl && openOrderId != null) {
      replaceOpenOrderId(null);
    }
  }, [openOrderId, replaceOpenOrderId]);

  useEffect(() => {
    const handleOpen = (e: CustomEvent<ShippedOrder>) => {
      const payload = getOpenShippedDetailsPayload(e.detail);
      if (!payload?.order) return;
      applySelectedOrder(payload.order, payload.context);
    };
    const handleClose = () => clearSelectedOrder(false);
    const handleAssignmentUpdate = (e: any) => {
      const detail = e?.detail || {};
      const hasMatchingIds = Array.isArray(detail.orderIds) && detail.orderIds.some((id: any) => Number.isFinite(Number(id)));
      if (!hasMatchingIds) return;

      setSelectedShipped((current) => {
        const next = patchDashboardSelectedOrderFromAssignment(current, detail);
        if (!next || next === current) return current;
        writeStoredSelection(next, selectedContext);
        return next;
      });
    };

    window.addEventListener('open-shipped-details' as any, handleOpen as any);
    window.addEventListener('close-shipped-details' as any, handleClose as any);
    window.addEventListener('order-assignment-updated' as any, handleAssignmentUpdate as any);

    return () => {
      window.removeEventListener('open-shipped-details' as any, handleOpen as any);
      window.removeEventListener('close-shipped-details' as any, handleClose as any);
      window.removeEventListener('order-assignment-updated' as any, handleAssignmentUpdate as any);
    };
  }, [applySelectedOrder, clearSelectedOrder, selectedContext]);

  useEffect(() => {
    if (detailsEnabled) return;
    dispatchCloseShippedDetails();
    clearSelectedOrder();
  }, [clearSelectedOrder, detailsEnabled]);

  useEffect(() => {
    if (openOrderId == null) {
      if (selectedShipped) {
        clearSelectedOrder(false);
      }
      return;
    }

    if (Number(selectedShipped?.id) === openOrderId) return;

    let cancelled = false;

    const resolveSelectedOrder = async () => {
      const cachedQueryEntries = [
        ...queryClient.getQueriesData({ queryKey: ['dashboard-table'] }),
        ...queryClient.getQueriesData({ queryKey: ['dashboard-unified-search'] }),
      ];
      const stored = readStoredSelection(openOrderId);
      const localResolved = resolveDashboardSelectedOrderCandidate({
        openOrderId,
        cachedEntries: cachedQueryEntries,
        storedSelection: stored,
      });

      if (localResolved?.order) {
        if (!cancelled) {
          setSelectedShipped(localResolved.order);
          setSelectedContext(localResolved.context);
          writeStoredSelection(localResolved.order, localResolved.context);
          dispatchOpenShippedDetails(localResolved.order, localResolved.context);
        }
        return;
      }

      const fetched = await fetchDashboardOrderRowById(openOrderId);
      if (!fetched || cancelled) return;

      const context = normalizeDashboardDetailsContext(fetched);
      setSelectedShipped(fetched);
      setSelectedContext(context);
      writeStoredSelection(fetched, context);
      dispatchOpenShippedDetails(fetched, context);
    };

    void resolveSelectedOrder();

    return () => {
      cancelled = true;
    };
  }, [openOrderId, queryClient, selectedShipped]);

  const requestCloseSelectedOrder = useCallback(() => {
    dispatchCloseShippedDetails();
    clearSelectedOrder();
  }, [clearSelectedOrder]);

  return {
    selectedShipped,
    selectedContext,
    requestCloseSelectedOrder,
  };
}
