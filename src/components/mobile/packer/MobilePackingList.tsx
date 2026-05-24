'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';
import { useRealtimeToasts } from '@/hooks/useRealtimeToasts';
import { MobilePackingRow } from '@/components/mobile/packer/MobilePackingRow';
import { MobilePackingSheet } from '@/components/mobile/packer/MobilePackingSheet';
import type { PackerLogRow } from '@/components/mobile/packer/types';

const LIMIT = 100;
const QUERY_KEY = ['packer-logs-mobile'] as const;

/**
 * Mobile packer surface — mirror of MobileReceivingList. Single scrollable
 * list of recent packed logs, most-recent pinned at the bottom in an expanded
 * card. Older rows are compact tappable pills with a photo-count chip. Tap
 * opens MobilePackingSheet, the expanded card's camera chip jumps straight
 * to /m/p/{packerLogId}/photos.
 */
export function MobilePackingList({ packerId }: { packerId: string }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const staffId = user?.staffId ?? 0;

  useRealtimeInvalidation({});
  useRealtimeToasts('packer');

  const { data, isLoading } = useQuery<PackerLogRow[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const params = new URLSearchParams({
        packerId: String(packerId),
        limit: String(LIMIT),
        offset: '0',
      });
      const res = await fetch(`/api/packerlogs?${params.toString()}`);
      if (!res.ok) throw new Error('fetch failed');
      const json = await res.json();
      return Array.isArray(json) ? json : [];
    },
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  }, [queryClient]);

  useEffect(() => {
    const handler = () => refetch();
    window.addEventListener('packer-log-updated', handler);
    window.addEventListener('usav-refresh-data', handler);
    return () => {
      window.removeEventListener('packer-log-updated', handler);
      window.removeEventListener('usav-refresh-data', handler);
    };
  }, [refetch]);

  // Newest at the bottom; cap to 20 to match the mobile receiving surface.
  const reversedRows = useMemo(() => {
    const rows = data ?? [];
    return [...rows].slice(0, 20).reverse();
  }, [data]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastRowCountRef = useRef(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const count = reversedRows.length;
    if (count === 0) return;
    if (count !== lastRowCountRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: lastRowCountRef.current === 0 ? 'auto' : 'smooth' });
      lastRowCountRef.current = count;
    }
  }, [reversedRows.length]);

  const [sheetRow, setSheetRow] = useState<PackerLogRow | null>(null);
  const reduceMotion = useReducedMotion();

  const openSheet = useCallback((row: PackerLogRow) => setSheetRow(row), []);
  const closeSheet = useCallback(() => setSheetRow(null), []);

  const buildPhotosHref = useCallback(
    (row: PackerLogRow) =>
      row.packer_log_id ? `/m/p/${row.packer_log_id}/photos` : '#',
    [],
  );

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

  void staffId;

  if (isLoading && reversedRows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-white text-caption font-black uppercase tracking-widest text-gray-400">
        Loading…
      </div>
    );
  }

  if (reversedRows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-white px-6 text-center">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-gray-700">
          No pack history yet
        </p>
        <p className="max-w-[260px] text-caption font-semibold text-gray-500">
          Pack something at a desktop station — recent entries will land here.
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
                  <MobilePackingRow
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

      <MobilePackingSheet
        row={sheetRow}
        open={sheetRow != null}
        onClose={closeSheet}
      />
    </div>
  );
}
