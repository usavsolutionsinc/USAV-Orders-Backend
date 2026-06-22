'use client';

import { useCallback, useState } from 'react';
import { emitAppEvent, useEventBridge } from '@/hooks';
import { dispatchCloseShippedDetails } from '@/utils/events';
import { isDetailsReopen, resolveDetailsNavigation } from '@/components/station/station-table-logic';

export interface UseStationDetailsSelectionOptions<T> {
  /** Flat on-screen order, for up/down keyboard navigation. */
  orderedRecords: T[];
  /** Map a record to the details-panel payload (`open-shipped-details` detail). */
  toDetailRecord: (record: T) => { id?: unknown } & Record<string, unknown>;
  /** Stable detail id for a record. */
  getDetailId: (record: T) => number;
}

export interface StationDetailsSelection<T> {
  /** Detail id of the currently open row, or null. */
  selectedDetailId: number | null;
  /** Toggle the open detail for a row (re-click closes it). */
  openDetails: (record: T) => void;
  /** Clear the local selection without dispatching a close event. */
  clearSelection: () => void;
}

/**
 * Shared open-detail selection + keyboard navigation for the station week
 * tables (Tech / Packer). Tracks which row's detail is open (by detail id) and
 * wires the cross-pane `open` / `close` / `navigate` shipped-details events:
 * the row dispatches `open-shipped-details` with the raw detail payload, and
 * this hook keeps `selectedDetailId` in sync from the same events.
 *
 * (Distinct from the dashboard shipped table's selection, which dispatches the
 * wrapped `{ order, context }` payload via `dispatchOpenShippedDetails`.)
 */
export function useStationDetailsSelection<T>({
  orderedRecords,
  toDetailRecord,
  getDetailId,
}: UseStationDetailsSelectionOptions<T>): StationDetailsSelection<T> {
  const [selectedDetailId, setSelectedDetailId] = useState<number | null>(null);

  const openDetails = useCallback(
    (record: T) => {
      const detail = toDetailRecord(record);
      const detailId = getDetailId(record);
      if (isDetailsReopen(selectedDetailId, detailId)) {
        dispatchCloseShippedDetails();
        setSelectedDetailId(null);
        return;
      }
      emitAppEvent('open-shipped-details', detail);
      setSelectedDetailId(detailId);
    },
    [selectedDetailId, toDetailRecord, getDetailId],
  );

  const clearSelection = useCallback(() => setSelectedDetailId(null), []);

  // Handlers are held in a ref by useEventBridge, so they always read the
  // latest selectedDetailId / orderedRecords without re-subscribing.
  useEventBridge({
    'open-shipped-details': (e) => {
      const nextId = Number((e as CustomEvent<{ id?: unknown }>).detail?.id);
      setSelectedDetailId(Number.isFinite(nextId) ? nextId : null);
    },
    'close-shipped-details': () => setSelectedDetailId(null),
    'navigate-shipped-details': (e) => {
      const direction = (e as CustomEvent<{ direction?: 'up' | 'down' }>).detail?.direction;
      const nextRecord = resolveDetailsNavigation(orderedRecords, selectedDetailId, direction, getDetailId);
      if (!nextRecord) return;
      emitAppEvent('open-shipped-details', toDetailRecord(nextRecord));
      setSelectedDetailId(getDetailId(nextRecord));
    },
  });

  return { selectedDetailId, openDetails, clearSelection };
}
