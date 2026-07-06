'use client';

/**
 * Device-local "recently copied" history — the read side of the header
 * clipboard popover.
 *
 * Deliberately NOT in the database: a copy log is personal, ephemeral, and
 * per-device, and every CopyChip click would otherwise be a Neon write for no
 * benefit. It lives in memory (mirrored to localStorage so it survives a
 * reload) as a tiny framework-agnostic external store, fed from the single
 * copy choke-point in `useCopyChip` (so all chip copies are captured without
 * touching the ~245 call sites) plus `copyToClipboard` in utils/_dom.
 *
 * The persistent half — sending an entry to a coworker's inbox — is the
 * staff_messages table (see /api/staff-messages); this module only tracks what
 * THIS device copied.
 */

import { useSyncExternalStore } from 'react';

export interface ClipboardEntry {
  id: string;
  value: string;
  /** Chip tone the value came from (id/tracking/serial/sku/fnsku/ticket/seller_claim), if known. */
  kind?: string;
  /** Short label shown on the chip, if known (else the raw value is shown). */
  display?: string;
  /** receiving_claim_seller_messages.id — for inbox send + compact inbox display. */
  sellerMessageId?: number;
  /** Epoch ms when copied. */
  ts: number;
}

const MAX_ENTRIES = 20;
const STORAGE_KEY = 'usav-clipboard-history-v1';

let entries: ClipboardEntry[] = [];
let hydrated = false;
const listeners = new Set<() => void>();

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function hydrate(): void {
  if (hydrated || !isBrowser()) return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        entries = parsed
          .filter((e) => e && typeof e.value === 'string' && typeof e.ts === 'number')
          .slice(0, MAX_ENTRIES);
      }
    }
  } catch {
    /* corrupt payload — start clean */
  }
}

function persist(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* quota / privacy mode — history just won't survive reload */
  }
}

function emit(): void {
  for (const l of listeners) l();
}

function nextId(ts: number): string {
  return `clip-${ts}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Record a copy. No-ops on empty input. Collapses an immediate re-copy of the
 * same value (just bumps it to the top) so the list isn't spammed by double
 * clicks. Safe to call from any client event handler.
 */
export function recordCopy(
  value: string | null | undefined,
  meta?: {
    kind?: string;
    display?: string;
    sellerMessageId?: number;
  },
): void {
  if (!isBrowser()) return;
  const v = (value ?? '').trim();
  if (!v) return;
  hydrate();

  const ts = Date.now();
  // Drop any prior copy of the same value so the freshest wins (move-to-top).
  const deduped = entries.filter((e) => e.value !== v);
  const entry: ClipboardEntry = {
    id: nextId(ts),
    value: v,
    kind: meta?.kind,
    display: meta?.display,
    sellerMessageId: meta?.sellerMessageId,
    ts,
  };
  entries = [entry, ...deduped].slice(0, MAX_ENTRIES);
  persist();
  emit();
}

export function removeClipboardEntry(id: string): void {
  hydrate();
  const next = entries.filter((e) => e.id !== id);
  if (next.length === entries.length) return;
  entries = next;
  persist();
  emit();
}

export function clearClipboardHistory(): void {
  if (entries.length === 0) return;
  entries = [];
  persist();
  emit();
}

function subscribe(cb: () => void): () => void {
  hydrate();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): ClipboardEntry[] {
  hydrate();
  return entries;
}

// Stable empty array for the server snapshot so SSR doesn't tear.
const SERVER_SNAPSHOT: ClipboardEntry[] = [];

/** Reactive view of the device's recent copies, newest first. */
export function useClipboardHistory(): ClipboardEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
}
