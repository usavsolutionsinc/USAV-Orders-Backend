'use client';

import { useEffect, useSyncExternalStore } from 'react';
import {
  blobToBase64DataUrl,
  downscaleImageTo720,
} from '@/lib/image/downscale';

/**
 * Module-singleton store for in-flight receiving photo uploads.
 *
 * Per-photo state machine:   queued → uploading → done | failed
 *                                                    ↑    ↓
 *                                                  retry  retry()
 *
 * Two persistence layers so receivers don't lose work:
 *   • blobCache (in-memory)  — original blob ref for the Retry button.
 *   • localStorage           — base64 of the DOWNSCALED blob + metadata for
 *                              every non-`done` entry. A tab refresh or a
 *                              backgrounded-then-killed tab rehydrates the
 *                              queue and auto-resumes anything in `queued`.
 *
 * Scope: pass `{ receivingId, receivingLineId? }`. When `receivingLineId` is
 * present the photo posts as an item-level (RECEIVING_LINE) record; otherwise
 * it lands at the PO level (RECEIVING).
 */

export type UploadState = 'queued' | 'uploading' | 'done' | 'failed';

export interface PhotoScope {
  receivingId: number;
  receivingLineId?: number | null;
  /**
   * Human PO reference (Zoho PO number / id) used ONLY to name the file
   * object — e.g. `4421__photo_….jpg` instead of `PO_1987__photo_….jpg`. Not
   * sent to the attach endpoint (that still keys off receivingId/receivingLineId).
   * Falls back to `PO_{receivingId}` when absent.
   */
  poRef?: string | null;
  /** One-based clean filename suffix for captured photos, e.g. PO123_3.jpg. */
  fileIndex?: number | null;
}

export interface UploadEntry {
  id: string;
  scope: PhotoScope;
  previewUrl: string;
  state: UploadState;
  photoId: number | null;
  photoUrl: string | null;
  error: string | null;
  originalBytes: number;
  finalBytes: number;
  createdAt: number;
}

interface QueueState {
  entries: UploadEntry[];
}

// ─── Storage shape ──────────────────────────────────────────────────────────
const STORAGE_KEY = 'usav.receiving.upload_queue.v1';
const STORAGE_VERSION = 1;
// Hard cap on persisted entries to keep localStorage well below the 5 MB
// per-origin quota even on cheap Android Chromes.
const STORAGE_MAX_ENTRIES = 20;

interface PersistedEntry {
  v: number;
  meta: Omit<UploadEntry, 'previewUrl'>;
  dataUrl: string; // downscaled JPEG as data URL
}

// ─── State + subscribers ────────────────────────────────────────────────────
// Fired once per photo the moment it's committed (GCS upload + DB attach both
// succeeded). The capture surface wires this to an Ably publish on
// `phone:{staffId}` so open photo strips and feed counts refresh — on this
// device AND the paired desktop — without the requestId camera flow. Set via
// configureNotifier(); persists across capture-surface unmounts so a photo that
// finishes uploading in the background still notifies.
export interface UploadNotice {
  receivingId: number;
  receivingLineId: number | null;
  photoId: number;
  photoUrl: string;
}
let uploadNotifier: ((notice: UploadNotice) => void) | null = null;

const state: QueueState = { entries: [] };
const listeners = new Set<() => void>();
// Original (post-downscale) blob ref so Retry doesn't re-prompt the user.
const blobCache = new Map<string, Blob>();
// Downscaled base64 form mirrored to localStorage on each persist.
const persistedDataUrls = new Map<string, string>();
let rehydrated = false;

function emit() {
  listeners.forEach((fn) => fn());
}

function patch(id: string, partial: Partial<UploadEntry>) {
  state.entries = state.entries.map((e) => (e.id === id ? { ...e, ...partial } : e));
  emit();
  persist();
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── localStorage mirror ────────────────────────────────────────────────────
function persist(): void {
  if (typeof window === 'undefined') return;
  try {
    // Only persist non-`done` entries — done photos are committed server-side
    // and don't need local replay.
    const items: PersistedEntry[] = [];
    for (const e of state.entries) {
      if (e.state === 'done') continue;
      const dataUrl = persistedDataUrls.get(e.id);
      if (!dataUrl) continue;
      const { previewUrl: _omit, ...meta } = e;
      items.push({ v: STORAGE_VERSION, meta, dataUrl });
    }
    if (items.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    // Newest first; cap so storage never blows up.
    const capped = items.slice(-STORAGE_MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
  } catch {
    // QuotaExceeded or storage disabled — fall back to in-memory only.
  }
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) return null;
    const bin = atob(match[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: match[1] });
  } catch {
    return null;
  }
}

function rehydrate(): void {
  if (rehydrated) return;
  rehydrated = true;
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    for (const item of parsed as PersistedEntry[]) {
      if (!item || item.v !== STORAGE_VERSION || !item.dataUrl || !item.meta) continue;
      const blob = dataUrlToBlob(item.dataUrl);
      if (!blob) continue;
      const previewUrl = URL.createObjectURL(blob);
      // Anything that was mid-upload before the refresh resets to queued so
      // it gets re-attempted; the photos endpoint is idempotent via the
      // (entity_type, entity_id, url) unique index — a duplicate POST just
      // returns 409 and we surface the failure cleanly.
      const restoredState: UploadState =
        item.meta.state === 'uploading' ? 'queued' : item.meta.state;
      const entry: UploadEntry = {
        ...item.meta,
        previewUrl,
        state: restoredState,
      };
      state.entries.push(entry);
      blobCache.set(entry.id, blob);
      persistedDataUrls.set(entry.id, item.dataUrl);
    }

    if (state.entries.length > 0) emit();

    // Resume anything that was queued before the refresh.
    for (const e of state.entries) {
      if (e.state !== 'queued') continue;
      const blob = blobCache.get(e.id);
      if (blob) void processEntry(e.id, blob);
    }
  } catch {
    // Corrupt entry — drop it and move on. Don't block the UI.
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
}

// ─── Upload pipeline ────────────────────────────────────────────────────────
async function postPhotoViaAdapter(
  entry: UploadEntry,
  blob: Blob,
): Promise<{ id: number; url: string }> {
  const entityType = entry.scope.receivingLineId != null ? 'RECEIVING_LINE' : 'RECEIVING';
  const entityId = entry.scope.receivingLineId ?? entry.scope.receivingId;
  const { uploadPhotoClient } = await import('@/lib/photos/upload-client');
  const result = await uploadPhotoClient({
    file: blob,
    entityType,
    entityId,
    photoType: entityType === 'RECEIVING_LINE' ? 'receiving_item' : 'receiving',
    poRef: entry.scope.poRef ?? undefined,
  });
  return { id: result.id, url: result.url };
}

async function postPhoto(
  entry: UploadEntry,
  blob: Blob,
): Promise<{ id: number; url: string }> {
  return postPhotoViaAdapter(entry, blob);
}

async function processEntry(id: string, blob: Blob): Promise<void> {
  patch(id, { state: 'uploading', error: null });
  try {
    const entry = state.entries.find((e) => e.id === id);
    if (!entry) return;
    const { id: photoId, url } = await postPhoto(entry, blob);
    patch(id, { state: 'done', photoId, photoUrl: url });
    // Announce the commit so strips + feed counts refresh (notifier publishes
    // `receiving_photo_uploaded` over Ably). Wrapped so a notifier error can
    // never fail an otherwise-successful upload.
    try {
      uploadNotifier?.({
        receivingId: entry.scope.receivingId,
        receivingLineId: entry.scope.receivingLineId ?? null,
        photoId,
        photoUrl: url,
      });
    } catch {
      /* notifier must never break the upload */
    }
    // done — clear localStorage row + drop blob cache (preview still rendered
    // from the existing object URL until the parent revokes it).
    persistedDataUrls.delete(id);
    persist();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'upload failed';
    patch(id, { state: 'failed', error: message });
  }
}

async function prepareAndUpload(id: string, rawBlob: Blob): Promise<void> {
  let blob = rawBlob;
  let finalBytes = rawBlob.size;
  try {
    const result = await downscaleImageTo720(rawBlob);
    blob = result.blob;
    finalBytes = result.finalBytes;
  } catch {
    // Fall through with the raw blob — never block a receiver on a downscale
    // problem.
  }
  blobCache.set(id, blob);
  patch(id, { finalBytes });

  // Mirror the downscaled blob to localStorage so a refresh can resume.
  try {
    const dataUrl = await blobToBase64DataUrl(blob);
    persistedDataUrls.set(id, dataUrl);
    persist();
  } catch {
    // Persistence is best-effort.
  }

  await processEntry(id, blob);
}

// ─── Public API ─────────────────────────────────────────────────────────────
export const photoUploadQueue = {
  /**
   * Register the post-upload notifier (e.g. an Ably publisher). Set by the
   * capture surface; intentionally NOT cleared on unmount so background
   * uploads that finish after navigation still fire it. Pass null to clear.
   */
  configureNotifier(fn: ((notice: UploadNotice) => void) | null) {
    uploadNotifier = fn;
  },
  enqueue(scope: PhotoScope, blob: Blob, previewUrl: string): string {
    rehydrate();
    const id = randomId();
    const entry: UploadEntry = {
      id,
      scope,
      previewUrl,
      state: 'queued',
      photoId: null,
      photoUrl: null,
      error: null,
      originalBytes: blob.size,
      finalBytes: 0,
      createdAt: Date.now(),
    };
    state.entries = [...state.entries, entry];
    blobCache.set(id, blob);
    emit();
    void prepareAndUpload(id, blob);
    return id;
  },
  retry(id: string) {
    const blob = blobCache.get(id);
    if (!blob) return;
    void processEntry(id, blob);
  },
  clearDone() {
    const remaining = state.entries.filter((e) => e.state !== 'done');
    state.entries.forEach((e) => {
      if (e.state === 'done') {
        try { URL.revokeObjectURL(e.previewUrl); } catch { /* ignore */ }
        blobCache.delete(e.id);
        persistedDataUrls.delete(e.id);
      }
    });
    state.entries = remaining;
    emit();
    persist();
  },
  clearAll() {
    state.entries.forEach((e) => {
      try { URL.revokeObjectURL(e.previewUrl); } catch { /* ignore */ }
    });
    blobCache.clear();
    persistedDataUrls.clear();
    state.entries = [];
    emit();
    if (typeof window !== 'undefined') {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  },
  subscribe(fn: () => void) {
    // Subscribe is also where useSyncExternalStore first runs in the browser;
    // a good safe place to rehydrate from localStorage.
    rehydrate();
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  snapshot() {
    return state.entries;
  },
};

export function useUploadQueue(scopeFilter?: PhotoScope): UploadEntry[] {
  const all = useSyncExternalStore(
    photoUploadQueue.subscribe,
    photoUploadQueue.snapshot,
    () => [] as UploadEntry[],
  );
  if (!scopeFilter) return all;
  return all.filter((e) => {
    if (e.scope.receivingId !== scopeFilter.receivingId) return false;
    const a = e.scope.receivingLineId ?? null;
    const b = scopeFilter.receivingLineId ?? null;
    return a === b;
  });
}

/**
 * Drop done entries from the queue when the parent unmounts the capture
 * screen. Keeps queued/uploading/failed visible across navigations so the
 * receiver can still retry a failed shot from the gallery later.
 */
export function useClearDoneOnUnmount() {
  useEffect(() => {
    return () => photoUploadQueue.clearDone();
  }, []);
}
