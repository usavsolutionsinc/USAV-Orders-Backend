/**
 * Short-lived pairing codes that bond a phone to a staff session.
 *
 *   desktop /api/pair/create  → SETEX pair:{code} {staff_id} 300
 *   phone   /api/pair/claim   → GET + DEL (single-use), returns staff_id
 *
 * Upstash REST is reused via the same pipeline pattern as upstash-cache.ts.
 */

const REST_URL =
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.KV_REST_API_URL ||
  '';
const REST_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.KV_REST_API_TOKEN ||
  '';

const PAIR_PREFIX = 'pair:v1:';
const PAIR_TTL_SECONDS = 300; // 5 minutes

function isConfigured(): boolean {
  return Boolean(REST_URL && REST_TOKEN);
}

/**
 * In-memory fallback for environments where Upstash isn't reachable (dev,
 * air-gapped CI, etc). Lives on globalThis so HMR doesn't clear the Map
 * between requests.
 */
type MemEntry = { value: string; expiresAt: number };
const globalStore = globalThis as unknown as { __phonePairMem?: Map<string, MemEntry> };
if (!globalStore.__phonePairMem) globalStore.__phonePairMem = new Map();
const memStore: Map<string, MemEntry> = globalStore.__phonePairMem;

function memSet(key: string, value: string, ttlSeconds: number): void {
  memStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

function memGetDel(key: string): string | null {
  const entry = memStore.get(key);
  if (!entry) return null;
  memStore.delete(key);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.value;
}

async function redis<T = unknown>(parts: string[]): Promise<T | null> {
  if (!isConfigured()) throw new Error('Upstash Redis not configured');
  const res = await fetch(`${REST_URL.replace(/\/+$/, '')}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([parts]),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Upstash request failed: ${res.status}`);
  }
  const data = await res.json();
  if (Array.isArray(data) && data.length > 0) {
    return (data[0]?.result as T) ?? null;
  }
  return null;
}

/**
 * Ambiguous characters (0/O, 1/I/L) are stripped so the code is easy to type
 * by hand if the QR is damaged.
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function generatePairCode(length = 6): string {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

export async function createPairCode(staffId: number): Promise<{ code: string; ttlSeconds: number }> {
  const code = generatePairCode(6);
  const key = `${PAIR_PREFIX}${code}`;
  try {
    await redis(['SET', key, String(staffId), 'EX', String(PAIR_TTL_SECONDS), 'NX']);
  } catch (err) {
    // Upstash unreachable — fall back to in-memory store. OK for dev; in
    // prod this still works because Next.js Functions reuse instances.
    console.warn('phone-pair: Upstash unavailable, using in-memory store', err instanceof Error ? err.message : err);
    memSet(key, String(staffId), PAIR_TTL_SECONDS);
  }
  return { code, ttlSeconds: PAIR_TTL_SECONDS };
}

/**
 * Single-use claim. Uses GETDEL so a stolen pairing QR is invalidated the
 * moment it's redeemed.
 */
export async function claimPairCode(code: string): Promise<{ staffId: number } | null> {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return null;
  const key = `${PAIR_PREFIX}${trimmed}`;
  let raw: string | null = null;
  try {
    raw = await redis<string | null>(['GETDEL', key]);
  } catch (err) {
    console.warn('phone-pair: Upstash unavailable on claim, using in-memory store', err instanceof Error ? err.message : err);
    raw = memGetDel(key);
  }
  if (raw == null) {
    // Also check memory store as a fallback in case create went to memory and
    // claim tried Upstash first (or vice-versa across a restart).
    raw = memGetDel(key);
  }
  if (raw == null) return null;
  const staffId = Number(raw);
  if (!Number.isFinite(staffId) || staffId <= 0) return null;
  return { staffId };
}
