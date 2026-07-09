import type { PhotoLibrarySourceScope } from '@/lib/photos/library-filter-state';

/** Minimal photo shape for naming helpers (library row, share meta, zip). */
export interface PhotoNamingFields {
  id: number;
  poRef?: string | null;
  ticketId?: number | null;
  photoType?: string | null;
  /** Per-row derived scope — enables ticket grouping under "All photos". */
  sourceScope?: PhotoLibrarySourceScope | null;
}

export const UNLINKED_PHOTO_GROUP_KEY = '__unlinked__';

/** True when ticket-based naming/grouping should apply. */
export function isClaimsPhotoNaming(
  scope: PhotoLibrarySourceScope,
  photo?: Pick<PhotoNamingFields, 'sourceScope'>,
): boolean {
  return scope === 'claims' || photo?.sourceScope === 'claims';
}

/** Claims ticket chip label — `#4821` (no "Ticket" prefix). */
export function claimsTicketLabel(ticketId: number | string): string {
  return `#${ticketId}`;
}

/** Zendesk ticket id used for claims-scope labels and grouping. */
export function photoTicketId(
  photo: PhotoNamingFields,
  scope: PhotoLibrarySourceScope,
): number | null {
  if (!isClaimsPhotoNaming(scope, photo) || photo.ticketId == null) return null;
  const id = Number(photo.ticketId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** Stable key for group-by-ticket / folder drill (ticket id or po ref). */
export function photoGroupKey(photo: PhotoNamingFields, scope: PhotoLibrarySourceScope): string {
  const ticketId = photoTicketId(photo, scope);
  if (ticketId != null) return `ticket:${ticketId}`;
  const ref = photo.poRef?.trim();
  if (ref) return isClaimsPhotoNaming(scope, photo) ? UNLINKED_PHOTO_GROUP_KEY : `po:${ref}`;
  return UNLINKED_PHOTO_GROUP_KEY;
}

/** Section header / folder title for a group key. */
export function photoGroupHeaderLabel(
  key: string,
  scope: PhotoLibrarySourceScope,
  rawLabel?: string,
): string {
  if (key === UNLINKED_PHOTO_GROUP_KEY) return 'Unlinked';
  if (key.startsWith('ticket:')) {
    return claimsTicketLabel(key.slice('ticket:'.length));
  }
  const ref = rawLabel ?? key.replace(/^po:/, '');
  if (scope === 'local_pickup') return `Pickup ${ref}`;
  if (scope === 'packing') return `Order ${ref}`;
  if (scope === 'repair') return `Unit ${ref}`;
  if (scope === 'outbound') return `Order ${ref}`;
  return `PO ${ref}`;
}

/** Filesystem-safe export base (share links, ZIP entries) — ticket-first when linked. */
export function photoExportBaseName(photo: PhotoNamingFields): string {
  const ticketId =
    photo.ticketId != null && Number(photo.ticketId) > 0 ? Number(photo.ticketId) : null;
  if (ticketId != null) return String(ticketId);
  if (photo.poRef?.trim()) return `PO-${photo.poRef.trim()}`;
  const type = photo.photoType?.toLowerCase().replace(/_/g, '-');
  return type ? type : `photo-${photo.id}`;
}

export function photoFileName(photo: PhotoNamingFields, scope: PhotoLibrarySourceScope): string {
  const ticketId = photoTicketId(photo, scope);
  if (ticketId != null) return `${ticketId}-${photo.id}.jpg`;
  if (photo.poRef) return `PO-${photo.poRef}-${photo.id}.jpg`;
  const type = photo.photoType?.toLowerCase().replace(/_/g, '-') ?? 'photo';
  return `${type}-${photo.id}.jpg`;
}

export function photoPrimaryLabel(photo: PhotoNamingFields, scope: PhotoLibrarySourceScope): string {
  const ticketId = photoTicketId(photo, scope);
  if (ticketId != null) return claimsTicketLabel(ticketId);
  if (photo.poRef) return `PO ${photo.poRef}`;
  return photo.photoType?.replace(/_/g, ' ').toLowerCase() ?? `Photo ${photo.id}`;
}

/** Auto title for share page / ZIP from a selection's dominant ref. */
export function photoShareTitle(
  rows: PhotoNamingFields[],
  scope: PhotoLibrarySourceScope,
  count = rows.length,
): string {
  if (scope === 'claims' || rows.some((r) => r.sourceScope === 'claims')) {
    const ticket = rows.find((r) => photoTicketId(r, scope) != null);
    const ticketId = ticket ? photoTicketId(ticket, scope) : null;
    if (ticketId != null) return `${claimsTicketLabel(ticketId)} photos (${count})`;
  }
  const po = rows.find((r) => r.poRef?.trim())?.poRef?.trim();
  return po ? `PO ${po} photos (${count})` : `Photos (${count})`;
}

/** Backfill claims display ref from ticket link when po_ref still holds the PO#. */
export function withClaimsDisplayRef<T extends PhotoNamingFields & { sourceScope?: PhotoLibrarySourceScope | null }>(
  photo: T,
  scope: PhotoLibrarySourceScope,
): T {
  const ticketId = photoTicketId(photo, scope);
  if (ticketId == null) return photo;
  return { ...photo, poRef: String(ticketId) };
}
