import type { LibraryPhoto } from '../photo-library-types';
import type { PhotoLibrarySourceScope } from '@/lib/photos/library-filter-state';
import type { PhotoGalleryInput, PhotoMeta } from '@/components/shipped/photo-gallery/photo-gallery-utils';

/**
 * Ticket-number grouping key for a photo. `poRef` is the denormalized ticket
 * reference stamped on every row at upload time (PO ref for receiving, order/
 * scan ref for packing, unit/sku ref for serial units — see
 * `lib/photos/resolve-po-ref.ts`). Photos with no ref fall into an "Unlinked"
 * bucket so they stay visible rather than disappearing from the grouped view.
 */
export const UNLINKED_TICKET_KEY = '__unlinked__';

export interface TicketGroup {
  key: string;
  /** Display label for the ticket header (the ticket number, or "Unlinked"). */
  label: string;
  photos: LibraryPhoto[];
  /** Most-recent capture in the group, for the header timestamp. */
  latestAt: string;
}

/** Group photos by PO# (`poRef`); within a group order oldest→newest (left→right). */
export function groupPhotosByTicket(photos: LibraryPhoto[]): TicketGroup[] {
  const order: string[] = [];
  const map = new Map<string, TicketGroup>();
  for (const photo of photos) {
    const ref = photo.poRef?.trim();
    const key = ref || UNLINKED_TICKET_KEY;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        label: ref || 'Unlinked',
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

/**
 * Whether a photo's name should read as a Zendesk ticket# rather than a PO#.
 * Claims photos carry the ticket id the claim was opened under (often the same
 * receiving the PO# came from) — in the claims scope we surface that ticket# so
 * the same physical photos are findable by their Zendesk reference.
 */
function ticketIdForLabel(photo: LibraryPhoto, scope: PhotoLibrarySourceScope): number | null {
  return scope === 'claims' && photo.ticketId != null ? photo.ticketId : null;
}

export function photoFileName(photo: LibraryPhoto, scope: PhotoLibrarySourceScope): string {
  const ticketId = ticketIdForLabel(photo, scope);
  if (ticketId != null) return `ticket-${ticketId}-${photo.id}.jpg`;
  if (photo.poRef) return `PO-${photo.poRef}-${photo.id}.jpg`;
  const type = photo.photoType?.toLowerCase().replace(/_/g, '-') ?? 'photo';
  return `${type}-${photo.id}.jpg`;
}

export function photoPrimaryLabel(photo: LibraryPhoto, scope: PhotoLibrarySourceScope): string {
  const ticketId = ticketIdForLabel(photo, scope);
  if (ticketId != null) return `Ticket ${ticketId}`;
  if (photo.poRef) return `PO ${photo.poRef}`;
  return photo.photoType?.replace(/_/g, ' ').toLowerCase() ?? `Photo ${photo.id}`;
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
