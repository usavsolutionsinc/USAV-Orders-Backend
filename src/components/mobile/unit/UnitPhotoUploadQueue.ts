'use client';

import { useEffect, useSyncExternalStore } from 'react';
import {
  blobToBase64DataUrl,
  downscaleImageTo720,
} from '@/lib/image/downscale';
import { safeRandomUUID } from '@/lib/safe-uuid';
import { UNIT_TESTING_PHOTO_TYPE } from '@/lib/photos/types';

/**
 * Module-singleton store for in-flight SERIAL_UNIT testing-scan photo uploads —
 * the exact mirror of the receiving `photoUploadQueue`, in a fully separate
 * namespace (localStorage key `usav.unit.upload_queue.v1`, entityType
 * `SERIAL_UNIT`, photoType `testing_photo`). The packer scans a printed unit
 * label at the station → the phone captures photos → they upload here.
 * See docs/todo/packer-testing-photo-scan-timeline-plan.md.
 *
 * Per-photo state machine:   queued → uploading → done | failed
 * Two persistence layers (in-memory blob ref + localStorage base64) so a tab
 * refresh auto-resumes anything still `queued`.
 */

export type UploadState = 'queued' | 'uploading' | 'done' | 'failed';

export interface UnitPhotoScope {
  /** Canonical serial_units.id — the upload entityId. */
  serialUnitId: number;
  /** Resolvable unit key (serial / minted unit_uid) — files the GCS object path. */
  unitKey?: string | null;
  /** One-based clean filename suffix for captured photos. */
  fileIndex?: number | null;
}

export interface UnitUploadEntry {
  id: string;
  scope: UnitPhotoScope;
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
  entries: UnitUploadEntry[];
}

// ─── Storage shape ──────────────────────────────────────────────────────────
const STORAGE_KEY = 'usav.unit.upload_queue.v1';
const STORAGE_VERSION = 1;
const STORAGE_MAX_ENTRIES = 20;

interface PersistedEntry {
  v: number;
  meta: Omit<UnitUploadEntry, 'previewUrl'>;
  dataUrl: string;
}

// ─── State + subscribers ────────────────────────────────────────────────────
// Fired once per photo the moment it commits (GCS upload + DB link both ok).
// The capture surface wires this to an Ably `unit_photo_uploaded` publish on
// `phone:{staffId}` so the desktop refreshes. Persists across unmounts.
export interface UnitUploadNotice {
  serialUnitId: number;
  photoId: number;
  photoUrl: string;
}
let uploadNotifier: ((notice: UnitUploadNotice) => void) | null = null;

const state: QueueState = { entries: [] };
const listeners = new Set<() => void>();
const blobCache = new Map<string, Blob>();
const persistedDataUrls = new Map<string, string>();
let rehydrated = false;

function emit() {
  listeners.forEach((fn) => fn());
}

function patch(id: string, partial: Partial<UnitUploadEntry>) {
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
      const entry: UnitUploadEntry = { ...item.meta, previewUrl, state: restoredState };
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
  entry: UnitUploadEntry,
  blob: Blob,
): Promise<{ id: number; url: string }> {
  const { uploadPhotoClient } = await import('@/lib/photos/upload-client');
  const result = await uploadPhotoClient({
    file: blob,
    entityType: 'SERIAL_UNIT',
    entityId: entry.scope.serialUnitId,
    photoType: UNIT_TESTING_PHOTO_TYPE,
    poRef: entry.scope.unitKey ?? undefined,
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
        serialUnitId: entry.scope.serialUnitId,
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
    // Never block a capture on a downscale problem.
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
export const unitPhotoUploadQueue = {
  configureNotifier(fn: ((notice: UnitUploadNotice) => void) | null) {
    uploadNotifier = fn;
  },
  enqueue(scope: UnitPhotoScope, blob: Blob, previewUrl: string): string {
    rehydrate();
    const id = randomId();
    const entry: UnitUploadEntry = {
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

const EMPTY_ENTRIES: UnitUploadEntry[] = [];
const getServerSnapshot = (): UnitUploadEntry[] => EMPTY_ENTRIES;

export function useUnitUploadQueue(serialUnitId?: number): UnitUploadEntry[] {
  const all = useSyncExternalStore(
    unitPhotoUploadQueue.subscribe,
    unitPhotoUploadQueue.snapshot,
    getServerSnapshot,
  );
  if (serialUnitId == null) return all;
  return all.filter((e) => e.scope.serialUnitId === serialUnitId);
}

/** Drop done entries when the capture screen unmounts (keep queued/failed). */
export function useClearDoneUnitUploadsOnUnmount() {
  useEffect(() => {
    return () => unitPhotoUploadQueue.clearDone();
  }, []);
}
