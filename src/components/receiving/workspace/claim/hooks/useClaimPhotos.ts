import { useEffect, useState } from 'react';
import { normalizePhotoDisplayUrl } from '@/lib/nas-photo-url';
import type { ClaimPhoto } from '../claim-types';

export interface UseClaimPhotos {
  photos: ClaimPhoto[];
  selectedPhotoIds: Set<number>;
  /** Toggle a single photo in/out of the attach set. */
  togglePhoto: (id: number) => void;
  /** Select all when not all selected, otherwise clear the selection. */
  toggleSelectAll: () => void;
}

/**
 * Loads the carton's photos so the operator can pick which to attach to the
 * Zendesk ticket. Defaults to all selected — attaching everything is the common
 * case; deselect to trim. Self-contained: re-loads whenever the modal opens on a
 * new carton and is best-effort (a claim can still be filed without photos).
 *
 * @param open          Whether the claim modal is open (gates the fetch).
 * @param receivingId   The carton receiving id to load photos for.
 */
export function useClaimPhotos(open: boolean, receivingId: number | null | undefined): UseClaimPhotos {
  const [photos, setPhotos] = useState<ClaimPhoto[]>([]);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open) {
      // Reset transient state when the modal closes so a reopen starts clean.
      setPhotos([]);
      setSelectedPhotoIds(new Set());
      return;
    }
    if (!receivingId) return;
    const ctrl = new AbortController();
    fetch(`/api/receiving-photos?receivingId=${receivingId}`, {
      cache: 'no-store',
      signal: ctrl.signal,
    })
      .then((r) => r.json().catch(() => null))
      .then((data) => {
        const list: ClaimPhoto[] = (data?.photos ?? [])
          .filter((p: { photoUrl?: string }) => !!p.photoUrl?.trim())
          .map((p: { id: number; photoUrl: string }) => ({
            id: p.id,
            url: normalizePhotoDisplayUrl(p.photoUrl),
          }));
        setPhotos(list);
        setSelectedPhotoIds(new Set(list.map((p) => p.id)));
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

  return { photos, selectedPhotoIds, togglePhoto, toggleSelectAll };
}
