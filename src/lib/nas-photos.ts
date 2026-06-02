/**
 * Client helpers for the "Select from NAS" receiving photo picker.
 *
 * The app is hosted on Vercel (cloud); the NAS lives on the office LAN. A
 * Vercel API route can never reach the LAN, so the BROWSER talks to the NAS
 * file-server directly (see deploy/nas-photo-server). We read the nginx
 * `autoindex_format json` directory listing, let the receiver pick files, and
 * attach the chosen URLs through the existing /api/receiving-photos endpoint
 * (which already accepts a `photoUrl` instead of an uploaded blob).
 *
 * Internal-use only by design: the stored URL points at the LAN/HTTPS NAS, so
 * it renders only for browsers on the office network. That matches the
 * "internal only" viewing requirement.
 */

import type { PhotoScope } from '@/components/mobile/receiving/PhotoUploadQueue';

// Base URL of the NAS file server, e.g. "https://nas.usav.local" or, for local
// dev, "http://192.168.1.50:8088". No trailing slash.
const BASE = (process.env.NEXT_PUBLIC_NAS_PHOTOS_BASE_URL || '').replace(/\/+$/, '');

// Only web-renderable formats. HEIC (iPhone default) is intentionally excluded
// — Chrome/Android can't display it, and we attach by URL with no transcode.
// Configure the phones/NAS sync to export JPEG, or add a transcode step later.
const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;

export function nasConfigured(): boolean {
  return BASE.length > 0;
}

export interface NasEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  /** ISO-ish mtime string from nginx autoindex. */
  mtime?: string;
  /** Path relative to the NAS photos root, e.g. "2026-06/IMG_1.jpg". */
  relPath: string;
  /** Absolute URL used both to display the thumbnail and as the stored photoUrl. */
  url: string;
}

// Shape of one nginx `autoindex_format json` element.
interface RawEntry {
  name: string;
  type: string; // "file" | "directory"
  size?: number;
  mtime?: string;
}

function joinUrl(relPath: string): string {
  // Encode each segment but keep the slashes so nested folders resolve.
  const encoded = relPath.split('/').map(encodeURIComponent).join('/');
  return `${BASE}/${encoded}`;
}

/**
 * List one directory of the NAS photos tree. `relDir` is relative to the root
 * ("" for the top level). Returns directories first, then files newest-first.
 * Throws a receiver-friendly message on the common failure modes.
 */
export async function listNasDir(relDir: string): Promise<NasEntry[]> {
  if (!BASE) throw new Error('NAS photo server is not configured.');
  const clean = relDir.replace(/^\/+|\/+$/g, '');
  // autoindex only triggers on a trailing slash.
  const url = `${BASE}/${clean ? `${clean.split('/').map(encodeURIComponent).join('/')}/` : ''}`;

  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  } catch {
    // Network error, CORS rejection, or mixed-content block all land here.
    throw new Error(
      "Can't reach the NAS. Check you're on the office network, the file " +
        'server is running, and (on the live site) that it is served over HTTPS.',
    );
  }
  if (!res.ok) throw new Error(`NAS listing failed (HTTP ${res.status}).`);

  let raw: RawEntry[];
  try {
    raw = (await res.json()) as RawEntry[];
  } catch {
    throw new Error('NAS returned an unexpected response (is autoindex JSON enabled?).');
  }
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((e) => e && (e.type === 'directory' || IMAGE_RE.test(e.name)))
    .map<NasEntry>((e) => {
      const rel = clean ? `${clean}/${e.name}` : e.name;
      return {
        name: e.name,
        type: e.type === 'directory' ? 'directory' : 'file',
        size: e.size,
        mtime: e.mtime,
        relPath: rel,
        url: joinUrl(rel),
      };
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return (b.mtime || '').localeCompare(a.mtime || '');
    });
}

export interface AttachResult {
  url: string;
  ok: boolean;
  duplicate: boolean;
  error?: string;
}

/**
 * Attach one NAS file to a receiving package / line by URL. Reuses the existing
 * photos endpoint, so the photo then flows through every normal path (gallery,
 * Zendesk claim, delete). A 409 means it was already attached — treated as a
 * benign no-op so re-selecting the same shot doesn't error.
 *
 * Note: deleting such a photo later removes only the DB row — the original file
 * stays on the NAS (the delete route only purges Vercel Blob URLs).
 */
export async function attachNasPhoto(scope: PhotoScope, photoUrl: string): Promise<AttachResult> {
  let res: Response;
  try {
    res = await fetch('/api/receiving-photos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receivingId: scope.receivingId,
        receivingLineId: scope.receivingLineId ?? null,
        photoUrl,
      }),
    });
  } catch {
    return { url: photoUrl, ok: false, duplicate: false, error: 'network error' };
  }
  if (res.status === 409) return { url: photoUrl, ok: true, duplicate: true };
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    return { url: photoUrl, ok: false, duplicate: false, error: data?.error || `HTTP ${res.status}` };
  }
  return { url: photoUrl, ok: true, duplicate: false };
}
