/**
 * ZIP entry / download-filename sanitization for macOS Archive Utility and
 * Windows Explorer. Keeps names ASCII + path-safe so extractors don't mangle
 * UTF-8 bit 11 names or hit reserved device names / trailing dots.
 */

/** Windows reserved device basenames (case-insensitive, with or without extension). */
const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/**
 * Flatten to a single-segment ASCII filename safe for ZIP extractors on
 * macOS + Windows (no path separators, reserved names, trailing dots/spaces).
 */
export function safeZipEntryName(base: string, fallback: string): string {
  const raw = (base || '').trim() || fallback;
  // Strip directories; ZIP always uses `/`, but Windows extractors choke on `\`.
  const leaf = raw.replace(/\\/g, '/').split('/').pop() || fallback;
  let cleaned = leaf
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[.\s_]+|[.\s_]+$/g, '');

  const stem = cleaned.replace(/\.[^.]+$/, '');
  if (!cleaned || WINDOWS_RESERVED.has(stem.toUpperCase()) || WINDOWS_RESERVED.has(cleaned.toUpperCase())) {
    cleaned = (fallback || 'file').replace(/[^\w.-]+/g, '_') || 'file';
  }

  // Windows forbids trailing dots/spaces even after sanitization.
  cleaned = cleaned.replace(/[. ]+$/g, '');
  return cleaned || 'file';
}

/** ASCII-safe archive title for Content-Disposition + blob download filename. */
export function safeZipDownloadBasename(title: string | null | undefined, fallback = 'photos'): string {
  const cleaned = (title || fallback)
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[.\s_]+|[.\s_]+$/g, '')
    .slice(0, 40);
  return cleaned || fallback;
}

/**
 * Ensure every entry name is unique inside the archive. Windows Explorer
 * silently overwrites duplicates on extract; numbering avoids data loss.
 */
export function uniquifyZipEntryNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    if (count === 0) return name;
    const dot = name.lastIndexOf('.');
    if (dot > 0) {
      return `${name.slice(0, dot)}_${count + 1}${name.slice(dot)}`;
    }
    return `${name}_${count + 1}`;
  });
}

/** Shared response headers for application/zip downloads (Windows + macOS). */
export function zipAttachmentHeaders(filenameBasename: string, byteLength: number): HeadersInit {
  const safe = safeZipDownloadBasename(filenameBasename, 'download');
  const filename = safe.toLowerCase().endsWith('.zip') ? safe : `${safe}.zip`;
  return {
    'content-type': 'application/zip',
    // Content-Length lets Windows Explorer finish the file before extract.
    'content-length': String(byteLength),
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store',
  };
}
