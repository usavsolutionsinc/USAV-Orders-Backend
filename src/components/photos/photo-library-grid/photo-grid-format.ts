import type { LibraryPhoto } from '../photo-library-types';
import type { PhotoLibrarySourceScope } from '@/lib/photos/library-filter-state';
import type { PhotoGalleryInput, PhotoMeta } from '@/components/shipped/photo-gallery/photo-gallery-utils';
import {
  photoFileName,
  photoGroupHeaderLabel,
  photoGroupKey,
  photoPrimaryLabel,
  UNLINKED_PHOTO_GROUP_KEY,
} from '@/lib/photos/display-names';

/** @deprecated Use {@link UNLINKED_PHOTO_GROUP_KEY} from display-names. */
export const UNLINKED_TICKET_KEY = UNLINKED_PHOTO_GROUP_KEY;

export interface TicketGroup {
  key: string;
  /** Display label for the ticket header (the ticket number, or "Unlinked"). */
  label: string;
  photos: LibraryPhoto[];
  /** Most-recent capture in the group, for the header timestamp. */
  latestAt: string;
}

/** Group photos by ticket# (claims) or PO#/order ref; oldest→newest within each group. */
export function groupPhotosByTicket(
  photos: LibraryPhoto[],
  scope: PhotoLibrarySourceScope,
): TicketGroup[] {
  const order: string[] = [];
  const map = new Map<string, TicketGroup>();
  for (const photo of photos) {
    const key = photoGroupKey(photo, scope);
    let group = map.get(key);
    if (!group) {
      const raw = key.startsWith('po:') ? key.slice('po:'.length) : undefined;
      group = {
        key,
        label: photoGroupHeaderLabel(key, scope, raw),
        photos: [],
        latestAt: photo.createdAt,
      };
      map.set(key, group);
      order.push(key);
    }
    group.photos.push(photo);
    if (photo.createdAt > group.latestAt) group.latestAt = photo.createdAt;
  }
  for (const group of map.values()) {
    group.photos.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  return order.map((key) => map.get(key)!);
}

export { photoFileName, photoPrimaryLabel };

export function documentPrimaryLabel(photo: LibraryPhoto): string {
  if (photo.filename?.trim()) return photo.filename.trim();
  if (photo.documentType === 'shipping_label') {
    return photo.tracking?.trim() ? `Label · ${photo.tracking}` : 'Shipping label';
  }
  if (photo.documentType === 'packing_slip') {
    return photo.poRef?.trim() ? `Slip · ${photo.poRef}` : 'Packing slip';
  }
  return photo.poRef?.trim() ? `Order ${photo.poRef}` : `Document ${Math.abs(photo.id)}`;
}

/** Project a `LibraryPhoto` into the gallery's context-panel meta. */
function libraryPhotoMeta(photo: LibraryPhoto, scope: PhotoLibrarySourceScope): PhotoMeta {
  return {
    poRef: photo.poRef,
    photoType: photo.photoType,
    ticketId: photo.ticketId ?? null,
    takenByStaffId: photo.takenByStaffId ?? null,
    takenByStaffName: photo.takenByStaffName ?? null,
    createdAt: photo.createdAt,
    damageDetected: photo.damageDetected ?? null,
    hasAnalysis: photo.hasAnalysis ?? null,
    caption: photo.caption ?? null,
    sourceScope: scope,
  };
}

/** Gallery inputs for a list of library photos, carrying full panel context. */
export function toGalleryInputs(photos: LibraryPhoto[], scope: PhotoLibrarySourceScope): PhotoGalleryInput[] {
  return photos.map((p) => ({ id: p.id, url: p.displayUrl, thumbUrl: p.thumbUrl, meta: libraryPhotoMeta(p, scope) }));
}

/**
 * Decide what a tile click means. A modifier key (Shift / Ctrl / Cmd) or an
 * already-active selection routes the click to selection; otherwise it opens the
 * lightbox. This is the Google-Photos model: browse by default, modifier-click
 * (or the hover checkmark) to start selecting, then plain clicks toggle.
 */
export function clickSelectsInstead(e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }, selectionActive: boolean): boolean {
  return selectionActive || e.shiftKey || e.metaKey || e.ctrlKey;
}
