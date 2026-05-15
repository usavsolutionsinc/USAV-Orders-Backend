'use client';

/**
 * Offline write queue.
 *
 * Goal: a tap-Confirm on the Numpad sheet must "land" even when the receiver
 * is mid-aisle with no signal. Each mutating request is enqueued in IndexedDB
 * with its idempotency key; the queue drains the moment connectivity returns.
 *
 * Safety: P1-1.1 already makes every mutating endpoint idempotent on
 * `Idempotency-Key`, so a queued request replaying after the server already
 * processed an in-flight copy returns the cached response, not a double-apply.
 *
 * Scope: covers POST/PATCH/DELETE calls submitted via `queueOrFetch()`.
 * GETs are not queued — they're served from the SW's `NetworkFirst` cache
 * (already configured in next.config.ts).
 */

import { errorFeedback, successFeedback } from '@/lib/feedback/confirm';

// ─── IndexedDB shim (tiny, deps-free) ──────────────────────────────────────

const DB_NAME = 'usav-offline-queue';
const STORE = 'requests';
const DB_VERSION = 1;

interface QueuedRequest {
  id: string;
  url: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  headers: Record<string, string>;
  body: string;
  idempotencyKey: string;
  attempts: number;
  enqueuedAt: number;
  /** Last error message — surfaced in the OfflineBanner badge. */
  lastError?: string | null;
}

function openDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T | null> {
  const db = await openDB();
  if (!db) return null;
  return new Promise<T | null>((resolve) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const r = fn(store);
    if (r instanceof IDBRequest) {
      r.onsuccess = () => resolve(r.result as T);
      r.onerror = () => resolve(null);
    } else {
      r.then(resolve).catch(() => resolve(null));
    }
  });
}

async function putRecord(record: QueuedRequest): Promise<void> {
  await tx('readwrite', (store) => store.put(record));
}

async function deleteRecord(id: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(id));
}

async function listRecords(): Promise<QueuedRequest[]> {
  const db = await openDB();
  if (!db) return [];
  return new Promise<QueuedRequest[]>((resolve) => {
    const t = db.transaction(STORE, 'readonly');
    const store = t.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as QueuedRequest[]) ?? []);
    req.onerror = () => resolve([]);
  });
}

// ─── Public API ────────────────────────────────────────────────────────────

const QUEUE_EVENT = 'offline-queue-changed';

function broadcast(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(QUEUE_EVENT));
  } catch {
    /* no-op */
  }
}

export function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine;
}

/**
 * Drop-in replacement for `fetch()` on mutating endpoints. If the network
 * is up, fires through normally. If offline (or the fetch throws a network
 * error), enqueues for later replay and returns a synthetic 202-Accepted
 * Response so the caller's success path can run optimistically.
 *
 * The `Idempotency-Key` header is required and must be a stable UUID per
 * user action — the queue replays under this key so the server dedups.
 */
export async function queueOrFetch(input: {
  url: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  headers: Record<string, string>;
  body: string;
}): Promise<Response> {
  const idempotencyKey = input.headers['Idempotency-Key'];
  if (!idempotencyKey) {
    throw new Error('queueOrFetch: Idempotency-Key header is required');
  }

  // Try the network first when we think we have signal.
  if (isOnline()) {
    try {
      const res = await fetch(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body,
      });
      return res;
    } catch {
      // Network error mid-flight — fall through to queue path.
    }
  }

  // Offline (or fetch threw): persist + return a synthetic 202.
  const record: QueuedRequest = {
    id: idempotencyKey,
    url: input.url,
    method: input.method,
    headers: input.headers,
    body: input.body,
    idempotencyKey,
    attempts: 0,
    enqueuedAt: Date.now(),
    lastError: null,
  };
  await putRecord(record);
  broadcast();

  return new Response(
    JSON.stringify({
      success: true,
      queued: true,
      message:
        'You appear to be offline. Your change is queued and will sync the moment you reconnect.',
    }),
    {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

/**
 * Drain the queue. Called automatically on `window.online`, manually via
 * `useOfflineQueue.flushNow()`, and on a slow heartbeat (every 30s while
 * offline so the queue retries if `navigator.onLine` lies).
 */
async function drainOnce(): Promise<{ flushed: number; remaining: number }> {
  if (!isOnline()) return { flushed: 0, remaining: (await listRecords()).length };
  const pending = await listRecords();
  let flushed = 0;
  for (const record of pending) {
    try {
      const res = await fetch(record.url, {
        method: record.method,
        headers: record.headers,
        body: record.body,
      });
      if (res.ok || (res.status >= 200 && res.status < 500)) {
        // 4xx is a deterministic rejection — drop it from the queue so we
        // don't retry forever. The server-side idempotency cache also
        // contains the same response.
        await deleteRecord(record.id);
        flushed += 1;
        successFeedback();
      } else {
        // 5xx → leave queued, bump attempts.
        await putRecord({
          ...record,
          attempts: record.attempts + 1,
          lastError: `HTTP ${res.status}`,
        });
        errorFeedback();
      }
    } catch (err) {
      await putRecord({
        ...record,
        attempts: record.attempts + 1,
        lastError: err instanceof Error ? err.message : 'Network error',
      });
    }
  }
  broadcast();
  const remaining = (await listRecords()).length;
  return { flushed, remaining };
}

let installed = false;
let heartbeat: ReturnType<typeof setInterval> | null = null;

export function installOfflineQueueDrainer(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // Drain when the browser flips online.
  window.addEventListener('online', () => {
    void drainOnce();
  });

  // Heartbeat — recover from captive portals + `navigator.onLine` lying.
  heartbeat = setInterval(() => {
    void drainOnce();
  }, 30_000);

  // Initial drain (covers reload-while-online with pending items).
  void drainOnce();
}

/** Stop the heartbeat. Useful in dev hot-reload tests. */
export function teardownOfflineQueueDrainer(): void {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  installed = false;
}

export async function getQueueDepth(): Promise<number> {
  return (await listRecords()).length;
}

export { QUEUE_EVENT };
