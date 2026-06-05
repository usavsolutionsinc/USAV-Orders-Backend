'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';
import { useAblyChannel } from '@/hooks/useAblyChannel';

/**
 * Shared mobile-feed behaviors, factored out of the two hand-rolled lists
 * (MobileReceivingList / MobilePackingList) so every mobile display — Recent,
 * Receiving, Scan, Receive, Packing, Picks — gets the same windowing,
 * bottom-anchored auto-scroll, and fresh-row pulse for free.
 *
 * Two layers:
 *   - useFeedWindow(rows)      → pure view: window to last N, order, scroll, pulse.
 *   - useMobileFeedQuery(opts) → TanStack Query + realtime wiring (data feeds).
 *
 * Scan/Receive feed local component state straight into useFeedWindow; the
 * other four pull through useMobileFeedQuery first.
 */

type FeedId = string | number;

export interface FeedWindowOptions<T> {
  /** Keep only the most recent N rows (default 8 — fits one phone screen). 0/null = all. */
  limit?: number | null;
  /**
   * 'bottom' (default): newest pinned to the bottom by the nav bar, list
   * auto-scrolls down on mount + when a new row lands (receiving/packing/recent).
   * 'top': newest first, no auto-scroll (scan/receive results, pick queue).
   */
  anchor?: 'top' | 'bottom';
  /** Stable id accessor — defaults to `row.id`. Pick queue passes orderId. */
  getId?: (row: T) => FeedId;
  /** Track newly-arrived rows so they can pulse once (default true). */
  freshPulse?: boolean;
}

export interface FeedWindow<T> {
  /** The windowed + ordered rows ready to render. */
  rows: T[];
  /** Attach to the scroll container; drives the bottom-anchored auto-scroll. */
  scrollRef: React.RefObject<HTMLDivElement>;
  /** Ids that arrived since the last render — render a one-shot pulse for these. */
  freshIds: Set<FeedId>;
}

const defaultGetId = <T,>(row: T): FeedId => (row as { id: FeedId }).id;

/**
 * View-layer feed behaviors. Source rows are expected newest-first (the order
 * every list endpoint and the scan prepend already produce).
 */
export function useFeedWindow<T>(
  source: ReadonlyArray<T> | null | undefined,
  options: FeedWindowOptions<T> = {},
): FeedWindow<T> {
  const { limit = 8, anchor = 'bottom', getId = defaultGetId, freshPulse = true } = options;

  const rows = useMemo(() => {
    const all = source ? [...source] : [];
    const capped = limit && limit > 0 ? all.slice(0, limit) : all;
    // Bottom-anchored feeds read oldest→newest so the newest sits at the bottom.
    return anchor === 'bottom' ? capped.reverse() : capped;
  }, [source, limit, anchor]);

  // ── Bottom-anchored auto-scroll ────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastCountRef = useRef(0);
  useEffect(() => {
    if (anchor !== 'bottom') return;
    const el = scrollRef.current;
    if (!el) return;
    const count = rows.length;
    if (count === 0) return;
    if (count !== lastCountRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: lastCountRef.current === 0 ? 'auto' : 'smooth' });
      lastCountRef.current = count;
    }
  }, [rows.length, anchor]);

  // ── Fresh-row pulse ─────────────────────────────────────────────────────────
  const seenIdsRef = useRef<Set<FeedId> | null>(null);
  const [freshIds, setFreshIds] = useState<Set<FeedId>>(() => new Set());
  useEffect(() => {
    if (!freshPulse || rows.length === 0) return;
    // Seed on first non-empty render so the initial list doesn't all "ping".
    if (seenIdsRef.current === null) {
      seenIdsRef.current = new Set(rows.map(getId));
      return;
    }
    const seen = seenIdsRef.current;
    const newlyArrived: FeedId[] = [];
    for (const row of rows) {
      const id = getId(row);
      if (!seen.has(id)) {
        seen.add(id);
        newlyArrived.push(id);
      }
    }
    if (newlyArrived.length === 0) return;
    setFreshIds((prev) => {
      const next = new Set(prev);
      newlyArrived.forEach((id) => next.add(id));
      return next;
    });
    const t = setTimeout(() => {
      setFreshIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set(prev);
        newlyArrived.forEach((id) => next.delete(id));
        return next;
      });
    }, 2200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  return { rows, scrollRef, freshIds };
}

export interface MobileFeedQueryOptions<T> {
  queryKey: readonly unknown[];
  queryFn: () => Promise<T[]>;
  /** ms before a cached result is considered stale (default 20s — snappy tab switches). */
  staleTime?: number;
  enabled?: boolean;
  realtime?: {
    /** Forwarded to useRealtimeInvalidation, e.g. { receiving: true }. */
    invalidation?: Parameters<typeof useRealtimeInvalidation>[0];
    /** Ably channel/event whose arrival should refetch this feed. */
    ably?: { channel: string; event: string; enabled?: boolean };
    /** window CustomEvent names that should refetch (e.g. 'usav-refresh-data'). */
    windowEvents?: ReadonlyArray<string>;
  };
}

export interface MobileFeedQuery<T> {
  data: T[];
  isLoading: boolean;
  refetch: () => void;
}

/**
 * Query-backed feed source: TanStack Query (cached, so back-navigation is
 * instant) plus the realtime fan-in each feed needs. Returns a plain array.
 */
export function useMobileFeedQuery<T>(opts: MobileFeedQueryOptions<T>): MobileFeedQuery<T> {
  const { queryKey, queryFn, staleTime = 20_000, enabled = true, realtime } = opts;
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<T[]>({
    queryKey,
    queryFn,
    staleTime,
    enabled,
    refetchOnWindowFocus: true,
  });

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  // Realtime invalidation (no-op when no options passed).
  useRealtimeInvalidation(realtime?.invalidation ?? {});

  // Ably push → refetch (idle channel + disabled when not configured).
  useAblyChannel(
    realtime?.ably?.channel ?? 'feed:__idle__',
    realtime?.ably?.event ?? '__noop__',
    refetch,
    Boolean(realtime?.ably && (realtime.ably.enabled ?? true)),
  );

  // window CustomEvent → refetch.
  useEffect(() => {
    const events = realtime?.windowEvents;
    if (!events || events.length === 0) return;
    const handler = () => refetch();
    events.forEach((name) => window.addEventListener(name, handler));
    return () => events.forEach((name) => window.removeEventListener(name, handler));
  }, [realtime?.windowEvents, refetch]);

  return { data: data ?? [], isLoading, refetch };
}
