/**
 * Receiving sidebar-rail feed descriptors + fetchers — the declarative SoT for
 * every rail on the receiving page. Each rail wrapper was re-deriving the same
 * four things by hand (a `/api/receiving-lines` fetch, a query key, a quantity
 * strategy, and status/event wiring); this module pulls the data half into one
 * place so a rail is now a descriptor entry, not a bespoke component.
 *
 * Six feeds, all consumed through `ReceivingFeedRail`:
 *   - unboxRecent  → Received      (unboxed ∪ new-scanned ∪ unfound, newest-received)
 *   - scanned      → Queue/Prioritize (view=scanned, sort=priority, no unmatched)
 *   - viewed       → Viewed        (view=viewed, per-staff recents)
 *   - triageCombined → Triage      (scanned ∪ unfound, recency-sorted)
 *   - triageUnfound  → Unfound     (unfound-queue stubs)
 *
 * Stable identity matters: `refreshEvents` arrays and the `getActivityAt` fns are
 * module-scope so the rail shell's listener effects subscribe once (a fresh
 * array/arrow each render risked a dropped optimistic event mid-swap).
 *
 * Scope: the receiving page only. Testing + the mobile scan feeds keep their own
 * fetchers.
 */

import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import type { ApiResponse } from '@/components/sidebar/receiving/RecentActivityRailBase';
import { getReceivedActivityAt, getViewedAt, type RailStatusId } from './status';
import type { RailQtyId } from './quantity';
import {
  toStubRow,
  matchesQuery as matchesUnfoundQueue,
  type UnfoundQueueRow,
} from './unfound-stub';
import { RECEIVING_TABLE_LIMIT } from '@/lib/receiving/receiving-modes';

export type ReceivingLinesView = 'activity' | 'scanned' | 'viewed' | 'unbox_opened';
export type ReceivingLinesSort = 'unboxed_newest' | 'priority';

/** Runtime inputs the rail supplies to a fetcher (URL-derived). */
export interface RailFetchRuntime {
  /** `?staff=` filter, when the feed is staff-scoped. */
  staffId?: number | null;
  /** Already trimmed + lowercased search text; '' = no filter. */
  query?: string;
}

/** Narrow spec the standard `/api/receiving-lines` fetcher reads. */
interface ReceivingLinesQuery {
  segment: string;
  view: ReceivingLinesView;
  sort?: ReceivingLinesSort;
  /** Client-side post-filter (e.g. drop unmatched). */
  postFilter?: (r: ReceivingLineRow) => boolean;
}

/** A declarative rail feed. `buildFetcher` (multi-source) takes precedence over `view`. */
export interface ReceivingRailFeed {
  /** Cache segment → ['receiving-lines-table','rail',segment,…]. */
  segment: string;
  eyebrowTitle: string;
  qty: RailQtyId;
  status: RailStatusId;
  /** Module-scope array — stable identity for the shell's refresh listener. */
  refreshEvents: string[];
  autoSelectFirstWhenEmpty?: boolean;
  /** false ONLY for the unbox Recent feed (strict unboxed_at order, no pin bounce). */
  pinSelectedLead?: boolean;
  /** Whether the feed reads the `?staff=` param. */
  usesStaffFilter?: boolean;
  limit?: number;
  /** Row time-label axis — MUST match `sort`. Omit to use the shell default. */
  getActivityAt?: (r: ReceivingLineRow) => string | null | undefined;
  // Standard receiving-lines fetch:
  view?: ReceivingLinesView;
  sort?: ReceivingLinesSort;
  postFilter?: (r: ReceivingLineRow) => boolean;
  // OR a custom multi-source fetch (combined / unfound-queue):
  buildFetcher?: (rt: RailFetchRuntime) => () => Promise<ApiResponse>;
}

const TRIAGE_REFRESH: string[] = [
  'receiving-triage-refresh',
  'receiving-entry-added',
  'receiving-entry-deleted',
  'usav-refresh-data',
];

const UNBOX_REFRESH: string[] = [
  'receiving-unbox-refresh',
  'receiving-entry-deleted',
  'usav-refresh-data',
];

const notUnmatched = (r: ReceivingLineRow) => r.receiving_source !== 'unmatched';

/** Search match for a real receiving line (tracking / sku / item / PO). */
export function matchesReceivingLine(row: ReceivingLineRow, q: string): boolean {
  if (!q) return true;
  const hay = [
    row.tracking_number,
    row.sku,
    row.item_name,
    row.zoho_purchaseorder_number,
    row.zoho_purchaseorder_id,
  ].map((x) => (x || '').toLowerCase());
  return hay.some((h) => h.includes(q));
}

/** Best-available recency for the combined sort (newest scanned first). */
function recencyMs(row: ReceivingLineRow): number {
  for (const c of [row.received_at, row.last_activity_at, row.scanned_at, row.created_at]) {
    if (!c) continue;
    const t = Date.parse(c);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

/** Standard `/api/receiving-lines` fetch (view + sort + staff + post/query filter). */
export async function fetchReceivingLines(
  spec: ReceivingLinesQuery,
  rt: RailFetchRuntime,
  opts?: { limit?: number; includeSerials?: boolean },
): Promise<ApiResponse> {
  const limit = opts?.limit ?? 50;
  const includeSerials = opts?.includeSerials ?? false;
  const params = new URLSearchParams({ limit: String(limit), offset: '0' });
  if (includeSerials) params.set('include', 'serials');
  params.set('view', spec.view);
  if (spec.sort) params.set('sort', spec.sort);
  if (rt.staffId != null) params.set('staff', String(rt.staffId));
  const res = await fetch(`/api/receiving-lines?${params.toString()}`);
  if (!res.ok) throw new Error(`${spec.segment} fetch failed`);
  const data = (await res.json()) as ApiResponse;
  let rows = data.receiving_lines ?? [];
  if (spec.postFilter) rows = rows.filter(spec.postFilter);
  const q = (rt.query ?? '').trim().toLowerCase();
  if (q) rows = rows.filter((r) => matchesReceivingLine(r, q));
  return { success: true, receiving_lines: rows, total: rows.length };
}

// Triage "Prioritize" — door-scanned matched cartons, priority-sorted.
const SCANNED_SOURCE: ReceivingLinesQuery = {
  segment: 'scanned',
  view: 'scanned',
  sort: 'priority',
  postFilter: notUnmatched,
};

// Unbox "Queue" — triage door-scanned matched POs (isolated cache segment `unbox-queue`).

/** Scanned subset rows (reused by triage Prioritize + combined feed). */
export async function fetchScannedRows(rt: RailFetchRuntime): Promise<ReceivingLineRow[]> {
  return (await fetchReceivingLines(SCANNED_SOURCE, rt)).receiving_lines;
}

// Unbox "Received" matched source — recently UNBOXED cartons (view=activity).
// Merged with new door-scans + unfound in buildUnboxReceivedFetcher; the
// per-source order is irrelevant since the union is re-sorted by received recency.
const ACTIVITY_SOURCE: ReceivingLinesQuery = {
  segment: 'activity',
  view: 'activity',
  sort: 'unboxed_newest',
};

/** Recently-unboxed rows (reused by the Received feed). */
export async function fetchActivityRows(rt: RailFetchRuntime): Promise<ReceivingLineRow[]> {
  return (await fetchReceivingLines(ACTIVITY_SOURCE, rt)).receiving_lines;
}

// Unbox sidebar — cartons scanned on the Unbox surface (ops UNBOX_SCAN_OPENED).
const UNBOX_OPENED_SOURCE: ReceivingLinesQuery = {
  segment: 'unbox-opened',
  view: 'unbox_opened',
};

/** Cartons opened via a scan on the Unbox workspace (found + unfound). */
export async function fetchUnboxOpenedRows(rt: RailFetchRuntime): Promise<ReceivingLineRow[]> {
  return (await fetchReceivingLines(UNBOX_OPENED_SOURCE, rt)).receiving_lines;
}

/** Scan-recency for the Unboxed rail — MUST ignore receive-button updates. */
function scannedRecencyMs(row: ReceivingLineRow): number {
  const at = row.scanned_at ?? row.received_at ?? row.created_at ?? null;
  if (!at) return 0;
  const t = Date.parse(at);
  return Number.isNaN(t) ? 0 : t;
}

/** Unfound-queue rows mapped to stub lines (reused by the unfound + combined feeds). */
export async function fetchUnfoundStubs(rt: RailFetchRuntime): Promise<ReceivingLineRow[]> {
  const res = await fetch(
    '/api/receiving/unfound-queue?kind=unmatched_receiving&checked=false&limit=200&exclude_unbox_intake=true',
    { cache: 'no-store' },
  );
  if (!res.ok) throw new Error('unfound queue fetch failed');
  const data = (await res.json()) as { rows?: UnfoundQueueRow[] };
  const q = (rt.query ?? '').trim().toLowerCase();
  return (data.rows ?? [])
    .filter((r) => Number.isFinite(Number(r.source_id)))
    .filter((r) => matchesUnfoundQueue(r, q))
    .map(toStubRow);
}

/**
 * Triage combined feed — Prioritize ∪ Unfound in one list, newest-scanned first.
 * Reuses the EXACT same two subset fetchers (never a divergent third query), and
 * degrades: a failing source resolves empty so the other still lists.
 */
export function buildTriageCombinedFetcher(rt: RailFetchRuntime): () => Promise<ApiResponse> {
  return async () => {
    const [scanned, unfound] = await Promise.all([
      fetchScannedRows(rt).catch(() => [] as ReceivingLineRow[]),
      fetchUnfoundStubs(rt).catch(() => [] as ReceivingLineRow[]),
    ]);
    // IMPORTANT: keep triage stable by carton identity. When an unfound carton
    // becomes matched, it moves between the two source queries; without a stable
    // identity this appears as a delete+add flicker. Dedup to one row per carton
    // (receiving_id) and key the row by a durable client_event_id so React Query
    // reconciliation updates in place.
    const bestByCarton = new Map<number, ReceivingLineRow>();
    for (const row of [...scanned, ...unfound]) {
      const rid = row.receiving_id;
      if (rid == null || !Number.isFinite(Number(rid))) continue;
      const existing = bestByCarton.get(rid);
      if (!existing) {
        bestByCarton.set(rid, row);
        continue;
      }
      // Prefer scanned (matched) over unfound when both exist; else keep the
      // newest by recency.
      const existingIsUnmatched = existing.receiving_source === 'unmatched';
      const nextIsUnmatched = row.receiving_source === 'unmatched';
      if (existingIsUnmatched && !nextIsUnmatched) {
        bestByCarton.set(rid, row);
        continue;
      }
      if (existingIsUnmatched === nextIsUnmatched && recencyMs(row) > recencyMs(existing)) {
        bestByCarton.set(rid, row);
      }
    }
    const merged = Array.from(bestByCarton.values())
      .map((r) => ({
        ...r,
        // Stable per-carton identity for the combined feed only.
        client_event_id: `carton:${r.receiving_id}`,
      }))
      .sort((a, b) => recencyMs(b) - recencyMs(a));
    return { success: true, receiving_lines: merged, total: merged.length };
  };
}

/**
 * Unbox "Unboxed" feed — every carton scanned on the Unbox surface (found or
 * unfound), keyed on ops_events UNBOX_SCAN_OPENED. Newest scan first.
 */
export function buildUnboxReceivedFetcher(rt: RailFetchRuntime): () => Promise<ApiResponse> {
  return async () => {
    const opened = await fetchReceivingLines(UNBOX_OPENED_SOURCE, rt, {
      limit: RECEIVING_TABLE_LIMIT,
      includeSerials: false,
    }).then((d) => d.receiving_lines);

    const bestByCarton = new Map<number, ReceivingLineRow>();
    for (const row of opened) {
      const rid = row.receiving_id;
      if (rid == null || !Number.isFinite(Number(rid))) continue;
      const existing = bestByCarton.get(rid);
      if (!existing) {
        bestByCarton.set(rid, row);
        continue;
      }
      const existingIsStub = existing.id < 0;
      const nextIsStub = row.id < 0;
      if (existingIsStub && !nextIsStub) {
        bestByCarton.set(rid, row);
        continue;
      }
      if (existingIsStub === nextIsStub && scannedRecencyMs(row) > scannedRecencyMs(existing)) {
        bestByCarton.set(rid, row);
      }
    }

    const merged = Array.from(bestByCarton.values()).sort(
      (a, b) => scannedRecencyMs(b) - scannedRecencyMs(a),
    );

    return { success: true, receiving_lines: merged, total: merged.length };
  };
}

/** Unfound feed — unmatched cartons (no PO yet) as stub lines. */
export function buildUnfoundFetcher(rt: RailFetchRuntime): () => Promise<ApiResponse> {
  return async () => {
    const rows = await fetchUnfoundStubs(rt);
    return { success: true, receiving_lines: rows, total: rows.length };
  };
}

const FEEDS = {
  /**
   * Unbox "Unboxed" rail — cartons scanned on the Unbox surface only
   * (`view=unbox_opened`). No triage activity fallback.
   */
  unboxRecent: {
    segment: 'received',
    eyebrowTitle: 'Unboxed',
    qty: 'received',
    status: 'unbox-recent',
    buildFetcher: buildUnboxReceivedFetcher,
    // Unboxed rail time axis is ALWAYS tracking scan time (never updated_at).
    getActivityAt: (r) => r.scanned_at ?? r.received_at ?? r.created_at ?? null,
    pinSelectedLead: false,
    // Match History: all staff, deep window (not the triage ?staff= filter).
    usesStaffFilter: false,
    autoSelectFirstWhenEmpty: true,
    limit: RECEIVING_TABLE_LIMIT,
    refreshEvents: UNBOX_REFRESH,
  },
  /**
   * Unbox "Queue" — triage door-scanned matched POs waiting to unbox. The only
   * feed that reads triage intake data inside Unbox mode.
   */
  unboxQueue: {
    segment: 'unbox-queue',
    eyebrowTitle: 'Scanned',
    qty: 'scanned',
    status: 'receiving',
    view: 'scanned',
    sort: 'priority',
    postFilter: notUnmatched,
    usesStaffFilter: true,
    autoSelectFirstWhenEmpty: true,
    limit: 50,
    refreshEvents: [...UNBOX_REFRESH, 'receiving-triage-refresh'],
  },
  /** Triage "Prioritize" — door-scanned matched cartons, not yet unboxed. */
  scanned: {
    segment: 'scanned',
    eyebrowTitle: 'Scanned',
    qty: 'scanned',
    status: 'receiving',
    view: 'scanned',
    sort: 'priority',
    postFilter: notUnmatched,
    usesStaffFilter: true,
    autoSelectFirstWhenEmpty: true,
    limit: 50,
    refreshEvents: TRIAGE_REFRESH,
  },
  /** Unbox "Viewed" — lines this operator recently opened (per-staff). */
  viewed: {
    segment: 'viewed',
    eyebrowTitle: 'Viewed',
    qty: 'received',
    status: 'receiving',
    view: 'viewed',
    getActivityAt: getViewedAt,
    autoSelectFirstWhenEmpty: true,
    refreshEvents: UNBOX_REFRESH,
  },
  /** Triage default — Prioritize ∪ Unfound, newest-scanned first. */
  triageCombined: {
    segment: 'triage-combined',
    eyebrowTitle: 'Triage',
    qty: 'combined',
    status: 'receiving',
    buildFetcher: buildTriageCombinedFetcher,
    usesStaffFilter: true,
    autoSelectFirstWhenEmpty: true,
    limit: 200,
    refreshEvents: TRIAGE_REFRESH,
  },
  /** Triage "Unfound" — cartons Zoho can't match to a PO yet. */
  triageUnfound: {
    segment: 'unfound',
    eyebrowTitle: 'Unfound',
    qty: 'unfound',
    status: 'receiving',
    buildFetcher: buildUnfoundFetcher,
    autoSelectFirstWhenEmpty: true,
    limit: 200,
    refreshEvents: TRIAGE_REFRESH,
  },
} satisfies Record<string, ReceivingRailFeed>;

/** Feed ids — the key a rail binds by (`feed="unboxRecent"`). */
export type ReceivingRailFeedId = keyof typeof FEEDS;

// Re-typed so an indexed lookup `RECEIVING_RAIL_FEEDS[id]` widens to the full
// `ReceivingRailFeed` (every optional present) rather than the narrow per-key
// shape — otherwise feeds that omit `buildFetcher`/`view`/etc. would make those
// fields unreadable through the generic rail. Same object, so the module-scope
// fns + refreshEvents arrays keep their stable identity.
export const RECEIVING_RAIL_FEEDS: Record<ReceivingRailFeedId, ReceivingRailFeed> = FEEDS;
