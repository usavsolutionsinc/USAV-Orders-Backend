import { toast } from '@/lib/toast';

type ZohoVerdict = 'ok' | 'failed' | 'skipped';

type PendingZohoSync = {
  id: string;
  orgId: string;
  lineIds: number[];
  createdAt: number;
  label: string;
};

const STORAGE_KEY = 'receiving.pendingZohoSync.v1';
const TTL_MS = 20 * 60 * 1000;

const inMemory = new Map<string, PendingZohoSync>();

function now() {
  return Date.now();
}

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readStorage(): PendingZohoSync[] {
  if (!isBrowser()) return [];
  const parsed = safeParseJson<PendingZohoSync[]>(window.localStorage.getItem(STORAGE_KEY));
  return Array.isArray(parsed) ? parsed : [];
}

function writeStorage(list: PendingZohoSync[]) {
  if (!isBrowser()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function prune(list: PendingZohoSync[]): PendingZohoSync[] {
  const cutoff = now() - TTL_MS;
  const next = list.filter((p) => Boolean(p?.id) && Number(p?.createdAt) >= cutoff);
  // Deduplicate by id (last one wins)
  const byId = new Map<string, PendingZohoSync>();
  for (const p of next) byId.set(p.id, p);
  return Array.from(byId.values());
}

function upsertPending(p: PendingZohoSync) {
  const next = prune([...readStorage().filter((x) => x.id !== p.id), p]);
  writeStorage(next);
  inMemory.set(p.id, p);
}

function removePending(id: string) {
  const next = prune(readStorage().filter((x) => x.id !== id));
  writeStorage(next);
  inMemory.delete(id);
}

function ensureLoadingToast(p: PendingZohoSync) {
  toast.loading(p.label, { id: p.id, duration: Infinity });
}

export function enqueuePendingZohoSync(input: {
  id: string;
  orgId: string;
  lineIds: number[];
  createdAt?: number;
  label?: string;
}): void {
  if (!isBrowser()) return;
  const lineIds = Array.from(new Set(input.lineIds.filter((n) => Number.isFinite(n) && n > 0)));
  if (lineIds.length === 0) return;
  const p: PendingZohoSync = {
    id: input.id,
    orgId: input.orgId,
    lineIds,
    createdAt: input.createdAt ?? now(),
    label: input.label ?? 'Syncing to Zoho…',
  };
  upsertPending(p);
  ensureLoadingToast(p);
}

export function hydratePendingZohoSyncToasts(orgId: string): void {
  if (!isBrowser()) return;
  const list = prune(readStorage());
  writeStorage(list);

  for (const p of list) {
    if (!p || p.orgId !== orgId) continue;
    if (!inMemory.has(p.id)) inMemory.set(p.id, p);
    ensureLoadingToast(p);
  }
}

export function resolvePendingZohoSync(input: {
  orgId: string;
  lineId: number;
  verdict: ZohoVerdict;
}): void {
  if (!isBrowser()) return;
  const lineId = Number(input.lineId);
  if (!Number.isFinite(lineId) || lineId <= 0) return;

  const pending = prune(readStorage());
  const hit = pending.find((p) => p.orgId === input.orgId && Array.isArray(p.lineIds) && p.lineIds.includes(lineId));
  if (!hit) return;

  if (input.verdict === 'ok') {
    toast.success('Confirmed in Zoho', { id: hit.id, duration: 2500 });
  } else if (input.verdict === 'failed') {
    toast.error('Zoho sync failed — saved locally. Open the PO and retry Receive.', {
      id: hit.id,
      duration: 6000,
    });
  } else {
    toast.info('Zoho sync skipped.', { id: hit.id, duration: 2500 });
  }

  removePending(hit.id);
}

