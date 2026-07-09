/**
 * serial-diff.ts
 * ──────────────────────────────────────────────────────────────────────────
 * Pure, client-safe compare-and-contrast of two serial numbers — the "shipped
 * vs received" diff shown when a returned unit's serial is checked against the
 * serial we shipped on an order. No server imports (kept out of the DB module's
 * `normalizeSerial`, which pulls the pg pool) so it bundles into the client.
 *
 * Positional diff: align both serials from the left and mark each character as
 * matching or differing; extra characters in the longer serial are differences.
 * Good enough for the real cases — a mistyped digit, a transposed pair, or an
 * entirely different unit — and it never throws.
 */

/** Trim + uppercase — the same normalization serial_units uses, inlined so this
 *  module stays free of server-only imports. */
export function normalizeSerialText(raw: string | null | undefined): string {
  return String(raw ?? '').trim().toUpperCase();
}

export interface SerialDiffCell {
  ch: string;
  match: boolean;
}

export interface SerialDiffResult {
  receivedNormalized: string;
  shippedNormalized: string;
  received: SerialDiffCell[];
  shipped: SerialDiffCell[];
  /** True only when both are non-empty and identical. */
  equal: boolean;
  /** How many character positions differ (incl. length overhang). */
  diffCount: number;
}

/** Character-by-character positional diff of a received vs shipped serial. */
export function diffSerials(
  receivedRaw: string | null | undefined,
  shippedRaw: string | null | undefined,
): SerialDiffResult {
  const received = normalizeSerialText(receivedRaw);
  const shipped = normalizeSerialText(shippedRaw);
  const len = Math.max(received.length, shipped.length);

  const receivedCells: SerialDiffCell[] = [];
  const shippedCells: SerialDiffCell[] = [];
  let diffCount = 0;

  for (let i = 0; i < len; i++) {
    const r = received[i] ?? '';
    const s = shipped[i] ?? '';
    const match = r !== '' && s !== '' && r === s;
    if (!match) diffCount += 1;
    if (i < received.length) receivedCells.push({ ch: r, match });
    if (i < shipped.length) shippedCells.push({ ch: s, match });
  }

  return {
    receivedNormalized: received,
    shippedNormalized: shipped,
    received: receivedCells,
    shipped: shippedCells,
    equal: received.length > 0 && received === shipped,
    diffCount,
  };
}

/**
 * From a set of serials we shipped on an order, pick the one CLOSEST to the
 * received serial (fewest differing characters) so the contrast highlights the
 * most likely intended match — a single mistyped digit rather than "no match".
 * Returns null when there are no shipped serials to compare against.
 */
export function pickClosestShippedSerial(
  received: string | null | undefined,
  shipped: string[],
): string | null {
  if (shipped.length === 0) return null;
  const r = normalizeSerialText(received);
  if (!r) return shipped[0];
  let best = shipped[0];
  let bestDiff = Infinity;
  for (const s of shipped) {
    const { diffCount } = diffSerials(r, s);
    if (diffCount < bestDiff) {
      bestDiff = diffCount;
      best = s;
      if (bestDiff === 0) break;
    }
  }
  return best;
}
