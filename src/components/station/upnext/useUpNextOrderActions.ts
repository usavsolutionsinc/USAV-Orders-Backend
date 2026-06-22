'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import type {
  UpNextPreviewPayload,
  UpNextActionStartPayload,
  UpNextActionOosPayload,
} from '@/utils/events';
import type { ActiveStationOrder } from '@/hooks/useStationTestingController';
import type { useUpNextController } from '@/hooks/station/useUpNextController';

type UpNextController = ReturnType<typeof useUpNextController>;

/**
 * Owns the component-local concerns that sit ON TOP of {@link useUpNextController}:
 * the selected-order mirror (preview/active-order window events), the
 * start-order + missing-parts mutations, the right-pane `UpNextActionDock`
 * action listeners, and the all-completed confetti. Returns the selection +
 * handlers the thin shell renders from.
 */
export function useUpNextOrderActions(
  ctrl: UpNextController,
  { techId, onStart, onMissingParts }: {
    techId: string;
    onStart: (tracking: string) => void;
    onMissingParts: (orderId: number, reason: string) => void;
  },
) {
  const { fetchOrders, setShowMissingPartsInput, setMissingPartsReason, effectiveTab, showNoCurrentOrdersBanner } = ctrl;

  const hasCelebratedRef = useRef(false);

  // ── Selected order — mirrors what's showing in the right pane workspace.
  // Set on preview-click, cleared when a scan resolves into an active order
  // (the active order itself is no longer in the Up Next list, so there's
  // nothing left to highlight in this surface).
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  useEffect(() => {
    const handlePreview = (e: Event) => {
      const detail = (e as CustomEvent<UpNextPreviewPayload>).detail;
      setSelectedOrderId(detail && detail.kind === 'order' ? detail.order.id : null);
    };
    const handleActive = (e: Event) => {
      const detail = (e as CustomEvent<{ activeOrder: ActiveStationOrder } | null>).detail;
      // Any active order takes priority; clear preview selection.
      if (detail) setSelectedOrderId(null);
    };
    window.addEventListener('tech-upnext-preview', handlePreview);
    window.addEventListener('tech-active-order-changed', handleActive);
    return () => {
      window.removeEventListener('tech-upnext-preview', handlePreview);
      window.removeEventListener('tech-active-order-changed', handleActive);
    };
  }, []);

  useEffect(() => {
    const isCompletionView = (effectiveTab === 'orders' || effectiveTab === 'all') && showNoCurrentOrdersBanner;
    if (isCompletionView && !hasCelebratedRef.current) {
      confetti({ particleCount: 180, spread: 80, origin: { y: 0.7 } });
      hasCelebratedRef.current = true;
      return;
    }
    if (!isCompletionView) hasCelebratedRef.current = false;
  }, [effectiveTab, showNoCurrentOrdersBanner]);

  const handleStart = useCallback(async (order: { id: number; shipping_tracking_number: string; order_id: string }) => {
    try {
      const res = await fetch('/api/orders/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, techId }),
      });
      if (res.ok) {
        onStart(order.shipping_tracking_number || order.order_id);
        fetchOrders();
      }
    } catch (error) {
      console.error('Error starting order:', error);
    }
  }, [techId, onStart, fetchOrders]);

  const handleMissingParts = useCallback(async (orderId: number, reason: string) => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    try {
      const res = await fetch('/api/orders/missing-parts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, reason: trimmed }),
      });
      if (res.ok) {
        onMissingParts(orderId, trimmed);
        setShowMissingPartsInput(null);
        setMissingPartsReason('');
        fetchOrders();
      }
    } catch (error) {
      console.error('Error marking missing parts:', error);
    }
  }, [onMissingParts, setShowMissingPartsInput, setMissingPartsReason, fetchOrders]);

  // ── Listen for action dispatches from the right-pane `UpNextActionDock`.
  // The dock is the only Start / OOS surface now (sidebar card is display-
  // only), so these listeners are how the workspace acts on the queue.
  useEffect(() => {
    const handleStartEvent = (e: Event) => {
      const detail = (e as CustomEvent<UpNextActionStartPayload>).detail;
      if (!detail) return;
      handleStart({
        id: detail.orderId,
        shipping_tracking_number: detail.shipping_tracking_number,
        order_id: detail.order_id,
      });
    };
    const handleOosEvent = (e: Event) => {
      const detail = (e as CustomEvent<UpNextActionOosPayload>).detail;
      if (!detail) return;
      handleMissingParts(detail.orderId, detail.reason);
    };
    window.addEventListener('tech-upnext-action-start', handleStartEvent);
    window.addEventListener('tech-upnext-action-oos-set', handleOosEvent);
    return () => {
      window.removeEventListener('tech-upnext-action-start', handleStartEvent);
      window.removeEventListener('tech-upnext-action-oos-set', handleOosEvent);
    };
  }, [handleStart, handleMissingParts]);

  return { selectedOrderId, handleStart, handleMissingParts };
}
