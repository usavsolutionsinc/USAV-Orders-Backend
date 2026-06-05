import { useEffect, useState } from 'react';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import type { FlatTrackingRow } from '../types';

/**
 * Owns the per-row draft values for the inline tracking rows and the PATCH that
 * persists an edited non-primary tracking number to its shipment.
 */
export function useInlineTrackingDrafts(
  shipped: ShippedOrder,
  allTrackingRows: FlatTrackingRow[],
  onUpdate: (() => void) | undefined,
) {
  const [linkedTrackingDrafts, setLinkedTrackingDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    const next: Record<string, string> = {};
    allTrackingRows.forEach((row, index) => {
      const key = `${row.shipmentId ?? 'none'}:${index}`;
      next[key] = row.tracking;
    });
    setLinkedTrackingDrafts(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(allTrackingRows.map((row) => [row.shipmentId, row.tracking]))]);

  const saveLinkedTracking = async (shipmentId: number | null, nextTracking: string) => {
    const orderId = Number((shipped as any).id);
    if (!Number.isFinite(orderId) || orderId <= 0) return;
    if (!Number.isFinite(Number(shipmentId)) || Number(shipmentId) <= 0) return;
    const trimmed = String(nextTracking || '').trim();
    if (!trimmed) return;
    try {
      const res = await fetch(`/api/orders/${orderId}/tracking`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          edits: [
            {
              shipmentId: Number(shipmentId),
              trackingNumber: trimmed,
            },
          ],
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(String(payload?.details || payload?.error || 'Failed to update tracking'));
      }
      onUpdate?.();
    } catch (error: any) {
      console.error(error);
      throw new Error(error?.message || 'Failed to update tracking');
    }
  };

  return { linkedTrackingDrafts, setLinkedTrackingDrafts, saveLinkedTracking };
}
