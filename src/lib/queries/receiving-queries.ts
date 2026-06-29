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

/**
 * Invalidate every receiving feed so all rails + tiles refetch atomically.
 * Call this from any mutation that changes receiving state (scan, match,
 * mark-received) instead of hand-picking a CustomEvent name.
 */
export function invalidateReceivingFeeds(queryClient: QueryClient): void {
  for (const queryKey of RECEIVING_FEED_ROOTS) {
    void queryClient.invalidateQueries({ queryKey });
  }
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
export function bumpReceivingPhotoCount(
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
