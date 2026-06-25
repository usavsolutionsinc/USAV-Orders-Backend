'use client';

import { useEffect, useSyncExternalStore } from 'react';
import {
  blobToBase64DataUrl,
  downscaleImageTo720,
} from '@/lib/image/downscale';
import { safeRandomUUID } from '@/lib/safe-uuid';

/**
 * Module-singleton store for in-flight PACKER photo uploads — the packing
 * mirror of `receiving/PhotoUploadQueue.ts`. Kept as a separate singleton (own
 * localStorage key, own notifier) so it never shares state with the receiving
 * queue and the "perfect" receiving path stays untouched.
 *
 * Per-photo state machine:   queued → uploading → done | failed
 *
 * Two persistence layers so packers don't lose work:
 *   • blobCache (in-memory)  — original blob ref for the Retry button.
 *   • localStorage           — base64 of the DOWNSCALED blob + metadata for
 *                              every non-`done` entry; a refresh auto-resumes.
 */

export type UploadState = 'queued' | 'uploading' | 'done' | 'failed';

export interface PackerPhotoScope {
  /** packer_logs.id the photo binds to. */
  packerLogId: number;
  /** Human order number — used as poRef so the library files it by order. */
  orderId?: string | null;
  /** One-based clean filename suffix, e.g. ORDER123_3.jpg. */
  fileIndex?: number | null;
}

export interface UploadEntry {
  id: string;
  scope: PackerPhotoScope;
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
const STORAGE_KEY = 'usav.packer.upload_queue.v1';
const STORAGE_VERSION = 1;
const STORAGE_MAX_ENTRIES = 20;

interface PersistedEntry {
  v: number;
  meta: Omit<UploadEntry, 'previewUrl'>;
  dataUrl: string;
}

// ─── State + subscribers ────────────────────────────────────────────────────
// Fired once per photo the moment it commits (GCS upload + DB attach both
// succeeded). The capture surface wires this to local query invalidation; the
// cross-device live refresh comes from the server `packer-photo.changed` Ably
// publish on /api/photos/upload. Set via configureNotifier(); persists across
// capture-surface unmounts so background uploads still notify.
export interface UploadNotice {
  packerLogId: number;
  orderId: string | null;
  photoId: number;
  photoUrl: string;
}
let uploadNotifier: ((notice: UploadNotice) => void) | null = null;

const state: QueueState = { entries: [] };
const listeners = new Set<() => void>();
const blobCache = new Map<string, Blob>();
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
  return safeRandomUUID();
}

// ─── localStorage mirror ────────────────────────────────────────────────────
function persist(): void {
  if (typeof window === 'undefined') return;
  try {
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
      const restoredState: UploadState =
        item.meta.state === 'uploading' ? 'queued' : item.meta.state;
      const entry: UploadEntry = { ...item.meta, previewUrl, state: restoredState };
      state.entries.push(entry);
      blobCache.set(entry.id, blob);
      persistedDataUrls.set(entry.id, item.dataUrl);
    }

    if (state.entries.length > 0) emit();

    for (const e of state.entries) {
      if (e.state !== 'queued') continue;
      const blob = blobCache.get(e.id);
      if (blob) void processEntry(e.id, blob);
    }
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
}

// ─── Upload pipeline ────────────────────────────────────────────────────────
async function postPhoto(
  entry: UploadEntry,
  blob: Blob,
): Promise<{ id: number; url: string }> {
  const { uploadPhotoClient } = await import('@/lib/photos/upload-client');
  const result = await uploadPhotoClient({
    file: blob,
    entityType: 'PACKER_LOG',
    entityId: entry.scope.packerLogId,
    photoType: 'packer_photo',
    poRef: entry.scope.orderId ?? undefined,
  });
  return { id: result.id, url: result.url };
}

async function processEntry(id: string, blob: Blob): Promise<void> {
  patch(id, { state: 'uploading', error: null });
  try {
    const entry = state.entries.find((e) => e.id === id);
    if (!entry) return;
    const { id: photoId, url } = await postPhoto(entry, blob);
    patch(id, { state: 'done', photoId, photoUrl: url });
    try {
      uploadNotifier?.({
        packerLogId: entry.scope.packerLogId,
        orderId: entry.scope.orderId ?? null,
        photoId,
        photoUrl: url,
      });
    } catch {
      /* notifier must never break the upload */
    }
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
    // Never block a packer on a downscale problem.
  }
  blobCache.set(id, blob);
  patch(id, { finalBytes });

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
export const packerPhotoUploadQueue = {
  configureNotifier(fn: ((notice: UploadNotice) => void) | null) {
    uploadNotifier = fn;
  },
  enqueue(scope: PackerPhotoScope, blob: Blob, previewUrl: string): string {
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
    rehydrate();
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  snapshot() {
    return state.entries;
  },
};

export function usePackerUploadQueue(packerLogId?: number): UploadEntry[] {
  const all = useSyncExternalStore(
    packerPhotoUploadQueue.subscribe,
    packerPhotoUploadQueue.snapshot,
    () => [] as UploadEntry[],
  );
  if (packerLogId == null) return all;
  return all.filter((e) => e.scope.packerLogId === packerLogId);
}

/** Drop done entries when the capture screen unmounts (mirrors receiving). */
export function useClearPackerDoneOnUnmount() {
  useEffect(() => {
    return () => packerPhotoUploadQueue.clearDone();
  }, []);
}
