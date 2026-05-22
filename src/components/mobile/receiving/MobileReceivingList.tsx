'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';
import { useRealtimeToasts } from '@/hooks/useRealtimeToasts';
import { MobileReceivingRow } from '@/components/mobile/receiving/MobileReceivingRow';
import { MobileCartonSheet } from '@/components/mobile/receiving/MobileCartonSheet';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

interface ApiResponse {
  success: boolean;
  receiving_lines: ReceivingLineRow[];
}

const LIMIT = 500;
const QUERY_KEY = ['receiving-lines-mobile'] as const;

/**
 * Mobile receiving surface — single scrollable list of receiving lines with
 * the most recent pinned at the bottom in an expanded card. Older rows are
 * compact tappable pills with a photo-count chip. Photo capture is the only
 * action; tapping a row opens MobileCartonSheet, the expanded card's camera
 * FAB jumps straight to the dedicated capture route.
 *
 * Realtime: piggybacks on the existing receiving-log invalidation channel for
 * data freshness, and listens on station:{staffId} `receiving_photo_request`
 * so a desktop tracking scan immediately surfaces the new carton at the bottom.
 */
export function MobileReceivingList() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const staffId = user?.staffId ?? 0;

  useRealtimeInvalidation({ receiving: true });
  useRealtimeToasts('receiving');

  const { data, isLoading } = useQuery<ApiResponse>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(LIMIT),
        offset: '0',
        view: 'all',
        include: 'serials',
      });
      const res = await fetch(`/api/receiving-lines?${params.toString()}`);
      if (!res.ok) throw new Error('fetch failed');
      return res.json();
    },
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });

  // ReceivingLinesTable invalidates ['receiving-lines-table', view]; our key
  // is separate, so the shared receiving-log channel above already refetches
  // through the global invalidation hook (queryKey: ['receiving-lines-mobile']
  // included by prefix). Belt-and-suspenders: re-fetch on the dedicated phone
  // photo-request event too, then scroll to bottom in the effect below.
  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  }, [queryClient]);

  useAblyChannel(
    staffId > 0 ? `station:${staffId}` : 'station:__idle__',
    'receiving_photo_request',
    refetch,
    staffId > 0,
  );

  // Reverse so newest is at the bottom. API returns newest-first (by zoho
  // last-modified, falling back to created_at — see receiving-lines route).
  // Limit to most recent 20 for mobile display.
  const reversedRows = useMemo(() => {
    const rows = data?.receiving_lines ?? [];
    return [...rows].slice(0, 20).reverse();
  }, [data]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastRowCountRef = useRef(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const count = reversedRows.length;
    if (count === 0) return;
    // Snap to the bottom on initial mount and whenever the list grows
    // (a new carton just arrived from a desktop scan).
    if (count !== lastRowCountRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: lastRowCountRef.current === 0 ? 'auto' : 'smooth' });
      lastRowCountRef.current = count;
    }
  }, [reversedRows.length]);

  const [sheetRow, setSheetRow] = useState<ReceivingLineRow | null>(null);
  const reduceMotion = useReducedMotion();

  const openSheet = useCallback((row: ReceivingLineRow) => setSheetRow(row), []);
  const closeSheet = useCallback(() => setSheetRow(null), []);

  const buildPhotosHref = useCallback(
    (row: ReceivingLineRow) =>
      row.receiving_id ? `/m/r/${row.receiving_id}/photos` : '#',
    [],
  );

  // Track row ids we've already seen so a freshly-landed row can pulse once.
  // Seeded on first non-empty render so the initial list doesn't all "ping".
  const seenIdsRef = useRef<Set<number> | null>(null);
  const [freshIds, setFreshIds] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    if (reversedRows.length === 0) return;
    if (seenIdsRef.current === null) {
      seenIdsRef.current = new Set(reversedRows.map((r) => r.id));
      return;
    }
    const seen = seenIdsRef.current;
    const newlyArrived: number[] = [];
    for (const row of reversedRows) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        newlyArrived.push(row.id);
      }
    }
    if (newlyArrived.length === 0) return;
    setFreshIds((prev) => {
      const next = new Set(prev);
      newlyArrived.forEach((id) => next.add(id));
      return next;
    });
    // Drop the "fresh" marker after the pulse plays out so the row settles.
    const t = setTimeout(() => {
      setFreshIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set(prev);
        newlyArrived.forEach((id) => next.delete(id));
        return next;
      });
    }, 2200);
    return () => clearTimeout(t);
  }, [reversedRows]);

  if (isLoading && reversedRows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-white text-[11px] font-black uppercase tracking-widest text-gray-400">
        Loading…
      </div>
    );
  }

  if (reversedRows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-white px-6 text-center">
        <p className="text-[13px] font-black uppercase tracking-[0.18em] text-gray-700">
          No packages yet
        </p>
        <p className="max-w-[260px] text-[11px] font-semibold text-gray-500">
          Scan a tracking number on the desktop to drop one in here.
        </p>
      </div>
    );
  }

  const expandedIndex = reversedRows.length - 1;

  return (
    <div className="flex h-full w-full flex-col bg-white">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <LayoutGroup>
          <AnimatePresence initial={false}>
            {reversedRows.map((row, i) => {
              const isExpanded = i === expandedIndex;
              const isFresh = freshIds.has(row.id);
              return (
                <motion.div
                  key={row.id}
                  layout={reduceMotion ? false : 'position'}
                  initial={
                    reduceMotion
                      ? false
                      : { opacity: 0, y: isExpanded ? 24 : 10, scale: isExpanded ? 0.98 : 1 }
                  }
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduceMotion ? undefined : { opacity: 0, height: 0, transition: { duration: 0.18 } }}
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { type: 'spring', damping: 28, stiffness: 340, mass: 0.55 }
                  }
                >
                  <MobileReceivingRow
                    row={row}
                    variant={isExpanded ? 'expanded' : 'collapsed'}
                    fresh={isFresh}
                    onTap={() => openSheet(row)}
                    photosHref={buildPhotosHref(row)}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </LayoutGroup>
      </div>

      <MobileCartonSheet
        row={sheetRow}
        staffId={staffId}
        open={sheetRow != null}
        onClose={closeSheet}
      />
    </div>
  );
}
