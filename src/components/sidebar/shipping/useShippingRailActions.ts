'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { useQueryClient } from '@tanstack/react-query';
import type {
  UpNextPreviewPayload,
  UpNextActionStartPayload,
  UpNextActionOosPayload,
} from '@/utils/events';
import type { ActiveStationOrder } from '@/hooks/useStationTestingController';
import { shippingRailQueryKey } from './shipping-rail-shared';

/**
 * Selection mirror + Start / OOS handlers for the shipping recent rail.
 * Replaces the action wiring that used to live on {@link UpNextOrder}.
 */
export function useShippingRailActions({
  techId,
  onStart,
  onMissingParts,
  onAllCompleted,
  queueEmpty,
}: {
  techId: string;
  onStart: (tracking: string) => void;
  onMissingParts: () => void;
  onAllCompleted?: () => void;
  queueEmpty: boolean;
}) {
  const queryClient = useQueryClient();
  const hasCelebratedRef = useRef(false);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);

  const invalidateRail = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: shippingRailQueryKey('queue', techId) });
    void queryClient.invalidateQueries({ queryKey: shippingRailQueryKey('stock', techId) });
  }, [queryClient, techId]);

  useEffect(() => {
    const handlePreview = (e: Event) => {
      const detail = (e as CustomEvent<UpNextPreviewPayload>).detail;
      setSelectedOrderId(detail && detail.kind === 'order' ? detail.order.id : null);
    };
    const handleActive = (e: Event) => {
      const detail = (e as CustomEvent<{ activeOrder: ActiveStationOrder } | null>).detail;
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
    if (queueEmpty && !hasCelebratedRef.current) {
      confetti({ particleCount: 180, spread: 80, origin: { y: 0.7 } });
      hasCelebratedRef.current = true;
      onAllCompleted?.();
      return;
    }
    if (!queueEmpty) hasCelebratedRef.current = false;
  }, [queueEmpty, onAllCompleted]);

  const handleStart = useCallback(
    async (order: { id: number; shipping_tracking_number: string; order_id: string }) => {
      try {
        const res = await fetch('/api/orders/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: order.id, techId }),
        });
        if (res.ok) {
          onStart(order.shipping_tracking_number || order.order_id);
          invalidateRail();
        }
      } catch (error) {
        console.error('Error starting order:', error);
      }
    },
    [techId, onStart, invalidateRail],
  );

  const handleMissingParts = useCallback(
    async (orderId: number, reason: string) => {
      const trimmed = reason.trim();
      if (!trimmed) return;
      try {
        const res = await fetch('/api/orders/missing-parts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, reason: trimmed }),
        });
        if (res.ok) {
          onMissingParts();
          invalidateRail();
        }
      } catch (error) {
        console.error('Error marking missing parts:', error);
      }
    },
    [onMissingParts, invalidateRail],
  );

  useEffect(() => {
    const handleStartEvent = (e: Event) => {
      const detail = (e as CustomEvent<UpNextActionStartPayload>).detail;
      if (!detail) return;
      void handleStart({
        id: detail.orderId,
        shipping_tracking_number: detail.shipping_tracking_number,
        order_id: detail.order_id,
      });
    };
    const handleOosEvent = (e: Event) => {
      const detail = (e as CustomEvent<UpNextActionOosPayload>).detail;
      if (!detail) return;
      void handleMissingParts(detail.orderId, detail.reason);
    };
    window.addEventListener('tech-upnext-action-start', handleStartEvent);
    window.addEventListener('tech-upnext-action-oos-set', handleOosEvent);
    return () => {
      window.removeEventListener('tech-upnext-action-start', handleStartEvent);
      window.removeEventListener('tech-upnext-action-oos-set', handleOosEvent);
    };
  }, [handleStart, handleMissingParts]);

  return { selectedOrderId, invalidateRail };
}
