'use client';

import { useCallback, useState } from 'react';
import { useEventBridge } from '@/hooks';
import { dispatchCloseShippedDetails, dispatchOpenShippedDetails, getOpenShippedDetailsPayload } from '@/utils/events';
import { toDetailRecord, getDetailId } from '@/components/shipped/shipped-record-mappers';
import type { ShippedOrder } from '@/lib/neon/orders-queries';
import type { DerivedPackerRecord } from '@/lib/shipped-records';

export interface UseShippedDetailsSelectionOptions {
  /** Flat on-screen order, for up/down keyboard navigation. */
  orderedRecords: DerivedPackerRecord[];
}

export interface ShippedDetailsSelection {
  /** Detail id of the currently open row, or null. */
  selectedDetailId: number | null;
  /** Toggle the open detail for a row (re-click closes it). */
  handleRowClick: (record: DerivedPackerRecord) => void;
}

/**
 * Owns the open-detail selection for the shipped table. Tracks which row's
 * detail is open (by detail id), and wires the cross-pane window-event bridge
 * (`open` / `close` / `navigate` shipped-details) that the detail panel and
 * keyboard shortcuts drive — dispatching open/close back out for siblings.
 */
export function useShippedDetailsSelection({
  orderedRecords,
}: UseShippedDetailsSelectionOptions): ShippedDetailsSelection {
  const [selectedDetailId, setSelectedDetailId] = useState<number | null>(null);

  const handleRowClick = useCallback((record: DerivedPackerRecord) => {
    const detail = toDetailRecord(record);
    const detailId = getDetailId(record);
    if (selectedDetailId !== null && detailId === selectedDetailId) {
      dispatchCloseShippedDetails();
      return;
    }
    dispatchOpenShippedDetails(detail, 'shipped');
  }, [selectedDetailId]);

  // Handlers are held in a ref by useEventBridge, so they always read the
  // latest selectedDetailId / orderedRecords without re-subscribing.
  useEventBridge({
    'open-shipped-details': (e) => {
      const payload = getOpenShippedDetailsPayload((e as CustomEvent<ShippedOrder>).detail);
      const nextId = Number(payload?.order?.id);
      setSelectedDetailId(Number.isFinite(nextId) ? nextId : null);
    },
    'close-shipped-details': () => setSelectedDetailId(null),
    'navigate-shipped-details': (e) => {
      const direction = (e as CustomEvent<{ direction?: 'up' | 'down' }>).detail?.direction;
      if (selectedDetailId === null || orderedRecords.length === 0) return;
      const currentIndex = orderedRecords.findIndex((record) => getDetailId(record) === selectedDetailId);
      if (currentIndex < 0) return;
      const step = direction === 'up' ? -1 : 1;
      const nextRecord = orderedRecords[currentIndex + step];
      if (!nextRecord) return;
      dispatchOpenShippedDetails(toDetailRecord(nextRecord), 'shipped');
    },
  });

  return { selectedDetailId, handleRowClick };
}
