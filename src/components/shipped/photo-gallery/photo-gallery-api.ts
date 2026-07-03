import { deleteNasPhoto, isNasPhotoUrl } from '@/lib/nas-photos';
import { photoContentUrl } from '@/lib/photos/display-url';
import { buildPhotoZipDownloadUrl, triggerBrowserDownload } from '@/lib/photos/download-zip';

async function triggerBlobDownload(blob: Blob, filename: string): Promise<void> {
  const objUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(objUrl);
}

/**
 * Fetch a photo and trigger a browser download via an anchor click. Throws on
 * network failure (caller logs).
 */
export async function downloadPhotoBlob(url: string, filename: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const blob = await response.blob();
  await triggerBlobDownload(blob, filename);
}

/** Download a catalog photo by id through the attachment content route. */
export async function downloadPhotoById(photoId: number, filename: string): Promise<void> {
  await downloadPhotoBlob(`${photoContentUrl(photoId)}?download=1`, filename);
}

/** Open a ZIP download for multiple catalog photos (session + photos.view). */
export function downloadPhotoZip(photoIds: number[], title?: string): void {
  const url = buildPhotoZipDownloadUrl(photoIds, title);
  if (!url) return;
  triggerBrowserDownload(url);
}

/**
 * Delete a photo: remove the NAS-hosted original browser-direct over WebDAV
 * first (best-effort — a NAS failure still proceeds), then drop the DB row + any
 * Vercel-Blob files via the Vercel DELETE route. Throws if the DB delete fails.
 */
export async function deletePhoto(photoId: number, url: string | undefined): Promise<void> {
  if (url && isNasPhotoUrl(url)) {
    const nasDel = await deleteNasPhoto(url);
    if (!nasDel.ok) console.warn('NAS file delete failed:', nasDel.error);
  }
  const res = await fetch(`/api/photos/${photoId}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
}

/** Move a receiving photo's primary link to another PO (carton). */
export async function reassignPhotoToReceiving(
  photoId: number,
  receivingId: number,
): Promise<void> {
  const res = await fetch(`/api/photos/${photoId}/reassign`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entityType: 'RECEIVING', entityId: receivingId }),
  });
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(body?.error || `Reassign failed (${res.status})`);
}
