import { createHash } from 'node:crypto';
import type { PhotoBytes } from '@/lib/receiving-claim-photos';
import { readPhotoBytes as readLegacyPhotoBytes } from '@/lib/receiving-claim-photos';
import { getStorageAdapter } from './storage/registry';
import { getPhotoStorageRows } from './storage/resolve-primary';
import { readLegacyUrlBytes } from './storage/legacy-adapter';
import { gcsAdapter } from './storage/gcs-adapter';

function guessFilename(objectKey: string, contentType: string | null): string {
  const base = objectKey.split('/').pop() || 'photo.jpg';
  if (base.includes('.')) return base;
  if (contentType?.includes('png')) return `${base}.png`;
  return `${base}.jpg`;
}

/**
 * Server-side byte reader — GCS primary, NAS mirror, then legacy URL.
 * Used by Zendesk claim attachments, share pack zip, etc.
 */
export async function readPhotoBytesById(
  photoId: number,
  organizationId: string,
): Promise<PhotoBytes | null> {
  const rows = await getPhotoStorageRows(photoId, organizationId);
  const primary = rows.find((r) => r.isPrimary) ?? rows[0] ?? null;

  if (primary?.provider === 'gcs' && primary.bucket) {
    try {
      const adapter = getStorageAdapter('gcs');
      const bytes = await adapter.getObjectBytes({
        bucket: primary.bucket,
        objectKey: primary.objectKey,
      });
      return {
        bytes: new Uint8Array(bytes),
        filename: guessFilename(primary.objectKey, primary.contentType),
        contentType: primary.contentType || 'image/jpeg',
      };
    } catch {
      /* fall through */
    }
  }

  const nasMirror = rows.find((r) => r.provider === 'nas');
  if (nasMirror?.legacyUrl || nasMirror?.objectKey) {
    const url = nasMirror.legacyUrl || nasMirror.objectKey;
    const legacy = await readLegacyPhotoBytes(url);
    if (legacy) return legacy;
  }

  // Google Drive backup (object_key is the Drive file id; reads need the org's
  // OAuth token, so this can't go through the generic bucket/objectKey adapter).
  const driveRow = rows.find((r) => r.provider === 'google_drive');
  if (driveRow?.objectKey) {
    try {
      const { getDriveFileMedia } = await import('./drive/client');
      const media = await getDriveFileMedia(organizationId, driveRow.objectKey);
      if (media) {
        return {
          bytes: media.bytes,
          filename: guessFilename(driveRow.objectKey, driveRow.contentType),
          contentType: driveRow.contentType || media.contentType || 'image/jpeg',
        };
      }
    } catch {
      /* fall through — Drive may be reconnecting */
    }
  }

  if (primary?.legacyUrl) {
    const legacy = await readLegacyPhotoBytes(primary.legacyUrl);
    if (legacy) return legacy;
  }

  if (primary?.provider === 'legacy_url' && primary.legacyUrl) {
    const buf = await readLegacyUrlBytes(primary.legacyUrl);
    if (buf) {
      return {
        bytes: new Uint8Array(buf),
        filename: guessFilename(primary.legacyUrl, primary.contentType),
        contentType: primary.contentType || 'image/jpeg',
      };
    }
  }

  // photos.url removed in Phase E — storage + content route only
  return null;
}

/** @deprecated Prefer readPhotoBytesById — kept for claim code during migration. */
export async function readPhotoBytes(rawUrl: string): Promise<PhotoBytes | null> {
  return readLegacyPhotoBytes(rawUrl);
}

export async function generateThumbnail(buffer: Buffer, maxPx: number): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp(buffer)
    .rotate()
    .resize(maxPx, maxPx, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
}

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export { gcsAdapter };
