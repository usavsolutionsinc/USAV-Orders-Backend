import { deleteNasPhoto, isNasPhotoUrl } from '@/lib/nas-photos';

/**
 * Fetch a photo and trigger a browser download via an anchor click. Throws on
 * network failure (caller logs).
 */
export async function downloadPhotoBlob(url: string, filename: string): Promise<void> {
  const response = await fetch(url);
  const blob = await response.blob();
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
