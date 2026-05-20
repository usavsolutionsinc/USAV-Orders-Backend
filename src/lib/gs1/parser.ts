/**
 * GS1 Digital Link parser.
 *
 * Walks a Digital Link URL or bare path and collects every `(AI, value)`
 * pair into `aiMap`. The well-known AIs we care about are also hoisted
 * onto named fields on the returned context for ergonomic access by the
 * resolver. Unknown AIs are kept in `aiMap` so a follow-up can extend
 * routing without touching this parser.
 *
 * Recognised AIs (named):
 *   01  → gtin           (product class)
 *   21  → serial         (unique unit)
 *   10  → batchOrLot     (lot / batch code)
 *   414 → gln            (location identifier, paired with 254)
 *   254 → locationCode   (warehouse address — our flat code, e.g. C0101101)
 *
 * Any other AI ends up in `aiMap` only. The walker tolerates a leading
 * `https://host` prefix, a leading slash, and URL-encoded values.
 *
 * Returns `null` when no AI/value pair is found at all.
 */
import {
  GS1_PATH_RE,
  GS1_LOCATION_RE,
} from '../barcode-routing';

export interface Gs1Context {
  /** Original input string after trimming — kept so callers can echo it. */
  rawUrl: string;
  /** Path the parser operated on (no scheme/host). */
  path: string;
  /** Every AI/value pair found, including unrecognised ones. */
  aiMap: Record<string, string>;

  // Named accessors for the AIs the resolver branches on.
  gtin?: string;
  serial?: string;
  batchOrLot?: string;
  gln?: string;
  locationCode?: string;
}

/** Strip scheme+host if present; return the leading-slash path. */
function extractPath(input: string): string {
  const v = input.trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      return u.pathname + (u.search ?? '');
    } catch {
      return '';
    }
  }
  return v.startsWith('/') ? v : `/${v}`;
}

/**
 * Walk `(ai, value)` segment pairs out of a slash-delimited path.
 *
 * GS1 Digital Link format pairs every numeric AI with the next segment
 * as its value: `/01/{gtin}/21/{serial}/10/{batch}`. We collect every
 * such pair we can find, regardless of ordering, and ignore stray
 * segments (e.g. a trailing path component without a following value).
 */
function collectAiPairs(path: string): Record<string, string> {
  // Drop query/hash and split on '/'. A leading empty segment from the
  // initial '/' is fine — we skip non-numeric segments anyway.
  const cleanPath = path.split(/[?#]/)[0] ?? '';
  const segments = cleanPath.split('/').filter(Boolean);
  const out: Record<string, string> = {};

  for (let i = 0; i < segments.length - 1; i++) {
    const ai = segments[i]!;
    // AIs are numeric. Skip anything else so a path like
    // /sku-stock/location/X doesn't get mis-parsed.
    if (!/^\d{2,4}$/.test(ai)) continue;
    const valueRaw = segments[i + 1]!;
    // Decode once; tolerate bad encoding.
    let value = valueRaw;
    try {
      value = decodeURIComponent(valueRaw);
    } catch {
      /* keep raw */
    }
    out[ai] = value;
    // Advance past the consumed value so an AI value isn't re-read as a key.
    i++;
  }

  return out;
}

export function parseGs1DigitalLink(input: string): Gs1Context | null {
  const rawUrl = (input ?? '').trim();
  if (!rawUrl) return null;
  const path = extractPath(rawUrl);
  if (!path) return null;

  const aiMap = collectAiPairs(path);

  // Fast-path: if the walker missed something but the canonical regexes
  // match, fill in from them. This protects the named fields when the
  // input is shaped exactly like the printed-QR format we already emit.
  if (!aiMap['01'] || !aiMap['21']) {
    const m = GS1_PATH_RE.exec(path);
    if (m) {
      if (!aiMap['01']) aiMap['01'] = m[1]!;
      if (!aiMap['21'] && m[2]) {
        try {
          aiMap['21'] = decodeURIComponent(m[2]);
        } catch {
          aiMap['21'] = m[2];
        }
      }
    }
  }
  if (!aiMap['414'] || !aiMap['254']) {
    const m = GS1_LOCATION_RE.exec(path);
    if (m) {
      if (!aiMap['414']) aiMap['414'] = m[1]!;
      if (!aiMap['254']) {
        try {
          aiMap['254'] = decodeURIComponent(m[2]!);
        } catch {
          aiMap['254'] = m[2]!;
        }
      }
    }
  }

  if (Object.keys(aiMap).length === 0) return null;

  const ctx: Gs1Context = { rawUrl, path, aiMap };
  if (aiMap['01']) ctx.gtin = aiMap['01'].replace(/\D/g, '');
  if (aiMap['21']) ctx.serial = aiMap['21'].trim();
  if (aiMap['10']) ctx.batchOrLot = aiMap['10'].trim();
  if (aiMap['414']) ctx.gln = aiMap['414'].trim();
  if (aiMap['254']) ctx.locationCode = aiMap['254'].trim().toUpperCase();

  // Bail out if we collected only structural noise (e.g. a numeric path
  // segment that wasn't actually an AI). A useful context has at least
  // one named field.
  if (
    !ctx.gtin &&
    !ctx.serial &&
    !ctx.batchOrLot &&
    !ctx.gln &&
    !ctx.locationCode
  ) {
    // Still return it if aiMap has unrecognised AIs the caller may want
    // to inspect — but only if at least one entry looks like a real AI.
    return ctx;
  }
  return ctx;
}
