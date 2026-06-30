'use client';

import type { QueryClient } from '@tanstack/react-query';
import {
  dispatchReceivingPhotoChanged,
  type ReceivingPhotoChangedPayload,
} from '@/utils/events';

/**
 * Query-key roots for every receiving feed (Phase 1 of the receiving-triage
 * streamline — see docs/receiving-triage-streamline-plan.md §3.1).
 *
 * A single {@link invalidateReceivingFeeds} call refreshes all of them, so a
 * scan / receive mutation can never leave one rail stale because the wrong DOM
 * CustomEvent fired — the exact bug class that hid freshly-matched cartons from
 * the triage Prioritize tab (a matched scan only dispatched
 * `receiving-lines-prepended`, which the Prioritize rail did not listen to).
 *
 * `invalidateQueries` matches by key PREFIX, so each root covers every key
 * beneath it:
 *   ['receiving-lines-table']            → Prioritize rail, Recent/unbox rail, main table
 *   ['receiving']                        → triage Unfound list
 *   ['incoming-delivered-unscanned']     → delivered-but-not-scanned list
 *   ['receiving-lines-incoming-summary'] → Incoming tile counts
 *
 * New receiving feeds should key under one of these roots so this helper keeps
 * covering them with no extra wiring.
 */
export const RECEIVING_FEED_ROOTS: ReadonlyArray<ReadonlyArray<string>> = [
  ['receiving-lines-table'],
  ['receiving'],
  ['incoming-delivered-unscanned'],
  ['receiving-lines-incoming-summary'],
  // Incoming to-do list seeded from unmatched shipping-email order numbers —
  // refetches when an email rescan / Zoho refresh / scan changes the worklist.
  ['receiving-lines-incoming-todo'],
];

// Wall-clock of the last LOCAL receiving-feed invalidation (a scan/receive on
// THIS client). The Ably `receiving-log.changed` echo of that same mutation
// arrives a beat later and would re-invalidate the desktop rails — a second
// refetch + flicker per scan. `receivingFeedsRecentlyInvalidatedLocally()` lets
// the realtime handler skip the two overlapping rail roots when the local
// optimistic invalidation already covered them (events from OTHER clients have
// no recent local stamp, so they still refresh normally).
let lastLocalReceivingInvalidationAt = 0;

/**
 * True when {@link invalidateReceivingFeeds} ran locally within `withinMs`.
 * The realtime invalidation handler consults this to suppress the redundant
 * echo-driven refetch of the desktop rails right after a local scan.
 */
export function receivingFeedsRecentlyInvalidatedLocally(withinMs = 800): boolean {
  return Date.now() - lastLocalReceivingInvalidationAt < withinMs;
}

/**
 * Invalidate every receiving feed so all rails + tiles refetch atomically.
 * Call this from any mutation that changes receiving state (scan, match,
 * mark-received) instead of hand-picking a CustomEvent name. Stamps the local
 * invalidation time so the Ably echo of the same mutation can de-dupe its
 * refetch (see {@link receivingFeedsRecentlyInvalidatedLocally}).
 */
export function invalidateReceivingFeeds(queryClient: QueryClient): void {
  lastLocalReceivingInvalidationAt = Date.now();
  for (const queryKey of RECEIVING_FEED_ROOTS) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

/** Unbox "Unboxed" rail segment (`ReceivingFeedRail` feed `unboxRecent`). */
export const UNBOX_RAIL_SEGMENT = 'received' as const;

/**
 * Unbox "Queue" — triage door-scanned matched POs waiting to unbox. The ONLY
 * feed that mirrors triage found-PO scans into Unbox mode.
 */
export const UNBOX_QUEUE_SEGMENT = 'unbox-queue' as const;

/** Unbox sidebar rail segments (all Unbox-mode caches). */
export const UNBOX_RAIL_SEGMENTS = new Set([
  UNBOX_RAIL_SEGMENT,
  UNBOX_QUEUE_SEGMENT,
  'viewed',
]);

/** Unbox-surface rails only — excludes Queue (triage bridge). */
const UNBOX_SURFACE_SEGMENTS = new Set([UNBOX_RAIL_SEGMENT, 'viewed']);

/** Triage sidebar rail segments — never refresh from an Unbox-surface scan. */
export const TRIAGE_RAIL_SEGMENTS = new Set(['scanned', 'triage-combined', 'unfound']);

export type ReceivingIntakeSurface = 'triage' | 'unbox';

export interface ReceivingRailRow {
  id: number;
  receiving_id?: number | null;
  client_event_id?: string;
}

/** Scoped target for `receiving-lines-prepended` — prevents cross-mode rail bleed. */
export interface ReceivingLinesPrependedDetail {
  segments: string[];
  /** When set, only rails whose query key carries this scope accept the prepend. */
  scope?: string;
  intakeSurface: ReceivingIntakeSurface;
  rows: ReceivingRailRow[];
}

function isReceivingLinesTableKey(key: readonly unknown[]): boolean {
  return Array.isArray(key) && key[0] === 'receiving-lines-table';
}

function isUnboxReceivingQueryKey(key: readonly unknown[]): boolean {
  if (!isReceivingLinesTableKey(key)) return false;
  if (key[1] === 'rail') {
    return typeof key[2] === 'string' && UNBOX_SURFACE_SEGMENTS.has(key[2]);
  }
  // History table (`view=activity`) — unfound cartons scanned in Unbox belong here.
  return key[1] === 'activity' && key[2] === 'history';
}

function isUnboxQueueQueryKey(key: readonly unknown[]): boolean {
  return (
    isReceivingLinesTableKey(key)
    && key[1] === 'rail'
    && key[2] === UNBOX_QUEUE_SEGMENT
  );
}

function isTriageReceivingQueryKey(key: readonly unknown[]): boolean {
  if (!isReceivingLinesTableKey(key)) return false;
  if (key[1] === 'rail') {
    return typeof key[2] === 'string' && TRIAGE_RAIL_SEGMENTS.has(key[2]);
  }
  return false;
}

/** Parse legacy (bare row[]) and scoped prepend payloads. */
export function parseReceivingPrependedDetail(raw: unknown): {
  rows: ReceivingRailRow[];
  segments: string[] | null;
  scope: string | null;
  intakeSurface: ReceivingIntakeSurface | null;
} {
  if (Array.isArray(raw)) {
    return { rows: raw as ReceivingRailRow[], segments: null, scope: null, intakeSurface: null };
  }
  if (!raw || typeof raw !== 'object') {
    return { rows: [], segments: null, scope: null, intakeSurface: null };
  }
  const d = raw as Partial<ReceivingLinesPrependedDetail>;
  const rows = Array.isArray(d.rows) ? (d.rows as ReceivingRailRow[]) : [];
  const segments = Array.isArray(d.segments) ? d.segments.map(String) : null;
  const scope = typeof d.scope === 'string' ? d.scope : null;
  const intakeSurface = d.intakeSurface === 'unbox' || d.intakeSurface === 'triage' ? d.intakeSurface : null;
  return { rows, segments, scope, intakeSurface };
}

/** True when a rail's query key should accept a scoped prepend event. */
export function receivingPrependMatchesRail(
  queryKey: readonly unknown[],
  segments: string[] | null,
  scope: string | null,
): boolean {
  if (!segments || segments.length === 0) return false;
  if (!isReceivingLinesTableKey(queryKey) || queryKey[1] !== 'rail') return false;
  const seg = String(queryKey[2] ?? '');
  if (!segments.includes(seg)) return false;
  if (scope != null && String(queryKey[3] ?? 'default') !== scope) return false;
  return true;
}

export function dispatchReceivingLinesPrepended(detail: ReceivingLinesPrependedDetail): void {
  if (detail.rows.length === 0) return;
  window.dispatchEvent(new CustomEvent('receiving-lines-prepended', { detail }));
}

/** Triage-only refresh — Unbox rails must not listen. */
export function dispatchReceivingTriageRefresh(): void {
  window.dispatchEvent(new CustomEvent('receiving-triage-refresh'));
}

/** Unbox-only refresh — Triage rails must not listen. */
export function dispatchReceivingUnboxRefresh(): void {
  window.dispatchEvent(new CustomEvent('receiving-unbox-refresh'));
}

/**
 * Invalidate Unbox-surface rails + History — use after Unbox-surface scans.
 * Does NOT touch the Unbox Queue (triage found-PO bridge).
 */
export function invalidateUnboxReceivingFeeds(queryClient: QueryClient): void {
  lastLocalReceivingInvalidationAt = Date.now();
  void queryClient.invalidateQueries({
    predicate: (q) => isUnboxReceivingQueryKey(q.queryKey),
  });
}

/** Invalidate only the Unbox Queue (triage found-PO bridge). */
export function invalidateUnboxQueueFeeds(queryClient: QueryClient): void {
  lastLocalReceivingInvalidationAt = Date.now();
  void queryClient.invalidateQueries({
    predicate: (q) => isUnboxQueueQueryKey(q.queryKey),
  });
}

/**
 * After a triage found-PO scan: refresh triage rails AND the Unbox Queue mirror.
 * This is the only deliberate cross-mode invalidation.
 */
export function invalidateTriageAndUnboxQueueFeeds(queryClient: QueryClient): void {
  invalidateTriageReceivingFeeds(queryClient);
  invalidateUnboxQueueFeeds(queryClient);
}

/** Invalidate triage rails + the triage unfound queue cache root. */
export function invalidateTriageReceivingFeeds(queryClient: QueryClient): void {
  lastLocalReceivingInvalidationAt = Date.now();
  void queryClient.invalidateQueries({
    predicate: (q) => isTriageReceivingQueryKey(q.queryKey),
  });
  void queryClient.invalidateQueries({ queryKey: ['receiving'] });
}

export function deferInvalidateUnboxReceivingFeeds(queryClient: QueryClient): void {
  const run = () => invalidateUnboxReceivingFeeds(queryClient);
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 2_000 });
  } else {
    setTimeout(run, 16);
  }
}

export function deferInvalidateTriageReceivingFeeds(queryClient: QueryClient): void {
  const run = () => invalidateTriageReceivingFeeds(queryClient);
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 2_000 });
  } else {
    setTimeout(run, 16);
  }
}

export function deferInvalidateTriageAndUnboxQueueFeeds(queryClient: QueryClient): void {
  const run = () => invalidateTriageAndUnboxQueueFeeds(queryClient);
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 2_000 });
  } else {
    setTimeout(run, 16);
  }
}

/** TanStack key for carton sibling hydration (`include=serials`). */
export function receivingSiblingsQueryKey(receivingId: number) {
  return ['receiving-siblings', receivingId] as const;
}

/**
 * Seed the siblings cache from a lookup-po / optimistic stub response so
 * PoLinesAccordion and the workspace paint immediately before the hydration
 * fetch (with serials) lands.
 */
export function seedReceivingSiblingsCache(
  queryClient: QueryClient,
  receivingId: number,
  lines: unknown[],
  receivingPackage?: unknown,
): void {
  if (!Number.isFinite(receivingId) || receivingId <= 0 || lines.length === 0) return;
  queryClient.setQueryData(receivingSiblingsQueryKey(receivingId), {
    success: true,
    receiving_lines: lines,
    ...(receivingPackage != null ? { receiving_package: receivingPackage } : {}),
  });
}

/**
 * Defer a full feed invalidation until after the workspace has painted — keeps
 * scan resolve from stampeding every rail with concurrent refetches during the
 * critical open path. Falls back to `setTimeout` when `requestIdleCallback` is
 * unavailable (SSR/tests).
 */
export function deferInvalidateReceivingFeeds(queryClient: QueryClient): void {
  const run = () => invalidateReceivingFeeds(queryClient);
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 2_000 });
  } else {
    setTimeout(run, 16);
  }
}

/** Stable React list key for one carton across stub → server reconcile. */
export function receivingRailCartonKey(receivingId: number): string {
  return `carton:${receivingId}`;
}

function normalizeRailRows(rows: ReceivingRailRow[]): ReceivingRailRow[] {
  return rows.map((row) => {
    const rid = row.receiving_id;
    const cartonKey =
      row.client_event_id
      ?? (rid != null && Number.isFinite(rid) ? receivingRailCartonKey(rid) : undefined);
    return cartonKey ? { ...row, client_event_id: cartonKey } : row;
  });
}

function mergeRailRows(
  old: ReceivingRailRow[] | undefined,
  normalized: ReceivingRailRow[],
): ReceivingRailRow[] | undefined {
  if (!Array.isArray(old)) return old;
  let next = [...old];
  for (const row of normalized) {
    const rid = row.receiving_id;
    const key = row.client_event_id;
    const idx = next.findIndex(
      (r) =>
        (rid != null && r.receiving_id === rid)
        || (key != null && r.client_event_id === key),
    );
    if (idx >= 0) {
      next[idx] = { ...next[idx], ...row, client_event_id: key ?? next[idx].client_event_id };
    } else {
      next = [row, ...next];
    }
  }
  return next;
}

function upsertRailSegmentRows(
  queryClient: QueryClient,
  segment: string,
  rows: ReceivingRailRow[],
): void {
  if (rows.length === 0) return;
  const normalized = normalizeRailRows(rows);
  queryClient.setQueriesData<ReceivingRailRow[]>(
    { queryKey: ['receiving-lines-table', 'rail', segment] },
    (old) => mergeRailRows(old, normalized),
  );
}

/** Upsert into the Unbox "Unboxed" rail only (`segment=received`). */
export function upsertReceivingRailRows(
  queryClient: QueryClient,
  rows: ReceivingRailRow[],
): void {
  upsertRailSegmentRows(queryClient, UNBOX_RAIL_SEGMENT, rows);
}

/**
 * Mirror triage found-PO scans into the Unbox Queue — the only cross-mode write.
 */
export function upsertUnboxQueueRows(
  queryClient: QueryClient,
  rows: ReceivingRailRow[],
): void {
  upsertRailSegmentRows(queryClient, UNBOX_QUEUE_SEGMENT, rows);
}

/**
 * Query-key roots whose cached payloads carry receiving-line rows with a
 * `photo_count` field (the camera ×N badge). Used by the optimistic bump below
 * so the badge moves the instant an upload commits — before the reconciling
 * refetch lands. Kept narrow (only feeds that actually hold rows) so we don't
 * walk unrelated caches.
 */
const RECEIVING_PHOTO_COUNT_ROOTS: ReadonlyArray<ReadonlyArray<string>> = [
  ['receiving-lines-table'],
  ['receiving-lines'],
  ['receiving-lines-with-serials'],
];

interface PhotoCountRow {
  receiving_id?: number | null;
  photo_count?: number | null;
}

/**
 * Adjust `photo_count` on every row matching `receivingId` inside one cached
 * payload, returning a new reference only when something changed (so React
 * Query skips a no-op notify). Handles both feed shapes: a plain `row[]`
 * (mobile feeds) and the `{ receiving_lines: row[] }` envelope (desktop rails).
 */
function adjustRowsPhotoCount<T>(data: T, receivingId: number, delta: number): T {
  const bumpRow = (row: PhotoCountRow): PhotoCountRow => {
    if (!row || typeof row !== 'object') return row;
    if (Number(row.receiving_id) !== receivingId) return row;
    const next = Math.max(0, (Number(row.photo_count) || 0) + delta);
    return next === (Number(row.photo_count) || 0) ? row : { ...row, photo_count: next };
  };
  const bumpList = (list: PhotoCountRow[]): PhotoCountRow[] => {
    let changed = false;
    const next = list.map((r) => {
      const b = bumpRow(r);
      if (b !== r) changed = true;
      return b;
    });
    return changed ? next : list;
  };

  if (Array.isArray(data)) {
    const next = bumpList(data as PhotoCountRow[]);
    return (next === data ? data : next) as T;
  }
  if (data && typeof data === 'object') {
    const envelope = data as { receiving_lines?: PhotoCountRow[] };
    if (Array.isArray(envelope.receiving_lines)) {
      const next = bumpList(envelope.receiving_lines);
      return (next === envelope.receiving_lines ? data : { ...data, receiving_lines: next }) as T;
    }
  }
  return data;
}

/**
 * Optimistically move the camera ×N badge for a carton across every cached
 * receiving feed, without waiting for the network refetch. Pair with
 * {@link invalidateReceivingFeeds} (which {@link notifyReceivingPhotoChanged}
 * already calls) so the optimistic value reconciles against the server count.
 */
function bumpReceivingPhotoCount(
  queryClient: QueryClient,
  receivingId: number,
  delta: number,
): void {
  if (!Number.isFinite(receivingId) || receivingId <= 0 || !delta) return;
  for (const queryKey of RECEIVING_PHOTO_COUNT_ROOTS) {
    queryClient.setQueriesData<unknown>({ queryKey }, (data: unknown) =>
      data == null ? data : adjustRowsPhotoCount(data, receivingId, delta),
    );
  }
}

/** TanStack key for `/api/receiving-photos?receivingId=…`. */
export function receivingPhotosQueryKey(receivingId: number) {
  return ['receiving-photos', receivingId] as const;
}

interface ReceivingPhotosCacheRow {
  id: number;
  photoUrl?: string;
}

/**
 * Optimistically drop a deleted photo from the per-carton cache, then invalidate
 * so rails/mobile `photo_count` badges (camera ×N) and the gallery reconcile.
 */
export function refreshReceivingPhotos(
  queryClient: QueryClient,
  receivingId: number,
  deletedPhotoId?: number,
): void {
  const queryKey = receivingPhotosQueryKey(receivingId);
  if (deletedPhotoId != null) {
    queryClient.setQueryData<{ photos?: ReceivingPhotosCacheRow[] }>(queryKey, (old) => {
      if (!old?.photos) return old;
      const photos = old.photos.filter((p) => p.id !== deletedPhotoId);
      return photos.length === old.photos.length ? old : { ...old, photos };
    });
  }
  void queryClient.invalidateQueries({ queryKey });
  invalidateReceivingFeeds(queryClient);
}

/**
 * Single client-side entry point for photo CRUD side-effects: broadcast the
 * window/feed refresh signal (same-tab + mobile list) and patch/invalidate the
 * per-carton photo cache when `receivingId` is known.
 */
export function notifyReceivingPhotoChanged(
  queryClient: QueryClient,
  payload: ReceivingPhotoChangedPayload,
): void {
  dispatchReceivingPhotoChanged(payload);
  const receivingId = payload.receivingId;
  if (receivingId == null || !Number.isFinite(receivingId) || receivingId <= 0) return;

  // Optimistically move the camera ×N badge before the refetch round-trip, so a
  // capture on this device updates the feed the moment the upload commits. The
  // invalidate inside refreshReceivingPhotos() reconciles against the server
  // count. 'update' touches no photo, so it carries no delta.
  const photoDelta = payload.photoIds?.length ?? 1;
  if (payload.action === 'delete') {
    bumpReceivingPhotoCount(queryClient, receivingId, -photoDelta);
  } else if (payload.action === 'insert' || payload.action === 'upload') {
    bumpReceivingPhotoCount(queryClient, receivingId, photoDelta);
  }

  const deletedId =
    payload.action === 'delete' && payload.photoIds?.length === 1
      ? payload.photoIds[0]
      : undefined;
  refreshReceivingPhotos(queryClient, receivingId, deletedId);
}
