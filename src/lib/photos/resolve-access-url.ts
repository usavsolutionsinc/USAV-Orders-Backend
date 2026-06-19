import { getPrimaryPhotoStorage } from './storage/resolve-primary';
import { getStorageAdapter } from './storage/registry';
import { readPhotoBytesById } from './read-bytes';
import { photoContentUrl } from './display-url';

const TTL = Number(process.env.PHOTOS_SIGNED_URL_TTL_SECONDS || 3600);

/** Signed GCS URL for public share packs; falls back to app content route. */
export async function resolvePhotoAccessUrl(
  photoId: number,
  organizationId: string,
  variant: 'thumb' | 'full' = 'full',
  origin?: string,
): Promise<string> {
  const storage = await getPrimaryPhotoStorage(photoId, organizationId);
  if (storage?.provider === 'gcs' && storage.bucket) {
    const key =
      variant === 'thumb' && storage.thumbObjectKey
        ? storage.thumbObjectKey
        : storage.objectKey;
    try {
      const adapter = getStorageAdapter('gcs');
      return await adapter.getSignedReadUrl({
        bucket: storage.bucket,
        objectKey: key,
        ttlSeconds: TTL,
      });
    } catch {
      /* fall through */
    }
  }

  if (origin) {
    return `${origin.replace(/\/+$/, '')}${photoContentUrl(photoId, variant === 'thumb' ? 'thumb' : undefined)}`;
  }
  return photoContentUrl(photoId, variant === 'thumb' ? 'thumb' : undefined);
}

export { readPhotoBytesById };
