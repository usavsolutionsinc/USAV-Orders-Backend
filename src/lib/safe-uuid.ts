/**
 * Crash-safe UUID generator for code that may run in the browser.
 *
 * `crypto.randomUUID()` is exposed **only in a secure context** (HTTPS or
 * `localhost`). Over a plain-HTTP LAN IP (e.g. testing from a phone at
 * `http://192.168.x.x:3000`) it is `undefined`, so calling it throws
 * `TypeError: crypto.randomUUID is not a function` and takes down whatever
 * component invoked it.
 *
 * This helper is the single source of truth for client-reachable id minting:
 *   1. use `crypto.randomUUID()` when available (secure context / Node),
 *   2. else build a real v4 UUID from `crypto.getRandomValues` — which, unlike
 *      `randomUUID`/`subtle`, IS available in insecure contexts,
 *   3. else fall back to a timestamp+random string (last resort).
 *
 * Strength note: the step-3 fallback is NOT cryptographically strong. This is
 * fine for client event ids, idempotency keys, and local row ids — never use it
 * for secrets, tokens, or anything security-sensitive.
 */
export function safeRandomUUID(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const b = crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40; // version 4
      b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
      const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
      return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
    }
  } catch {
    /* fall through to the non-crypto fallback */
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 10)}`;
}
