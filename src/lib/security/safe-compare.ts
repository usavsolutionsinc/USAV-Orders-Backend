import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string equality for shared-secret / bearer-token checks.
 *
 * A plain `a === b` short-circuits on the first differing byte, leaking the
 * length of the matching prefix through response timing. Use this for any
 * comparison of a caller-supplied secret against an expected value (webhook
 * secrets, internal bearer tokens). Length is not secret, so a length mismatch
 * returns false immediately.
 */
export function safeStrEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
