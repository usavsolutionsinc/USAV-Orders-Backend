/** Client-safe photo content URL helpers. */

export function photoContentUrl(id: number, variant?: 'thumb' | 'full'): string {
  const q = variant === 'thumb' ? '?variant=thumb' : '';
  return `/api/photos/${id}/content${q}`;
}

/**
 * Resolve a display URL for a photo list item.
 * Prefer id-based content route when photo id is known; fall back to legacy url normalization.
 */
export function resolvePhotoDisplayUrl(
  photo: { id?: number | null; url?: string | null },
  normalizeLegacy?: (url: string) => string,
): string {
  if (photo.id != null && photo.id > 0) {
    return photoContentUrl(photo.id);
  }
  const legacy = (photo.url || '').trim();
  if (!legacy) return '';
  return normalizeLegacy ? normalizeLegacy(legacy) : legacy;
}

export function resolvePhotoThumbUrl(
  photo: { id?: number | null; url?: string | null },
  normalizeLegacy?: (url: string) => string,
): string {
  if (photo.id != null && photo.id > 0) {
    return photoContentUrl(photo.id, 'thumb');
  }
  return resolvePhotoDisplayUrl(photo, normalizeLegacy);
}
