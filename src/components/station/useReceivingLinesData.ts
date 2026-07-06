'use client';

/**
 * Data layer for the receiving-lines table: the main list query + the
 * shipment-level "delivered · not scanned" feed, the local working copy
 * (`localRows`) that effects mutate, and the window-event bridges that keep it
 * fresh (refresh/entry-added invalidation, optimistic line updates, scan-match
 * prepends). Also drops a stale `?page` past the end of the Incoming result set.
 * Extracted from ReceivingLinesTable; behaviour is unchanged.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { receivingSurfaceBasePath } from '@/lib/receiving/surface-path';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { parseReceivingPrependedDetail } from '@/lib/queries/receiving-queries';
import { INCOMING_PAGE_SIZE, type ReceivingModeContext, type ReceivingModeDescriptor } from '@/lib/receiving/receiving-modes';
import type { ApiResponse } from '@/components/station/receiving-lines-table-helpers';
import {
  deliveredUnscannedToRow,
  type DeliveredUnscannedResponse,
} from '@/components/station/receiving-delivered-unscanned';
import { mergeReceivingPackageMetaIntoRow } from './receiving-lines-table-helpers';
import type { ReceivingLineRow } from './receiving-line-row';

interface UseReceivingLinesDataArgs {
  mode: ReceivingModeDescriptor;
  modeContext: ReceivingModeContext;
  isIncomingMode: boolean;
  isDeliveredUnscannedFacet: boolean;
  incomingPage: number;
  /** A scan-match prepend resets the week window so the new rows are visible. */
  setWeekOffset: React.Dispatch<React.SetStateAction<number>>;
  /** Scrolled to top after a prepend. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

export interface ReceivingLinesData {
  data: ApiResponse | undefined;
  isLoading: boolean;
  deliveredRows: ReceivingLineRow[];
  localRows: ReceivingLineRow[];
  setLocalRows: React.Dispatch<React.SetStateAction<ReceivingLineRow[]>>;
}

export function useReceivingLinesData({
  mode,
  modeContext,
  isIncomingMode,
  isDeliveredUnscannedFacet,
  incomingPage,
  setWeekOffset,
  scrollRef,
}: UseReceivingLinesDataArgs): ReceivingLinesData {
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [localRows, setLocalRows] = useState<ReceivingLineRow[]>([]);

  // Query key + params both come from the active descriptor. The key varies with
  // every server-affecting input so react-query refetches on a facet flip.
  const queryKey = mode.queryKey(modeContext);
  const { data, isLoading } = useQuery<ApiResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/receiving-lines?${mode.buildParams(modeContext).toString()}`);
      if (!res.ok) throw new Error('fetch failed');
      return res.json();
    },
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });

  // "Delivered · not scanned" facet: these boxes are shipment-anchored with no
  // PO line, so the list query above returns nothing for them. Pull the
  // shipment-level feed and remap each onto a ReceivingLineRow so they flow
  // through the same grouping + render path. Shares the
  // `incoming-delivered-unscanned` key so the sidebar's Refresh button refetches.
  const { data: deliveredData } = useQuery<DeliveredUnscannedResponse>({
    queryKey: ['incoming-delivered-unscanned'],
    queryFn: async () => {
      const res = await fetch('/api/receiving-lines/incoming/delivered-unscanned', {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('delivered-unscanned fetch failed');
      return res.json();
    },
    enabled: isDeliveredUnscannedFacet,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const deliveredRows = useMemo<ReceivingLineRow[]>(
    () =>
      isDeliveredUnscannedFacet
        ? (deliveredData?.items ?? []).map(deliveredUnscannedToRow)
        : [],
    [isDeliveredUnscannedFacet, deliveredData],
  );

  useEffect(() => {
    if (isDeliveredUnscannedFacet) {
      setLocalRows(deliveredRows);
      return;
    }
    if (data?.receiving_lines) setLocalRows(data.receiving_lines);
  }, [data, isDeliveredUnscannedFacet, deliveredRows]);

  // Incoming: if `?page` is past the end of the filtered result set, drop the
  // bad page param so the table re-fetches page 1 instead of stranding empty.
  useEffect(() => {
    if (!isIncomingMode) return;
    const total = Number(data?.total ?? 0);
    if (total === 0) return;
    const maxPage = Math.max(1, Math.ceil(total / INCOMING_PAGE_SIZE));
    if (incomingPage > maxPage) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete('page');
      router.replace(`${receivingSurfaceBasePath(pathname)}?${params.toString()}`);
    }
  }, [isIncomingMode, data?.total, incomingPage, router, searchParams, pathname]);

  // Refresh signals → invalidate the list query.
  useEffect(() => {
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['receiving-lines-table'] });
    };
    window.addEventListener('receiving-entry-added', handler);
    window.addEventListener('usav-refresh-data', handler);
    return () => {
      window.removeEventListener('receiving-entry-added', handler);
      window.removeEventListener('usav-refresh-data', handler);
    };
  }, [queryClient]);

  // Optimistic line update — shallow-merge so a partial payload (e.g.
  // mark-received returning the raw DB row without joined fields) doesn't blank
  // the existing tracking/PO/carrier columns.
  useEffect(() => {
    const handler = (event: Event) => {
      const updated = (event as CustomEvent<Partial<ReceivingLineRow>>).detail;
      if (!updated || typeof updated.id !== 'number') return;
      setLocalRows((rows) =>
        rows.map((row) => (row.id === updated.id ? { ...row, ...updated } as ReceivingLineRow : row)),
      );
    };
    window.addEventListener('receiving-line-updated', handler);
    return () => window.removeEventListener('receiving-line-updated', handler);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<Parameters<typeof mergeReceivingPackageMetaIntoRow>[1]>).detail;
      if (!detail || detail.receiving_id == null) return;
      setLocalRows((rows) =>
        rows.map((row) => mergeReceivingPackageMetaIntoRow(row, detail) ?? row),
      );
    };
    window.addEventListener('receiving-package-updated', handler);
    return () => window.removeEventListener('receiving-package-updated', handler);
  }, []);

  // Tracking scan/search match → prepend matched lines at the top (dedupe by id).
  // Receive flow and other tools dispatch this; History mode primarily uses
  // URL-driven API fetch.
  useEffect(() => {
    const handler = (event: Event) => {
      const parsed = parseReceivingPrependedDetail((event as CustomEvent<unknown>).detail);
      if (parsed.intakeSurface === 'unbox') return;
      const incoming = parsed.rows as ReceivingLineRow[];
      if (incoming.length === 0) return;
      const incomingIds = new Set(incoming.map((r) => r.id));
      setLocalRows((rows) => {
        const kept = rows.filter((r) => !incomingIds.has(r.id));
        return [...incoming, ...kept];
      });
      setWeekOffset(0);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      });
    };
    window.addEventListener('receiving-lines-prepended', handler);
    return () => window.removeEventListener('receiving-lines-prepended', handler);
  }, [setWeekOffset, scrollRef]);

  return { data, isLoading, deliveredRows, localRows, setLocalRows };
}
