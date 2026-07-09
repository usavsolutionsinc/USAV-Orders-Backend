import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizePhotoDisplayUrl } from '@/lib/nas-photo-url';
import type { ClaimPhoto } from '../claim-types';

export interface UseClaimPhotos {
  photos: ClaimPhoto[];
  selectedPhotoIds: Set<number>;
  /** Toggle a single photo in/out of the attach set. */
  togglePhoto: (id: number) => void;
  /** Select all when not all selected, otherwise clear the selection. */
  toggleSelectAll: () => void;
  /** Re-pull the carton's photos (e.g. after the phone uploads new captures). */
  refetch: () => Promise<void>;
}

interface ApiPhoto {
  id: number;
  photoUrl?: string;
}

function mapPhotos(data: { photos?: ApiPhoto[] } | null): ClaimPhoto[] {
  return (data?.photos ?? [])
    .filter((p) => !!p.photoUrl?.trim())
    .map((p) => ({ id: p.id, url: normalizePhotoDisplayUrl(p.photoUrl as string) }));
}

/**
 * Loads the carton's photos so the operator can pick which to attach to the
 * Zendesk ticket. Defaults to all selected — attaching everything is the common
 * case; deselect to trim. Self-contained: re-loads whenever the modal opens on a
 * new carton and is best-effort (a claim can still be filed without photos).
 *
 * `refetch()` re-pulls on demand — wired to the realtime "phone uploaded a
 * photo" signal so send-to-phone captures appear in the grid live, pre-selected,
 * without the operator leaving the modal.
 *
 * @param open          Whether the claim modal is open (gates the fetch).
 * @param receivingId   The carton receiving id to load photos for.
 */
export function useClaimPhotos(open: boolean, receivingId: number | null | undefined): UseClaimPhotos {
  const [photos, setPhotos] = useState<ClaimPhoto[]>([]);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<number>>(new Set());
  // Ids we've already shown — so a refetch can tell genuinely-new photos (select
  // them) from ones the operator deliberately deselected (leave them off).
  const knownIds = useRef<Set<number>>(new Set());

  const refetch = useCallback(async () => {
    if (!receivingId) return;
    try {
      const res = await fetch(`/api/receiving-photos?receivingId=${receivingId}`, { cache: 'no-store' });
      const list = mapPhotos(await res.json().catch(() => null));
      setPhotos(list);
      setSelectedPhotoIds((prev) => {
        // Keep current selections that still exist, and auto-select brand-new
        // (phone-captured) ids the operator hasn't seen yet.
        const next = new Set([...prev].filter((id) => list.some((p) => p.id === id)));
        list.forEach((p) => {
          if (!knownIds.current.has(p.id)) next.add(p.id);
        });
        return next;
      });
      knownIds.current = new Set(list.map((p) => p.id));
    } catch {
      /* best-effort — claim can still be filed without photos */
    }
  }, [receivingId]);

  useEffect(() => {
    if (!open) {
      // Reset transient state when the modal closes so a reopen starts clean.
      setPhotos([]);
      setSelectedPhotoIds(new Set());
      knownIds.current = new Set();
      return;
    }
    if (!receivingId) return;
    const ctrl = new AbortController();
    fetch(`/api/receiving-photos?receivingId=${receivingId}`, { cache: 'no-store', signal: ctrl.signal })
      .then((r) => r.json().catch(() => null))
      .then((data) => {
        const list = mapPhotos(data);
        setPhotos(list);
        setSelectedPhotoIds(new Set(list.map((p) => p.id)));
        knownIds.current = new Set(list.map((p) => p.id));
      })
      .catch(() => {
        /* best-effort — claim can still be filed without photos */
      });
    return () => ctrl.abort();
  }, [open, receivingId]);

  const togglePhoto = (id: number) =>
    setSelectedPhotoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleSelectAll = () =>
    setSelectedPhotoIds((prev) =>
      prev.size === photos.length ? new Set() : new Set(photos.map((p) => p.id)),
    );

  return { photos, selectedPhotoIds, togglePhoto, toggleSelectAll, refetch };
}
