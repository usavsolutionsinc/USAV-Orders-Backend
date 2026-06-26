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
  const deletedId =
    payload.action === 'delete' && payload.photoIds?.length === 1
      ? payload.photoIds[0]
      : undefined;
  refreshReceivingPhotos(queryClient, receivingId, deletedId);
}
