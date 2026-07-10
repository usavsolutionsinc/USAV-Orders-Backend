/**
 * Query-string parser for GET /api/receiving-lines (and its testing twin at
 * GET /api/testing/receiving-lines).
 *
 * Extracted VERBATIM from the route handler (roi-execution/03 #8) — every
 * coercion, default, and invalid-value fallback is byte-identical to the old
 * inline logic. Invalid values degrade exactly the way they did in the route
 * (silently ignored / defaulted / NaN-preserved) — parsing NEVER introduces a
 * new 400. Validity checks that gate SQL fragments (e.g. `QA_STATUSES.has`)
 * stay at SQL-build time in `./build-sql`, mirroring the original flow.
 */
import { z } from 'zod';
import {
  normalizeReceivingHistorySearchField,
  normalizeReceivingHistorySearchScope,
} from '@/lib/receiving-history-search';
import { parseReceivingView, RECEIVING_VIEWS } from '@/lib/receiving/receiving-views';

/**
 * Filter vocabularies shared by the GET filters (build-sql) and the POST/PATCH
 * body validation in the route. Moved here unchanged from the route module.
 */
export const QA_STATUSES  = new Set(['PENDING', 'PASSED', 'FAILED_DAMAGED', 'FAILED_INCOMPLETE', 'FAILED_FUNCTIONAL', 'HOLD']);
export const DISPOSITIONS = new Set(['ACCEPT', 'HOLD', 'RTV', 'SCRAP', 'REWORK']);
export const WORKFLOW_STATUSES = new Set([
  'EXPECTED', 'ARRIVED', 'MATCHED', 'UNBOXED', 'AWAITING_TEST',
  'IN_TEST', 'PASSED', 'FAILED', 'RTV', 'SCRAP', 'DONE',
]);

/**
 * Raw `Number(...)` results are preserved as-is (including `NaN` for absent /
 * malformed values) so downstream `Number.isFinite(x) && x > 0` gates behave
 * byte-identically to the old inline code. `z.number()` rejects NaN, hence the
 * union.
 */
const numberish = z.union([z.number(), z.nan()]);

export const receivingLinesQuerySchema = z.object({
  /** `?id=` — raw `Number(searchParams.get('id'))`; absent → 0, junk → NaN. */
  id: numberish,
  /** `?receiving_id=` — same raw-Number semantics as `id`. */
  receivingId: numberish,
  /** `?limit=` — `Math.min(Number(v || 200), 500)`; junk → NaN (preserved). */
  limit: numberish,
  /** `?offset=` — `Math.max(Number(v || 0), 0)`; junk → NaN (preserved). */
  offset: numberish,
  search: z.string(),
  searchField: z.enum(['all', 'po', 'tracking', 'sku', 'product', 'serial']),
  searchScope: z.enum(['all', 'zoho_po', 'unmatched']),
  /** Trimmed + uppercased; validity (QA_STATUSES.has) is checked at SQL build. */
  qaFilter: z.string(),
  dispFilter: z.string(),
  workflowFilter: z.string(),
  /** Raw trimmed strings; the ISO-date regex gate stays at SQL build. */
  weekStart: z.string(),
  weekEnd: z.string(),
  /** Trimmed + lowercased raw `?view=` (drives the surface-isolation guards). */
  viewRaw: z.string(),
  /** Parsed view — `null` = no/unknown view → week-range fallback. */
  view: z.enum(RECEIVING_VIEWS).nullable(),
  deliveryStateFilter: z.string(),
  /** ISO `YYYY-MM-DD` or `''` — malformed silently no-ops (bookmark-safe). */
  poFrom: z.string(),
  poTo: z.string(),
  sortRaw: z.string(),
  incomingSort: z.enum(['zoho_newest', 'zoho_oldest', 'expected_soonest', 'recently_added']),
  historySort: z.enum(['scanned_newest', 'scanned_oldest', 'unboxed_newest', 'received_newest', 'unbox_activity']),
  wantsPrioritySort: z.boolean(),
  /** `?zohoStatus=open` — the "Hide Zoho-received" toggle. */
  hideZohoReceived: z.boolean(),
  /** `?tester=` — raw Number; absent → 0, junk → NaN. */
  testerId: numberish,
  includeSerials: z.boolean(),
  /** Universal-Incoming facet params (trimmed + lowercased raw strings). */
  inboundSourceParam: z.string(),
  incomingLinkParam: z.string(),
  /** `?staff=` — raw trimmed string + its raw Number twin. */
  staffFilterRaw: z.string(),
  staffFilterId: numberish,
});

export type ReceivingLinesQuery = z.infer<typeof receivingLinesQuerySchema>;

/**
 * searchParams → typed {@link ReceivingLinesQuery}. Pure; never throws for any
 * URLSearchParams input (the schema is validated against the exact coercions
 * below, which always produce a conforming shape).
 */
export function parseReceivingLinesQuery(searchParams: URLSearchParams): ReceivingLinesQuery {
  const id          = Number(searchParams.get('id'));
  const receivingId = Number(searchParams.get('receiving_id'));
  const limit       = Math.min(Number(searchParams.get('limit') || 200), 500);
  const offset      = Math.max(Number(searchParams.get('offset') || 0), 0);
  const search      = String(searchParams.get('search') || '').trim();
  const searchField = normalizeReceivingHistorySearchField(searchParams.get('search_field'));
  const searchScope = normalizeReceivingHistorySearchScope(searchParams.get('search_scope'));
  const qaFilter    = String(searchParams.get('qa_status') || '').trim().toUpperCase();
  const dispFilter  = String(searchParams.get('disposition') || '').trim().toUpperCase();
  const workflowFilter = String(searchParams.get('workflow_status') || '').trim().toUpperCase();
  const weekStart = String(searchParams.get('week_start') || '').trim();
  const weekEnd   = String(searchParams.get('week_end') || '').trim();
  const viewRaw   = String(searchParams.get('view') || '').trim().toLowerCase();
  // Incoming-only: filters by the computed delivery_state bucket
  // (DELIVERED_UNOPENED, ARRIVING_TODAY, STALLED, IN_TRANSIT, AWAITING_TRACKING).
  // Mirrors the stat-tile click semantics on IncomingSidebarPanel.
  const deliveryStateFilter = String(searchParams.get('delivery_state') || '')
    .trim()
    .toUpperCase();
  // Incoming-only: optional PO purchase-date range. ISO YYYY-MM-DD;
  // anything malformed silently no-ops so bookmarks survive.
  const isISODate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const poFromRaw = String(searchParams.get('po_from') || '').trim();
  const poToRaw = String(searchParams.get('po_to') || '').trim();
  const poFrom = isISODate(poFromRaw) ? poFromRaw : '';
  const poTo = isISODate(poToRaw) ? poToRaw : '';
  // Incoming-only: sort axis. Defaults to most-recently-issued-in-Zoho.
  const sortRaw = String(searchParams.get('sort') || '').trim().toLowerCase();
  const incomingSort:
    | 'zoho_newest'
    | 'zoho_oldest'
    | 'expected_soonest'
    | 'recently_added' =
    sortRaw === 'zoho_oldest'
      ? 'zoho_oldest'
      : sortRaw === 'expected_soonest'
        ? 'expected_soonest'
        : sortRaw === 'recently_added'
          ? 'recently_added'
          : 'zoho_newest';
  // Sort axis for the receiving-history feed (view=recent/all/activity).
  // Lets the history UI sort by scanned-at (door), unboxed-at, or received-at
  // (the line's terminal DONE / "Received" transition — receiving_lines.
  // received_done_at, distinct from the misnamed door-scan receiving.received_at).
  // `unbox_activity` (the unbox Recent rail) = unboxed_at OR the line's own
  // last write (updated_at) — door re-scans bump neither, so triage scans
  // can't reorder the rail, while a return-paired/just-received line (no
  // unbox stamp yet) still surfaces by its line activity.
  const historySort:
    | 'scanned_newest'
    | 'scanned_oldest'
    | 'unboxed_newest'
    | 'received_newest'
    | 'unbox_activity' =
    sortRaw === 'scanned_oldest'
      ? 'scanned_oldest'
      : sortRaw === 'unboxed_newest'
        ? 'unboxed_newest'
        : sortRaw === 'received_newest'
          ? 'received_newest'
          : sortRaw === 'unbox_activity'
            ? 'unbox_activity'
            : 'scanned_newest';
  // Prioritize views (triage Prioritize tab + unbox Prioritize toggle) request
  // ?sort=priority — order by source-platform rank first, recency second.
  const wantsPrioritySort = sortRaw === 'priority';
  // Shared contract with the client (src/lib/receiving/receiving-views.ts) so
  // the supported view set can't drift between the two ends. `null` = no/
  // unknown view → fall back to week-range scoping.
  const view = parseReceivingView(viewRaw);
  // Phase 2 — physical-vs-financial decoupling: `?zohoStatus=open` (the "Hide
  // Zoho-received" toggle) re-applies the old hide-terminal filter.
  const hideZohoReceived =
    String(searchParams.get('zohoStatus') || '').trim().toLowerCase() === 'open';
  // view=testing only: scope the recently-tested feed to one staff member.
  const testerId = Number(searchParams.get('tester'));
  const include     = String(searchParams.get('include') || '').trim().toLowerCase();
  const includeSerials = include.split(',').map((s) => s.trim()).includes('serials');
  // Universal Incoming facets (flag-gated, plan §6).
  const inboundSourceParam = String(searchParams.get('inbound') || '').trim().toLowerCase();
  const incomingLinkParam = String(searchParams.get('link') || '').trim().toLowerCase();
  // Universal staff filter (P1-WORK-02): narrow the carton list to one staff —
  // who received, unboxed, or first-scanned it. Absent = ALL staff (default).
  const staffFilterRaw = String(searchParams.get('staff') || '').trim();
  const staffFilterId = Number(staffFilterRaw);

  return receivingLinesQuerySchema.parse({
    id,
    receivingId,
    limit,
    offset,
    search,
    searchField,
    searchScope,
    qaFilter,
    dispFilter,
    workflowFilter,
    weekStart,
    weekEnd,
    viewRaw,
    view,
    deliveryStateFilter,
    poFrom,
    poTo,
    sortRaw,
    incomingSort,
    historySort,
    wantsPrioritySort,
    hideZohoReceived,
    testerId,
    includeSerials,
    inboundSourceParam,
    incomingLinkParam,
    staffFilterRaw,
    staffFilterId,
  });
}
