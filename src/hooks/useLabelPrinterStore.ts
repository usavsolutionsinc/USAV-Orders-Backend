'use client';

/**
 * Shared state for the bin- and rack-label printers.
 *
 * Two surfaces render the picker now — the main pane (mobile, full
 * layout) and the sidebar (desktop-only, compact). Both have to stay in
 * lock-step. Rather than hoist a React Context above the warehouse page
 * (which would cross the dashboard-sidebar mount boundary), we keep one
 * store backed by localStorage + a window CustomEvent. Each writer
 * dispatches the event; every reader is subscribed via
 * useSyncExternalStore. localStorage carries the value across reloads;
 * the event carries the value across components in the same tab.
 *
 * If you add a third surface (e.g. a barcode-scan handler that pre-fills
 * the form) just call `setLabelPrinterState({...})` from it.
 */

import { useSyncExternalStore } from 'react';

const LABEL_KEY = 'binPrinter.state.v4';
const RACK_KEY = 'rackPrinter.state.v1';
const LABEL_EVENT = 'labelPrinter:state-changed';
const RACK_EVENT = 'rackPrinter:state-changed';

export interface LabelPrinterState {
  room?: string;
  aisle?: number;
  bay?: number;
  level?: number;
  position?: number;
}

export interface RackPrinterState {
  room?: string;
  aisle?: number;
  bay?: number;
  level?: number;
}

// ─── Generic store factory ────────────────────────────────────────────────

function readJson<T extends object>(key: string): T {
  if (typeof window === 'undefined') return {} as T;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

function writeJson<T extends object>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

function createStore<T extends object>(key: string, eventName: string) {
  // Cache the parsed snapshot so useSyncExternalStore sees a stable
  // reference between renders (required to avoid infinite loops).
  let cached: T = {} as T;
  let cachedReady = false;

  function refreshCache(): T {
    cached = readJson<T>(key);
    cachedReady = true;
    return cached;
  }

  function getSnapshot(): T {
    if (!cachedReady) refreshCache();
    return cached;
  }

  function getServerSnapshot(): T {
    return {} as T;
  }

  function subscribe(cb: () => void): () => void {
    const handler = () => {
      refreshCache();
      cb();
    };
    const storageHandler = (e: StorageEvent) => {
      if (e.key === key) handler();
    };
    window.addEventListener(eventName, handler);
    window.addEventListener('storage', storageHandler);
    return () => {
      window.removeEventListener(eventName, handler);
      window.removeEventListener('storage', storageHandler);
    };
  }

  function setState(next: T | ((prev: T) => T)): void {
    const prev = getSnapshot();
    const value = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
    writeJson(key, value);
    refreshCache();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(eventName));
    }
  }

  function patch(partial: Partial<T>): void {
    setState((prev) => ({ ...prev, ...partial }));
  }

  function reset(): void {
    setState({} as T);
  }

  return { getSnapshot, getServerSnapshot, subscribe, setState, patch, reset };
}

// ─── Label printer store ──────────────────────────────────────────────────

const labelStore = createStore<LabelPrinterState>(LABEL_KEY, LABEL_EVENT);

export function useLabelPrinterStore(): LabelPrinterState {
  return useSyncExternalStore(
    labelStore.subscribe,
    labelStore.getSnapshot,
    labelStore.getServerSnapshot,
  );
}

export const setLabelPrinterState = labelStore.setState;
export const patchLabelPrinterState = labelStore.patch;
export const resetLabelPrinterState = labelStore.reset;

// ─── Rack printer store ───────────────────────────────────────────────────

const rackStore = createStore<RackPrinterState>(RACK_KEY, RACK_EVENT);

export function useRackPrinterStore(): RackPrinterState {
  return useSyncExternalStore(
    rackStore.subscribe,
    rackStore.getSnapshot,
    rackStore.getServerSnapshot,
  );
}

export const setRackPrinterState = rackStore.setState;
export const patchRackPrinterState = rackStore.patch;
export const resetRackPrinterState = rackStore.reset;
