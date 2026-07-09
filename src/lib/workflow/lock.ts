/**
 * Workflow engine — per-unit advance lock (Phase 1.0).
 *
 * Replaces the no-op NULL_LOCK with a best-effort Upstash Redis mutex keyed
 * `wf:advance:{serialUnitId}` so two concurrent scans can't double-advance the
 * same unit. It mirrors the proven REST shape in src/lib/api-guard.ts (POST to
 * `${UPSTASH_REDIS_REST_URL}/pipeline`, Bearer token, read `result`).
 *
 * IMPORTANT — this lock is a race-NARROWING optimization, not the correctness
 * backstop. The engine is already event-gated-idempotent: replaying an event
 * against a unit that already advanced just re-parks it (see
 * nodes/station-node.ts), so a missed lock can at worst cause a harmless
 * re-park, never a corrupt double-advance. That asymmetry sets the failure
 * policy:
 *
 *   - Redis UNCONFIGURED (local / CI / preview)  → acquire() returns true and
 *     release() no-ops. Byte-identical to NULL_LOCK, so nothing breaks without
 *     Redis — this is why advance() can default to it safely.
 *   - Lock already held (SET NX miss)            → acquire() returns false, so
 *     the *second* concurrent advance no-ops with reason 'locked'. The real guard.
 *   - Redis ERROR / timeout                      → acquire() returns true (fail
 *     OPEN). We never stall a fire-and-forget tap on an infra hiccup;
 *     idempotency covers the rare double-advance.
 *
 * TTL is short (LOCK_TTL_MS) so a crash between acquire/release auto-expires the
 * key; release is a token-checked compare-and-delete (Lua) so we never delete a
 * lock a later advance re-acquired after our TTL lapsed.
 */

import type { AdvanceLock } from './contract';
import { isRedisConfigured, redisCmd } from '@/lib/redis/client';

function isConfigured(): boolean {
  return isRedisConfigured();
}

/** Lock lifetime. Long enough for one human-paced advance, short enough that a
 * crashed holder auto-expires without manual cleanup. */
const LOCK_TTL_MS = 15_000;

/** Compare-and-delete: only release the key if we still hold our exact token. */
const RELEASE_LUA =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

/**
 * Tokens for keys this process currently holds. Only ever populated on a
 * successful SET NX (so the fail-open path leaves it empty → release() no-ops),
 * and only the acquirer reaches release() because advanceItem() returns before
 * its try/finally when acquire() is false.
 */
const heldTokens = new Map<string, string>();

let tokenSeq = 0;
function mintToken(): string {
  tokenSeq = (tokenSeq + 1) % Number.MAX_SAFE_INTEGER;
  return `${process.pid.toString(36)}-${Date.now().toString(36)}-${tokenSeq.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export const redisAdvanceLock: AdvanceLock = {
  async acquire(key) {
    if (!isConfigured()) return true; // dev/CI/preview: behave like NULL_LOCK
    const token = mintToken();
    try {
      const result = await redisCmd(['SET', key, token, 'NX', 'PX', String(LOCK_TTL_MS)]);
      if (result === 'OK') {
        heldTokens.set(key, token);
        return true;
      }
      // SET NX returned null → another advance holds this unit's lock right now.
      return false;
    } catch (err) {
      // Infra hiccup → fail OPEN: proceed without the lock. The engine's
      // event-gated idempotency makes a rare concurrent advance a re-park, not
      // a corruption; stalling a fire-and-forget tap would be the worse outcome.
      console.warn(
        `[wf-lock] acquire ${key} failed (proceeding without lock):`,
        err instanceof Error ? err.message : err,
      );
      return true;
    }
  },

  async release(key) {
    if (!isConfigured()) return;
    const token = heldTokens.get(key);
    heldTokens.delete(key);
    if (!token) return; // never acquired a real lock (fail-open path) — nothing to free
    try {
      await redisCmd(['EVAL', RELEASE_LUA, '1', key, token]);
    } catch (err) {
      console.warn(
        `[wf-lock] release ${key} failed (TTL ${LOCK_TTL_MS}ms will expire it):`,
        err instanceof Error ? err.message : err,
      );
    }
  },
};
