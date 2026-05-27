'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  PaneHeader,
  PaneHeaderTitle,
  PaneHeaderCount,
} from '@/components/ui/pane-header';
import { ChevronLeft, ChevronRight } from '@/components/Icons';

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

/** Server-side page size for Incoming. Single source of truth — referenced by the table + header. */
export const INCOMING_PAGE_SIZE = 25;

export interface IncomingPaneHeaderProps {
  /** Visible-row count on the current page (post-filter). */
  count: number;
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
 * Layout:
 *   ┌─ PaneHeader (sticky) ──────────────────────────────────────┐
 *   │  Incoming POs   <count>     1–25 of 546  [‹ Prev | Next ›] │
 *   └────────────────────────────────────────────────────────────┘
 */
export function IncomingPaneHeader({ count, total, page }: IncomingPaneHeaderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const totalPages = Math.max(1, Math.ceil(total / INCOMING_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  // Range label: "1–25" on first page; "26–50" on second; "501–546" on tail.
  const rangeStart = total === 0 ? 0 : (safePage - 1) * INCOMING_PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * INCOMING_PAGE_SIZE, total);

  const setPage = useCallback(
    (next: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next <= 1) params.delete('page');
      else params.set('page', String(next));
      router.replace(`/receiving?${params.toString()}`);
    },
    [router, searchParams],
  );

  const canPrev = safePage > 1;
  const canNext = safePage < totalPages;

  return (
    <PaneHeader
      leftSlot={
        <>
          <PaneHeaderTitle>Incoming POs</PaneHeaderTitle>
          <PaneHeaderCount count={count} />
        </>
      }
      rightSlot={
        <div className="flex items-center gap-3">
          <span className="tabular-nums text-eyebrow font-black uppercase tracking-wider text-gray-500">
            {total > 0 ? (
              <>
                {rangeStart}–{rangeEnd} <span className="text-gray-400">/</span>{' '}
                <span className="text-gray-700">{total.toLocaleString()}</span>
              </>
            ) : (
              '—'
            )}
          </span>
          <div className="flex items-center gap-0.5 rounded-md border border-gray-200 bg-white p-0.5">
            <button
              type="button"
              onClick={() => canPrev && setPage(safePage - 1)}
              disabled={!canPrev}
              aria-label="Previous page"
              title="Previous page"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="px-1 tabular-nums text-eyebrow font-black uppercase tracking-wider text-gray-700">
              {safePage}
              <span className="text-gray-400"> / {totalPages}</span>
            </span>
            <button
              type="button"
              onClick={() => canNext && setPage(safePage + 1)}
              disabled={!canNext}
              aria-label="Next page"
              title="Next page"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      }
    />
  );
}
