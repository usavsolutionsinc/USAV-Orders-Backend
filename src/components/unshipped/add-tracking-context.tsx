'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/** One entry in the popover's session "recently added" log. */
export interface RecentlyAddedEntry {
  orderId: number;
  title: string;
  tracking: string;
}

interface AddTrackingNav {
  /** The order id whose popover is currently open (single-open across the worklist). */
  openOrderId: number | null;
  open: (orderId: number) => void;
  close: () => void;
  /** Move the open popover to the prev/next order that still needs tracking. */
  prev: (orderId: number) => void;
  next: (orderId: number) => void;
  hasPrev: (orderId: number) => boolean;
  hasNext: (orderId: number) => boolean;
  /** 1-based position + total in the needs-tracking worklist (for "3 / 12"). */
  positionOf: (orderId: number) => { index: number; total: number };
  recentlyAdded: RecentlyAddedEntry[];
  pushRecentlyAdded: (entry: RecentlyAddedEntry) => void;
}

const AddTrackingNavContext = createContext<AddTrackingNav | null>(null);

export function useAddTrackingNav(): AddTrackingNav | null {
  return useContext(AddTrackingNavContext);
}

/**
 * Coordinates the single-open add-tracking popover across the Unshipped worklist:
 * prev/next walk the ordered list of orders that still need tracking, and a
 * session-local "recently added" log shows throughput as the operator sweeps.
 * `orderedIds` should be the awaiting (no-tracking) order ids in display order.
 */
export function AddTrackingNavProvider({
  orderedIds,
  children,
}: {
  orderedIds: number[];
  children: React.ReactNode;
}) {
  const [openOrderId, setOpenOrderId] = useState<number | null>(null);
  const [recentlyAdded, setRecentlyAdded] = useState<RecentlyAddedEntry[]>([]);

  const open = useCallback((orderId: number) => setOpenOrderId(orderId), []);
  const close = useCallback(() => setOpenOrderId(null), []);
  const prev = useCallback(
    (orderId: number) => {
      const i = orderedIds.indexOf(orderId);
      if (i > 0) setOpenOrderId(orderedIds[i - 1]);
    },
    [orderedIds],
  );
  const next = useCallback(
    (orderId: number) => {
      const i = orderedIds.indexOf(orderId);
      if (i >= 0 && i < orderedIds.length - 1) setOpenOrderId(orderedIds[i + 1]);
      else setOpenOrderId(null); // end of the worklist → close
    },
    [orderedIds],
  );
  const hasPrev = useCallback((orderId: number) => orderedIds.indexOf(orderId) > 0, [orderedIds]);
  const hasNext = useCallback(
    (orderId: number) => {
      const i = orderedIds.indexOf(orderId);
      return i >= 0 && i < orderedIds.length - 1;
    },
    [orderedIds],
  );
  const positionOf = useCallback(
    (orderId: number) => ({ index: orderedIds.indexOf(orderId) + 1, total: orderedIds.length }),
    [orderedIds],
  );
  const pushRecentlyAdded = useCallback((entry: RecentlyAddedEntry) => {
    setRecentlyAdded((prevList) => [entry, ...prevList.filter((e) => e.orderId !== entry.orderId)].slice(0, 8));
  }, []);

  const value = useMemo<AddTrackingNav>(
    () => ({ openOrderId, open, close, prev, next, hasPrev, hasNext, positionOf, recentlyAdded, pushRecentlyAdded }),
    [openOrderId, open, close, prev, next, hasPrev, hasNext, positionOf, recentlyAdded, pushRecentlyAdded],
  );

  return <AddTrackingNavContext.Provider value={value}>{children}</AddTrackingNavContext.Provider>;
}
