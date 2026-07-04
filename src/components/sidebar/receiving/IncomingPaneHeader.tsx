'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  PaneHeader,
  PaneHeaderTitle,
  PaneHeaderPagination,
} from '@/components/ui/pane-header';
import { INCOMING_PAGE_SIZE } from '@/lib/receiving/receiving-modes';

/** Sort axis — kept here so the sidebar (which now owns the control) can import the same union. */
export type IncomingSort =
  | 'zoho_newest'
  | 'zoho_oldest'
  | 'expected_soonest'
  | 'recently_added';

export const INCOMING_SORT_LABELS: Record<IncomingSort, string> = {
  zoho_newest:      'Newest in Zoho',
  zoho_oldest:      'Oldest in Zoho',
  expected_soonest: 'Expected soonest',
  recently_added:   'Recently synced',
};

/**
 * Server-side page size for Incoming. The single source of truth now lives in
 * the mode registry (so the table, the descriptor's pagination math, and this
 * header all agree); re-exported here for existing importers.
 */
export { INCOMING_PAGE_SIZE };

export interface IncomingPaneHeaderProps {
  /** Total matching rows across all pages (from `total` in API response). */
  total: number;
  /** Current 1-based page index. */
  page: number;
}

/**
 * Right-pane header for `mode=incoming`. Owns the pagination URL param
 * (`?page=`) — the table reads it and converts to `limit/offset`. Sort
 * lives in the sidebar (IncomingSidebarPanel); this header is now pure
 * "where am I in the list" navigation.
 *
 * Uses the same 40px {@link PaneHeader} shell as {@link WeekHeader}.
 */
export function IncomingPaneHeader({ total, page }: IncomingPaneHeaderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const totalPages = Math.max(1, Math.ceil(total / INCOMING_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const setPage = useCallback(
    (next: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next <= 1) params.delete('page');
      else params.set('page', String(next));
      router.replace(`/receiving?${params.toString()}`);
    },
    [router, searchParams],
  );

  return (
    <PaneHeader
      className="border-b-0"
      rowClassName="border-b border-border-default"
      leftSlot={<PaneHeaderTitle>Incoming POs</PaneHeaderTitle>}
      rightSlot={
        <PaneHeaderPagination
          page={safePage}
          pageSize={INCOMING_PAGE_SIZE}
          total={total}
          onPrev={() => setPage(safePage - 1)}
          onNext={() => setPage(safePage + 1)}
        />
      }
    />
  );
}
