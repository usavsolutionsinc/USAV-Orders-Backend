import { deleteNasPhoto, isNasPhotoUrl } from '@/lib/nas-photos';
import { photoContentUrl } from '@/lib/photos/display-url';
import { buildPhotoZipDownloadUrl, triggerBrowserDownload } from '@/lib/photos/download-zip';
import { safeZipDownloadBasename } from '@/lib/zip/safe-entry-name';

async function triggerBlobDownload(blob: Blob, filename: string): Promise<void> {
  const objUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = filename;
  // Edge/Chrome on Windows can cancel downloads if the object URL is revoked
  // synchronously after click(); give the download manager a beat to attach.
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => window.URL.revokeObjectURL(objUrl), 60_000);
}

function contentDispositionFilename(header: string | null): string | null {
  if (!header) return null;

  // RFC 5987 filename*: attachment; filename*=UTF-8''foo.zip
  const filenameStar = header.match(/filename\*\s*=\s*([^;]+)/i)?.[1]?.trim();
  if (filenameStar) {
    const value = filenameStar.replace(/^UTF-8''/i, '').replace(/^"(.*)"$/, '$1');
    try {
      return decodeURIComponent(value);
    } catch {
      // fall through
    }
  }

  // Basic filename="foo.zip" or filename=foo.zip
  const filename = header.match(/filename\s*=\s*([^;]+)/i)?.[1]?.trim();
  if (!filename) return null;
  return filename.replace(/^"(.*)"$/, '$1');
}

async function downloadZipViaFetch(url: string, fallbackFilename: string): Promise<void> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg =
      body && typeof body === 'object' && 'error' in body && typeof (body as any).error === 'string'
        ? (body as any).error
        : `Download failed (${res.status})`;
    throw new Error(msg);
  }

  // Force a real binary Blob so Edge/IE markup sniffing can't treat the zip as text.
  const bytes = await res.arrayBuffer();
  const sig = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
  const isZip = sig.length >= 2 && sig[0] === 0x50 && sig[1] === 0x4b; // "PK"
  if (!isZip) {
    throw new Error('Download did not return a valid ZIP file');
  }

  const blob = new Blob([bytes], { type: 'application/zip' });
  const headerName = contentDispositionFilename(res.headers.get('content-disposition'));
  const filename =
    headerName && headerName.toLowerCase().endsWith('.zip') ? headerName : fallbackFilename;
  await triggerBlobDownload(blob, filename);
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
  const safeTitle = safeZipDownloadBasename(title, 'photos');
  void downloadZipViaFetch(url, `${safeTitle}.zip`).catch((err) => {
    // Fallback to navigation-based download if fetch is blocked (e.g. older
    // browser policy). The fetched-path is preferred because it guarantees we
    // received real ZIP bytes (not JSON/HTML) before saving a .zip.
    console.warn('ZIP fetch download failed; falling back to navigation:', err);
    triggerBrowserDownload(url);
  });
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
