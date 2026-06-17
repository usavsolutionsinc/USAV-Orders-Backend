/**
 * Sync idempotency primitive — ported from USAV_ERP's `generate_payload_hash`
 * + the `zoho_last_sync_hash` skip pattern, generalized for any outbound push.
 *
 * Before pushing an entity to an external system, hash the payload and compare
 * it to the hash stored from the last successful push. If unchanged, skip the
 * call. This avoids:
 *   • redundant external API calls (quota + rate-limit pressure), and
 *   • redundant DB writes (directly relevant to Neon CU-hr cost).
 *
 * The hash is over a STABLE serialization (keys sorted recursively) so two
 * payloads that differ only in key order hash identically.
 *
 * Usage:
 *   const hash = computeSyncHash(payload);
 *   if (hash === row.syncHash) return; // idempotent skip
 *   await client.update(...);
 *   await markSynced(row.id, hash);
 */
import { createHash } from 'node:crypto';

/** Recursively sort object keys so serialization is order-independent. Arrays
 *  keep their order (order is semantically meaningful for lists). */
function stableNormalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stableNormalize);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key];
    if (v === undefined) continue; // undefined ≡ absent, so they hash the same
    out[key] = stableNormalize(v);
  }
  return out;
}

/** Deterministic JSON for hashing — sorted keys, undefined dropped. */
export function stableStringify(payload: unknown): string {
  return JSON.stringify(stableNormalize(payload));
}

/** SHA-256 hex of the stable serialization of `payload`. */
export function computeSyncHash(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload), 'utf8').digest('hex');
}

/**
 * True when `payload` is unchanged vs the last-synced hash (i.e. the push can be
 * skipped). A null/undefined `previousHash` (never synced) always returns false.
 * Returns the freshly-computed hash alongside the decision so callers don't hash
 * twice.
 */
export function evaluateSync(
  payload: unknown,
  previousHash: string | null | undefined,
): { hash: string; unchanged: boolean } {
  const hash = computeSyncHash(payload);
  return { hash, unchanged: previousHash != null && previousHash === hash };
}
