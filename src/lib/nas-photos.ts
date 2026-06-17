/**
 * Client helpers for receiving NAS photos (picker + capture upload).
 *
 * Production: the browser talks only to the same-origin `/api/nas` proxy; Vercel
 * forwards read/write to the office NAS Media Agent (Synology share mounted at
 * `/Volumes/USAV Media` on the tunnel Mac). Local dev may use `/api/nas-dev`
 * against a mounted share.
 *
 * Attach flows store the resulting URL on the `photos` table via
 * POST /api/receiving-photos — no bytes through Vercel.
 */

import type { PhotoScope } from '@/components/mobile/receiving/PhotoUploadQueue';
import {
  isSameOriginNasProxyUrl,
  normalizePhotoDisplayUrl,
} from '@/lib/nas-photo-url';

export { normalizePhotoDisplayUrl, isSameOriginNasProxyUrl };

// Base URL of the NAS file server, e.g. "https://nas.usav.local" or, for local
// dev, "http://192.168.1.50:8088" / "/api/nas-dev". No trailing slash.
//
// This used to be a build-time constant from NEXT_PUBLIC_NAS_PHOTOS_BASE_URL.
// It's now a RUNTIME value so an admin can flip between a test and a production
// NAS without a rebuild: the active URL comes from org settings via
// GET /api/nas-config and is pushed in with `setNasBaseUrl()` (see
// `useEnsureNasConfig`). The env var is kept only as an initial dev seed.
let runtimeBase = (process.env.NEXT_PUBLIC_NAS_PHOTOS_BASE_URL || '').replace(/\/+$/, '');

/** Same-origin proxy the browser should PUT/list through. */
export function getClientNasProxyBase(): string {
  if (process.env.NODE_ENV !== 'production') return '/api/nas-dev';
  return getNasBaseUrl() || '/api/nas';
}

export function setNasBaseUrl(url: string | null | undefined): void {
  runtimeBase = (url || '').replace(/\/+$/, '');
}

export function getNasBaseUrl(): string {
  return runtimeBase;
}

// Only web-renderable formats. HEIC (iPhone default) is intentionally excluded
// — Chrome/Android can't display it, and we attach by URL with no transcode.
// Configure the phones/NAS sync to export JPEG, or add a transcode step later.
const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;

export function nasConfigured(): boolean {
  return getNasBaseUrl().length > 0;
}

/**
 * True when `url` points at the NAS file server (so a delete must go
 * browser-direct over WebDAV — the Vercel API route can't reach the LAN).
 * Excludes Vercel Blob URLs (those are deleted server-side) and matches both
 * the configured absolute base and the local dev proxy path.
 */
export function isNasPhotoUrl(url: string): boolean {
  if (!url) return false;
  if (/vercel-storage\.com|blob\.vercel-storage/.test(url)) return false;
  const base = getNasBaseUrl();
  if (base && url.startsWith(base)) return true;
  // Same-origin proxy paths: the prod /api/nas CRUD proxy and the dev mount proxy.
  return url.startsWith('/api/nas-dev') || url.startsWith('/api/nas');
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

// One directory entry from the NAS file server. We accept either format:
//   • Caddy `file_server browse` (Accept: application/json): { name, size,
//     is_dir, mod_time, ... }
//   • nginx `autoindex_format json`: { name, type, size, mtime }
interface RawEntry {
  name: string;
  size?: number;
  // nginx
  type?: string; // "file" | "directory"
  mtime?: string;
  // Caddy
  is_dir?: boolean;
  mod_time?: string;
}

function rawIsDir(e: RawEntry): boolean {
  return e.is_dir === true || e.type === 'directory';
}
function rawMtime(e: RawEntry): string | undefined {
  return e.mod_time ?? e.mtime;
}

function joinUrl(relPath: string): string {
  // Encode each segment but keep the slashes so nested folders resolve.
  const encoded = relPath.split('/').map(encodeURIComponent).join('/');
  return `${getNasBaseUrl()}/${encoded}`;
}

/**
 * List one directory of the NAS photos tree. `relDir` is relative to the root
 * ("" for the top level). Returns directories first, then files newest-first.
 * Throws a receiver-friendly message on the common failure modes.
 */
export async function listNasDir(relDir: string): Promise<NasEntry[]> {
  const base = getNasBaseUrl();
  if (!base) throw new Error('NAS photo server is not configured.');
  const clean = relDir.replace(/^\/+|\/+$/g, '');
  // autoindex only triggers on a trailing slash.
  const url = `${base}/${clean ? `${clean.split('/').map(encodeURIComponent).join('/')}/` : ''}`;

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
    .filter((e) => e && (rawIsDir(e) || IMAGE_RE.test(e.name)))
    .map<NasEntry>((e) => {
      const rel = clean ? `${clean}/${e.name}` : e.name;
      return {
        name: e.name,
        type: rawIsDir(e) ? 'directory' : 'file',
        size: e.size,
        mtime: rawMtime(e),
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
  /** photos.id of the created/looked-up row, when the endpoint returned it. */
  photoId?: number | null;
  error?: string;
}

/**
 * Attach one NAS file to a receiving package / line by URL. Reuses the existing
 * photos endpoint, so the photo then flows through every normal path (gallery,
 * Zendesk claim, delete). A 409 means it was already attached — treated as a
 * benign no-op so re-selecting the same shot doesn't error.
 *
 * Deleting such a photo removes BOTH the DB row (DELETE /api/photos/[id]) and
 * the original NAS file (browser-direct {@link deleteNasPhoto}, mirroring the
 * capture PUT so the operator's Cloudflare Access cookie rides along).
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
  const data = await res.json().catch(() => null);
  const photoId = Number(data?.photo?.id ?? data?.id ?? 0) || null;
  return { url: photoUrl, ok: true, duplicate: false, photoId };
}

/**
 * Build the NAS destination URL for a freshly captured receiving photo. The PO
 * (and line) is encoded into the FILENAME, written flat into the operator's
 * configured folder — NOT a per-PO subfolder. WebDAV `PUT` returns 409 when the
 * parent collection doesn't exist (it won't auto-create `PO_123/`), so a flat
 * name keeps writes working against a plain WebDAV server and the dev proxy
 * alike, while still grouping by PO when a human sorts the folder by name:
 *   {baseUrl}/{folder}/{poPart}[_L{lineId}]__{filename}
 * `poPart` is the human PO number (`scope.poRef`, e.g. "4421") when known, else
 * the internal `PO_{receivingId}` — so the saved filename leads with the PO#.
 * `filename` is derived from a stable per-capture id, so a Retry overwrites the
 * same path (idempotent) instead of littering duplicates.
 */
export function buildNasPhotoUrl(opts: {
  baseUrl: string;
  folder: string;
  scope: PhotoScope;
  filename: string;
}): string {
  const { baseUrl, folder, scope, filename } = opts;
  // Prefer the human PO# for the filename; sanitise to filename-safe chars and
  // fall back to the internal package id if it's missing or sanitises to empty.
  const sanitizedPo = (scope.poRef ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const poPart = sanitizedPo || `PO_${scope.receivingId}`;
  const prefix =
    scope.receivingLineId != null
      ? `${poPart}_L${scope.receivingLineId}__`
      : `${poPart}__`;
  const segments: string[] = [];
  const cleanFolder = (folder || '').replace(/^\/+|\/+$/g, '');
  if (cleanFolder) segments.push(...cleanFolder.split('/'));
  segments.push(`${prefix}${filename}`);
  const encoded = segments.map(encodeURIComponent).join('/');
  return `${baseUrl.replace(/\/+$/, '')}/${encoded}`;
}

/**
 * Destination URL for an outbound shipping LABEL on the NAS. Mirrors
 * {@link buildNasPhotoUrl} but writes a FLAT `LABEL_<orderRef>__<filename>` into
 * the configured folder (no `labels/` subdir — plain WebDAV PUT 409s when a
 * parent collection is missing, the same constraint receiving photos hit). The
 * `LABEL_` prefix keeps labels eyeball-distinct from photos in the same share.
 */
export function buildNasLabelUrl(opts: {
  baseUrl: string;
  folder: string;
  orderRef: string;
  filename: string;
}): string {
  const { baseUrl, folder, orderRef, filename } = opts;
  const sanitized = (orderRef ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const prefix = `LABEL_${sanitized || 'order'}__`;
  const segments: string[] = [];
  const cleanFolder = (folder || '').replace(/^\/+|\/+$/g, '');
  if (cleanFolder) segments.push(...cleanFolder.split('/'));
  segments.push(`${prefix}${filename}`);
  const encoded = segments.map(encodeURIComponent).join('/');
  return `${baseUrl.replace(/\/+$/, '')}/${encoded}`;
}

export interface PutResult {
  ok: boolean;
  /** Canonical URL the file now lives at — store this as the photoUrl. */
  url: string;
  error?: string;
}

/**
 * Write one captured photo straight to the NAS over WebDAV (HTTP PUT). The app
 * is Vercel-hosted and can't reach the LAN, so the BROWSER does this PUT against
 * the Cloudflare-fronted NAS endpoint. `credentials: 'include'` lets a Cloudflare
 * Access cookie ride along when the endpoint is protected.
 *
 * The NAS file server must allow PUT for this path and answer the CORS preflight
 * (Access-Control-Allow-Methods: PUT, Allow-Origin: <app origin>) — see the
 * deploy notes. Returns the destination URL on success so the caller can attach
 * it to the receiving row.
 */
export async function putNasPhoto(url: string, blob: Blob): Promise<PutResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': blob.type || 'image/jpeg' },
      credentials: 'include',
      cache: 'no-store',
    });
  } catch {
    // Network error, CORS rejection, or mixed-content block all land here.
    return {
      ok: false,
      url,
      error:
        "Can't reach the NAS to save the photo. Check you're on the office " +
        'network and the NAS is reachable (and served over HTTPS on the live site).',
    };
  }
  // 200/201 (created) and 204 (overwritten) are all success for WebDAV PUT.
  if (res.ok || res.status === 201 || res.status === 204) return { ok: true, url };
  return { ok: false, url, error: `NAS write failed (HTTP ${res.status}).` };
}

/**
 * Delete one photo file from the NAS over WebDAV (HTTP DELETE), browser-direct
 * — mirroring the capture upload PUT. Going through the browser (not the Vercel
 * route) lets the operator's Cloudflare Access cookie ride along via
 * credentials:'include', exactly like the PUT. Call this alongside
 * DELETE /api/photos/[id] (which only removes the DB row + Vercel-Blob
 * originals) so the NAS file isn't orphaned.
 *
 * Requires the NAS Caddy to route the DELETE verb to its webdav module — see
 * deploy/nas-photo-server/Caddyfile (PUT + DELETE → webdav). A 404 is treated as
 * success — the file's already gone, which is the goal.
 */
export async function deleteNasPhoto(url: string): Promise<{ ok: boolean; error?: string }> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'DELETE', credentials: 'include', cache: 'no-store' });
  } catch {
    return {
      ok: false,
      error:
        "Can't reach the NAS to delete the photo. Check you're on the office " +
        'network and the NAS is reachable.',
    };
  }
  // 200/202/204 = deleted; 404 = already gone — both mean the file is no longer there.
  if (res.ok || res.status === 204 || res.status === 404) return { ok: true };
  return { ok: false, error: `NAS delete failed (HTTP ${res.status}).` };
}
