/**
 * Offline scan queue — IndexedDB via idb.
 *
 * When a station scan fails due to network, entries are saved here
 * and drained automatically when connectivity is restored.
 *
 * Schema:
 *   store: "scan_queue"
 *   key: auto-incremented id
 *   value: QueuedScan
 */
import { openDB, type IDBPDatabase } from 'idb';

export type ScanStation = 'packer' | 'tech' | 'receiving';

export interface QueuedScan {
  id?: number;
  station: ScanStation;
  payload: Record<string, unknown>;
  endpoint: string;
  queuedAt: string; // ISO string
  retries: number;
}

const DB_NAME = 'usav-offline';
const DB_VERSION = 1;
const STORE = 'scan_queue';

async function getDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    },
  });
}

/** Add a scan to the offline queue. */
export async function enqueue(scan: Omit<QueuedScan, 'id' | 'queuedAt' | 'retries'>): Promise<void> {
  const db = await getDb();
  await db.add(STORE, {
    ...scan,
    queuedAt: new Date().toISOString(),
    retries: 0,
  });
}

/** Return all queued scans (oldest first). */
export async function getAllQueued(): Promise<QueuedScan[]> {
  const db = await getDb();
  return db.getAll(STORE);
}

/** Count pending items. */
export async function queueCount(): Promise<number> {
  const db = await getDb();
  return db.count(STORE);
}

/** Remove a successfully-synced entry by id. */
export async function dequeue(id: number): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
}

/** Increment retry count for an entry. */
export async function incrementRetry(id: number): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  const item = await tx.store.get(id);
  if (item) {
    item.retries += 1;
    await tx.store.put(item);
  }
  await tx.done;
}

/** Clear the entire queue (e.g. after max retries exceeded). */
export async function clearQueue(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE);
}

/**
 * Drain the queue — attempt to POST each entry.
 * Removes successful entries, increments retries for failures.
 * Entries exceeding maxRetries are dropped.
 */
export async function drainQueue(maxRetries = 5): Promise<{ synced: number; failed: number }> {
  const items = await getAllQueued();
  let synced = 0;
  let failed = 0;

  for (const item of items) {
    if (item.retries >= maxRetries) {
      await dequeue(item.id!);
      failed++;
      continue;
    }
    try {
      const res = await fetch(item.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.payload),
      });
      if (res.ok) {
        await dequeue(item.id!);
        synced++;
      } else {
        await incrementRetry(item.id!);
        failed++;
      }
    } catch {
      await incrementRetry(item.id!);
      failed++;
    }
  }

  return { synced, failed };
}
