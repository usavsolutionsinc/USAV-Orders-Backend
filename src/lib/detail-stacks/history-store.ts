'use client';

/**
 * Recent-detail-stacks history — a tiny module-level store (subscribe/emit +
 * localStorage), the same shape as src/lib/assistant/context-store.ts. Records
 * the detail-stack slide-overs the operator has opened so the context rail can
 * list them for one-click re-open. Shared across the rail, the panel section,
 * and the URL tracker via useSyncExternalStore, so a record from the tracker
 * repaints the rail immediately.
 */

import type { DetailStackKind } from './registry';

export interface DetailStackEntry {
  kind: DetailStackKind;
  id: string;
  label: string;
  /** pathname the stack was opened from (used to navigate back to re-open). */
  path: string;
  /** search string at open time (minus nothing — detailStackHref swaps the open param). */
  search?: string;
  at: number;
}

const STORAGE_KEY = 'assistant:recent-detail-stacks';
const MAX = 8;
const EMPTY: DetailStackEntry[] = [];

let entries: DetailStackEntry[] = EMPTY;
let hydrated = false;
const listeners = new Set<() => void>();

function key(e: { kind: string; id: string }): string {
  return `${e.kind}:${e.id}`;
}

function isEntry(v: unknown): v is DetailStackEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.kind === 'string' &&
    typeof e.id === 'string' &&
    typeof e.label === 'string' &&
    typeof e.path === 'string' &&
    typeof e.at === 'number'
  );
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) entries = parsed.filter(isEntry).slice(0, MAX);
  } catch {
    /* corrupt / unavailable storage — start empty */
  }
}

function persist(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* ignore quota / private-mode failures */
  }
}

function emit(): void {
  listeners.forEach((l) => l());
}

export function subscribeDetailStacks(fn: () => void): () => void {
  hydrate();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Client snapshot — stable reference between mutations (useSyncExternalStore-safe). */
export function getDetailStacks(): DetailStackEntry[] {
  return entries;
}

/** Server snapshot — always the stable empty array (nothing to hydrate on the server). */
export function getDetailStacksServerSnapshot(): DetailStackEntry[] {
  return EMPTY;
}

/** Record (or move-to-front) an opened detail stack. */
export function recordDetailStack(entry: Omit<DetailStackEntry, 'at'> & { at?: number }): void {
  hydrate();
  const at = entry.at ?? Date.now();
  const k = key(entry);
  const head: DetailStackEntry = {
    kind: entry.kind,
    id: entry.id,
    label: entry.label,
    path: entry.path,
    search: entry.search,
    at,
  };
  // No-op if the head is already this exact entry (avoids a write+repaint loop
  // when an unrelated param changes while the open param persists).
  if (
    entries[0] &&
    key(entries[0]) === k &&
    entries[0].path === head.path &&
    entries[0].search === head.search
  ) {
    return;
  }
  entries = [head, ...entries.filter((e) => key(e) !== k)].slice(0, MAX);
  persist();
  emit();
}

export function removeDetailStack(kind: DetailStackKind, id: string): void {
  hydrate();
  const next = entries.filter((e) => !(e.kind === kind && e.id === id));
  if (next.length === entries.length) return;
  entries = next;
  persist();
  emit();
}
