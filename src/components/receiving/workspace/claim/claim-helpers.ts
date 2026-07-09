import { normalizePhotoDisplayUrl } from '@/lib/nas-photo-url';
import { resolvePhotoThumbUrl } from '@/lib/photos/display-url';
import {
  photoGridTileRatio,
  type PhotoGridDensity,
  type PhotoGridTileRatio,
} from '@/lib/photos/photo-grid-density';

/**
 * Build a preview URL for the photo-selection grid. The dev proxy supports
 * `?thumb`; prod loads the full image through the same-origin /api/nas proxy
 * (session cookie).
 */
export function claimThumb(url: string, photoId?: number): string {
  if (photoId != null && photoId > 0) {
    return resolvePhotoThumbUrl({ id: photoId, url }, normalizePhotoDisplayUrl);
  }
  const normalized = normalizePhotoDisplayUrl(url);
  if (normalized.startsWith('/api/nas-dev/')) {
    return normalized + (normalized.includes('?') ? '&' : '?') + 'thumb=200';
  }
  return normalized;
}

/** Grid tile src + aspect for the claim / receiving photo attach picker. */
export function claimPhotoTileProps(
  photo: { id: number; url: string },
  density: PhotoGridDensity,
): { ratio: PhotoGridTileRatio; imageUrl: string } {
  return {
    ratio: photoGridTileRatio(density),
    imageUrl:
      density === 'lg' ? normalizePhotoDisplayUrl(photo.url) : claimThumb(photo.url, photo.id),
  };
}

/** Format a ticket ISO timestamp as a short, locale-aware date (or em dash). */
export function ticketDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
