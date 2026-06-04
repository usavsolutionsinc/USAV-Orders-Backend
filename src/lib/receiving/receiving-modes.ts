/**
 * Receiving lines-table mode registry.
 *
 * The right-pane lines table renders three distinct display types — Receive,
 * History, and Incoming — that share one mounted component (so react-query
 * cache + scroll position survive a tab flip) but differ in nearly every
 * data-layer decision: which API `view` to request, how to page, how to key the
 * query, how to group/sort rows, whether to skip week scoping, and what the
 * empty state reads.
 *
 * Historically those decisions lived as ~40 scattered `isHistoryMode` /
 * `isIncomingMode` ternaries inside the component. A single wrong branch =
 * cross-contamination (e.g. History rendering Incoming rows). This registry
 * makes each mode a self-contained descriptor: the table looks up the active
 * descriptor and delegates, so adding a mode means adding one entry and the
 * compiler forces every field to be answered.
 *
 * Pure data + functions only — no JSX, no React. The presentational fork
 * (which header component, which row chips) is driven off the boolean flags
 * here but rendered by the component.
 */

import {
  RECEIVING_HISTORY_URL_PARAMS,
  type ReceivingHistorySearchField,
  type ReceivingHistorySearchScope,
} from '@/lib/receiving-history-search';
import type { ReceivingView } from '@/lib/receiving/receiving-views';

/** Server-side page size for the Incoming list (other modes use a long scroll). */
export const INCOMING_PAGE_SIZE = 25;

/** Long-scroll row cap shared by the non-paginated modes (Receive / History). */
export const RECEIVING_TABLE_LIMIT = 500;

/**
 * The display modes the lines table itself knows how to render. The sidebar's
 * full `ReceivingMode` union also has `pickup` and `unfound`, but those are
 * handled upstream (a route switch / a different right-pane component), never
 * by this table — so they're intentionally absent here.
 */
export type ReceivingTableMode = 'receive' | 'history' | 'incoming';

/**
 * Resolve the raw `?mode=` URL value to the table mode. Anything that isn't
 * `incoming` or `history` (including absent) is the default Receive workspace —
 * matching the prior `pageMode === 'history' ? … : 'receive'` fallback.
 */
export function resolveReceivingTableMode(raw: string | null | undefined): ReceivingTableMode {
  return raw === 'incoming' ? 'incoming' : raw === 'history' ? 'history' : 'receive';
}

/** Axis each mode groups its date headers on. */
export type ReceivingGroupAxis = 'activity' | 'po_date';

/**
 * Everything a descriptor needs from the URL, parsed by the component once and
 * handed to whichever descriptor is active. A flat bag (rather than per-mode
 * context types) keeps the call sites and the registry simple; each descriptor
 * reads only the fields relevant to it.
 */
export interface ReceivingModeContext {
  // History facets
  historySearch: string;
  historySearchField: ReceivingHistorySearchField;
  historySearchScope: ReceivingHistorySearchScope;
  // Incoming facets
  incomingSearch: string;
  incomingState: string | null;
  incomingSort: string;
  incomingPoFrom: string;
  incomingPoTo: string;
  incomingPage: number;
  /**
   * Incoming sub-facet: the shipment-anchored "delivered but not dock-scanned"
   * feed. It bypasses the normal list query, so it owns its own empty copy.
   */
  isDeliveredUnscannedFacet: boolean;
}

export interface ReceivingModeDescriptor {
  id: ReceivingTableMode;
  /** The `?view=` value this mode requests from `/api/receiving-lines`. */
  apiView: ReceivingView;
  /** Date-header grouping axis. */
  groupAxis: ReceivingGroupAxis;
  /**
   * When true the server's `ORDER BY` is authoritative and the client must NOT
   * re-sort within a date group (Incoming's Sort control drives the order).
   * When false the client re-sorts each group by activity recency.
   */
  serverSorted: boolean;
  /**
   * Incoming renders a purpose-built pane header (count + pagination) and drops
   * the carrier/serial chips + workflow label from rows (EXPECTED is implied).
   */
  isIncoming: boolean;
  /** Server page size, or `null` for the long-scroll modes. */
  pageSize: number | null;
  /** Build the `/api/receiving-lines` query string for this mode. */
  buildParams(ctx: ReceivingModeContext): URLSearchParams;
  /** React-query key — must vary with every server-affecting input. */
  queryKey(ctx: ReceivingModeContext): readonly unknown[];
  /**
   * Whether to bypass the client-side PST week slice. Searches/facets narrow
   * globally, so week scoping would hide otherwise-matching rows.
   */
  skipWeekFilter(ctx: ReceivingModeContext): boolean;
  /** Empty-state copy for the current context. */
  emptyMessage(ctx: ReceivingModeContext): string;
}

const QUERY_ROOT = 'receiving-lines-table';

const receiveMode: ReceivingModeDescriptor = {
  id: 'receive',
  // 'all' unions recent + received and keeps the untouched-incoming rows so the
  // Receive workspace's date grouping sees every row.
  apiView: 'all',
  groupAxis: 'activity',
  serverSorted: false,
  isIncoming: false,
  pageSize: null,
  buildParams() {
    const p = new URLSearchParams({
      limit: String(RECEIVING_TABLE_LIMIT),
      offset: '0',
    });
    p.set('include', 'serials');
    p.set('view', 'all');
    return p;
  },
  queryKey() {
    return [QUERY_ROOT, 'all', 'receive'] as const;
  },
  skipWeekFilter() {
    return false;
  },
  emptyMessage() {
    return 'No lines yet — start scanning to populate.';
  },
};

const historyMode: ReceivingModeDescriptor = {
  id: 'history',
  // 'activity' = 'all' minus untouched-incoming (EXPECTED, 0 received). History
  // is the log of what was actually scanned/unpacked; under 'all' the incoming
  // POs leak in. See receiving-views.ts.
  apiView: 'activity',
  groupAxis: 'activity',
  serverSorted: false,
  isIncoming: false,
  pageSize: null,
  buildParams(ctx) {
    const p = new URLSearchParams({
      limit: String(RECEIVING_TABLE_LIMIT),
      offset: '0',
    });
    p.set('include', 'serials');
    p.set('view', 'activity');
    if (ctx.historySearch) p.set('search', ctx.historySearch);
    p.set('search_field', ctx.historySearchField);
    p.set('search_scope', ctx.historySearchScope);
    return p;
  },
  queryKey(ctx) {
    return [
      QUERY_ROOT,
      'activity',
      'history',
      ctx.historySearch,
      ctx.historySearchField,
      ctx.historySearchScope,
    ] as const;
  },
  skipWeekFilter(ctx) {
    // Text or non-default source scope narrows globally — bypass week slicing
    // so matches stay visible regardless of when they were scanned.
    return ctx.historySearch.length > 0 || ctx.historySearchScope !== 'all';
  },
  emptyMessage(ctx) {
    return ctx.historySearch || ctx.historySearchScope !== 'all'
      ? 'No lines match — try different text or widen source (All).'
      : 'No lines yet — start scanning to populate.';
  },
};

const incomingMode: ReceivingModeDescriptor = {
  id: 'incoming',
  // Server filters to EXPECTED Zoho POs with zero received.
  apiView: 'incoming',
  groupAxis: 'po_date',
  serverSorted: true,
  isIncoming: true,
  pageSize: INCOMING_PAGE_SIZE,
  buildParams(ctx) {
    const limit = INCOMING_PAGE_SIZE;
    const offset = (ctx.incomingPage - 1) * INCOMING_PAGE_SIZE;
    const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    p.set('include', 'serials');
    p.set('view', 'incoming');
    // Incoming reuses the server's `search` / `search_field` machinery,
    // defaulting to PO# matching (mirrors Zoho's PO-list search UX).
    if (ctx.incomingSearch) {
      p.set('search', ctx.incomingSearch);
      p.set('search_field', 'po');
    }
    if (ctx.incomingState) p.set('delivery_state', ctx.incomingState);
    if (ctx.incomingSort) p.set('sort', ctx.incomingSort);
    if (ctx.incomingPoFrom) p.set('po_from', ctx.incomingPoFrom);
    if (ctx.incomingPoTo) p.set('po_to', ctx.incomingPoTo);
    return p;
  },
  queryKey(ctx) {
    return [
      QUERY_ROOT,
      'incoming',
      'incoming',
      ctx.incomingSearch,
      ctx.incomingState ?? '',
      ctx.incomingSort,
      ctx.incomingPoFrom,
      ctx.incomingPoTo,
      ctx.incomingPage,
    ] as const;
  },
  skipWeekFilter() {
    // Server already narrows to unreceived POs; a client week slice would hide
    // POs issued more than a week ago.
    return true;
  },
  emptyMessage(ctx) {
    return ctx.isDeliveredUnscannedFacet
      ? 'Nothing delivered-and-unscanned right now.'
      : 'No incoming POs — Zoho says everything issued is already received.';
  },
};

export const RECEIVING_MODES: Record<ReceivingTableMode, ReceivingModeDescriptor> = {
  receive: receiveMode,
  history: historyMode,
  incoming: incomingMode,
};

/** Convenience: resolve `?mode=` straight to its descriptor. */
export function getReceivingModeDescriptor(
  raw: string | null | undefined,
): ReceivingModeDescriptor {
  return RECEIVING_MODES[resolveReceivingTableMode(raw)];
}

/** Build the search-param key shared with the history free-text box. */
export const RECEIVING_SEARCH_PARAM_KEY = RECEIVING_HISTORY_URL_PARAMS.q;
