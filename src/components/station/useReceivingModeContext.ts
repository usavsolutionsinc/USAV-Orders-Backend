'use client';

/**
 * Parses the receiving-lines table's URL state into the single `ReceivingModeContext`
 * bag the active mode descriptor consumes for every data-layer decision (which
 * API view to request, paging/keying/grouping/sorting, empty copy), plus the
 * presentational flags the component forks on. Extracted from ReceivingLinesTable;
 * behaviour is unchanged.
 */

import { useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import type { IncomingDeliveryState } from '@/components/sidebar/receiving/IncomingSidebarPanel';
import {
  getReceivingModeDescriptor,
  historySortGroupAxis,
  type ReceivingModeContext,
  type ReceivingModeDescriptor,
} from '@/lib/receiving/receiving-modes';
import {
  RECEIVING_HISTORY_URL_PARAMS,
  normalizeReceivingHistorySearchField,
  normalizeReceivingHistorySearchScope,
} from '@/lib/receiving-history-search';
import type { ReceivingActivityAxis } from '@/components/station/receiving-lines-table-helpers';
import { resolveLiveReceivingMode } from '@/lib/surface-isolation';

export interface ReceivingModeState {
  mode: ReceivingModeDescriptor;
  isIncomingMode: boolean;
  isHistoryMode: boolean;
  /** Lifecycle timestamp History day-bands + within-day order on (from `?sort=`). */
  historyAxis: ReceivingActivityAxis;
  /** 1-based Incoming page from `?page=` (>=1). */
  incomingPage: number;
  /** Incoming `DELIVERED_UNOPENED` sub-facet (shipment-level feed). */
  isDeliveredUnscannedFacet: boolean;
  /** Incoming `DELIVERED_NOT_UNBOXED` sub-facet (line-level dedicated feed). */
  isDeliveredNotUnboxedFacet: boolean;
  /** The descriptor opted this context out of the week filter. */
  skipWeekFilter: boolean;
  modeContext: ReceivingModeContext;
}

export function useReceivingModeContext(): ReceivingModeState {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Graduated surfaces (`/incoming`, `/receiving/history`, …) strip `?mode=`;
  // path owns the mode. Legacy `/receiving?mode=` still falls through.
  const pageMode = resolveLiveReceivingMode(pathname, searchParams);
  // The active mode descriptor owns every data-layer decision. Adding a mode =
  // adding a registry entry; the component just delegates. isIncomingMode
  // remains only for the presentational fork + the incoming-only effects.
  const mode = getReceivingModeDescriptor(pageMode);
  const isIncomingMode = mode.id === 'incoming';
  const isHistoryMode = mode.id === 'history';

  const historySearch = searchParams.get(RECEIVING_HISTORY_URL_PARAMS.q)?.trim() ?? '';
  const historySearchField = normalizeReceivingHistorySearchField(
    searchParams.get(RECEIVING_HISTORY_URL_PARAMS.field),
  );
  const historySearchScope = normalizeReceivingHistorySearchScope(
    searchParams.get(RECEIVING_HISTORY_URL_PARAMS.scope),
  );

  // Incoming-only URL params: shares `?q=` with history's search box (free
  // text), adds `?state=` for the delivery_state facet. Keeping `q` on the same
  // key means the search bar value survives a mode flip from Incoming → History.
  const incomingSearch = isIncomingMode
    ? (searchParams.get(RECEIVING_HISTORY_URL_PARAMS.q)?.trim() ?? '')
    : '';
  const incomingStateRaw = (searchParams.get('state') || '').trim().toUpperCase();
  const incomingState: IncomingDeliveryState | null =
    incomingStateRaw === 'DELIVERED_UNOPENED'
      || incomingStateRaw === 'DELIVERED_NOT_UNBOXED'
      || incomingStateRaw === 'DELIVERED_EMAIL'
      || incomingStateRaw === 'ARRIVING_TODAY'
      || incomingStateRaw === 'STALLED'
      || incomingStateRaw === 'IN_TRANSIT'
      || incomingStateRaw === 'TRACKING_UNAVAILABLE'
      || incomingStateRaw === 'PENDING_CARRIER'
      || incomingStateRaw === 'CARRIER_MISMATCH'
      || incomingStateRaw === 'AWAITING_TRACKING'
      || incomingStateRaw === 'WRONG_DESTINATION'
      ? (incomingStateRaw as IncomingDeliveryState)
      : null;
  // Sort axis + PO date range — driven by IncomingPaneHeader (sort) and
  // IncomingSidebarPanel (date range). All flow straight into the API query
  // string; no client-side filtering of the date range (server already narrows).
  const incomingSort = isIncomingMode ? (searchParams.get('sort') || '').trim() : '';
  // History reuses the shared `?sort=` param (modes are exclusive). The resolved
  // axis drives client day-banding + within-day order; the same sort is sent to
  // the API for the server ORDER BY window.
  const historySort = isHistoryMode ? (searchParams.get('sort') || '').trim() : '';
  const historyAxis: ReceivingActivityAxis = isHistoryMode
    ? historySortGroupAxis(historySort)
    : 'scanned';
  const incomingPoFrom = isIncomingMode ? (searchParams.get('po_from') || '').trim() : '';
  const incomingPoTo = isIncomingMode ? (searchParams.get('po_to') || '').trim() : '';
  // Pagination — server-side LIMIT 50 + page offset. Page numbers are 1-based in
  // the URL ("?page=2" = second page). Malformed/missing falls back to 1.
  const incomingPageRaw = isIncomingMode ? Number(searchParams.get('page') || '1') : 1;
  const incomingPage =
    Number.isFinite(incomingPageRaw) && incomingPageRaw >= 1 ? Math.floor(incomingPageRaw) : 1;

  // "Delivered · not scanned" is an Incoming sub-facet fed by a separate
  // shipment-level query; it owns its own empty copy, so the descriptor needs to
  // know about it. Derived early so it can flow into the mode context.
  const isDeliveredUnscannedFacet =
    isIncomingMode && incomingState === 'DELIVERED_UNOPENED';
  const isDeliveredNotUnboxedFacet =
    isIncomingMode && incomingState === 'DELIVERED_NOT_UNBOXED';

  // Single bag of parsed URL state handed to the active descriptor. Memoized so
  // the query key / params stay referentially stable across unrelated re-renders.
  const modeContext = useMemo<ReceivingModeContext>(
    () => ({
      historySearch,
      historySearchField,
      historySearchScope,
      historySort,
      incomingSearch,
      incomingState,
      incomingSort,
      incomingPoFrom,
      incomingPoTo,
      incomingPage,
      isDeliveredUnscannedFacet,
      isDeliveredNotUnboxedFacet,
    }),
    [
      historySearch,
      historySearchField,
      historySearchScope,
      historySort,
      incomingSearch,
      incomingState,
      incomingSort,
      incomingPoFrom,
      incomingPoTo,
      incomingPage,
      isDeliveredUnscannedFacet,
      isDeliveredNotUnboxedFacet,
    ],
  );

  const skipWeekFilter = mode.skipWeekFilter(modeContext);

  return {
    mode,
    isIncomingMode,
    isHistoryMode,
    historyAxis,
    incomingPage,
    isDeliveredUnscannedFacet,
    isDeliveredNotUnboxedFacet,
    skipWeekFilter,
    modeContext,
  };
}
