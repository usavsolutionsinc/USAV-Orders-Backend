/**
 * First-pass order-number extraction from PO email text.
 *
 * Deterministic regex matching — fast, free, and gives us a baseline to
 * eyeball against real vendor emails before we layer LLM extraction on
 * top. The LLM pass will handle line-items, prices, and vendor name
 * normalization; this just grabs PO/order numbers so the reconciler
 * has something to diff against the Zoho mirror.
 *
 * Strategy:
 *   - Run multiple patterns, each capturing a candidate
 *   - Normalize (uppercase, strip surrounding punctuation)
 *   - Dedupe, preserving first-seen order
 *   - Reject obvious noise (pure digits ≤ 3 chars, words like "PO Box")
 *
 * Patterns are intentionally permissive — false positives are cheap (the
 * reconciler just shrugs at them, since the DB lookup returns nothing
 * AND the Zoho mirror returns nothing → row lands in the "missing" pane
 * where a human eyeballs it). False *negatives* are expensive — a real
 * PO that we miss never gets reconciled. So we bias toward recall.
 */

// Labeled patterns first (more specific → higher confidence). Each must
// have exactly one capture group containing the candidate.
const LABELED_PATTERNS: RegExp[] = [
  // "PO #: 12345", "P.O. Number: 12345", "Purchase Order #12345"
  /\b(?:P\.?\s*O\.?|Purchase\s+Order)\s*(?:#|No\.?|Number|:)\s*([A-Z0-9][A-Z0-9\-_/]{2,20})\b/gi,
  // "Order #: 12345", "Order Number: 12345"
  /\bOrder\s*(?:#|No\.?|Number)\s*:?\s*([A-Z0-9][A-Z0-9\-_/]{2,20})\b/gi,
  // "Reference: ABC-12345"
  /\bReference\s*(?:#|No\.?|Number)?\s*:?\s*([A-Z0-9][A-Z0-9\-_/]{3,20})\b/gi,
  // "Confirmation #: 12345"
  /\bConfirmation\s*(?:#|No\.?|Number)?\s*:?\s*([A-Z0-9][A-Z0-9\-_/]{3,20})\b/gi,
  // eBay order number — legacy "12-34567-89012" (2-5-5). Distinctive enough to
  // treat as high-confidence (labeled tier) even when printed bare, because
  // eBay "Order delivered" emails often show the order# without a label word.
  /\b(\d{2}-\d{5}-\d{5})\b/g,
];

// Unlabeled fallbacks. Only run if labeled patterns found nothing, to
// avoid duplicating hits that already came in via a label.
const UNLABELED_PATTERNS: RegExp[] = [
  // Bare "PO-12345", "PO12345", "PO 12345" appearing anywhere
  /\b(PO[\s\-_]?\d{4,12})\b/gi,
  // Bare "SO-12345" (sales order) — some vendors use these
  /\b(SO[\s\-_]?\d{4,12})\b/gi,
];

const NOISE_BLOCKLIST = new Set([
  'PO BOX', 'PO-BOX', 'POBOX', 'PO 0',
]);

function normalize(candidate: string): string {
  return candidate
    .toUpperCase()
    .replace(/\s+/g, '')        // "PO 12345" → "PO12345"
    .replace(/^[-_/]+|[-_/]+$/g, ''); // strip surrounding separators
}

function isPlausible(candidate: string): boolean {
  if (candidate.length < 4) return false;
  if (NOISE_BLOCKLIST.has(candidate)) return false;
  // Require at least one digit OR length >= 6 (alphanumeric SKUs/refs)
  const hasDigit = /\d/.test(candidate);
  if (!hasDigit && candidate.length < 6) return false;
  return true;
}

export interface ExtractedOrderNumbers {
  /** Candidates with surrounding label ("PO #", "Order Number:", etc). */
  labeled: string[];
  /** Candidates from bare-pattern fallback. Empty if labeled matched. */
  unlabeled: string[];
  /** Union, deduplicated, in first-seen order. The set the reconciler uses. */
  all: string[];
}

// ─── Tracking number extraction ───────────────────────────────────────────
// Closes the "vendor emailed tracking before / instead of Zoho `reference_number`
// getting populated" gap. The Incoming view's `AWAITING_TRACKING` bucket
// drains as soon as these stamp shipment_id on the matched receiving row.
//
// Patterns are deliberately conservative — false positives create phantom
// shipments and pollute the carrier-poll queue. Each pattern matches a
// carrier-specific format with explicit length + character constraints:
//
//   UPS:    1Z + 16 alphanumerics                                  (18 total)
//   FedEx:  12, 14, 15, 20, or 22 digits (multiple service types)
//   USPS:   20-22 digits, optionally prefixed by 92/93/94/95
//   DHL:    10 digits OR JD + 10 digits
const TRACKING_PATTERNS: ReadonlyArray<{ carrier: string; re: RegExp }> = [
  { carrier: 'UPS',   re: /\b(1Z[0-9A-Z]{16})\b/g },
  // FedEx 12-digit + 14/15/20/22 digit variants. Anchored on word boundary
  // to avoid grabbing the tail of a long PO# that happens to be digits.
  { carrier: 'FEDEX', re: /\b(\d{12}|\d{15}|\d{20}|\d{22})\b/g },
  // USPS 22-digit IMpb (most common). Other forms (LX/RA/EA international)
  // omitted — they're rare in vendor receive emails and easy to add later.
  { carrier: 'USPS',  re: /\b(9[2-5]\d{20})\b/g },
  // DHL Express airwaybill — 10-digit numeric. Looser pattern; let the
  // carrier-detect step in registerShipmentPermissive reject false positives.
  { carrier: 'DHL',   re: /\b(JD\d{10}|\d{10})\b/g },
];

/**
 * Pull carrier tracking numbers out of a vendor email body. Dedupes across
 * patterns (UPS first because it's the most distinctive). Returns the raw
 * extracted strings — `registerShipmentPermissive` will normalize and
 * carrier-detect them downstream.
 */
export function extractTrackingNumbers(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  for (const { re } of TRACKING_PATTERNS) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const raw = match[1].trim();
      if (raw.length < 8) continue;
      seen.add(raw);
    }
  }
  return Array.from(seen);
}

/**
 * True when an email subject signals a delivery ("ORDER DELIVERED"). eBay's
 * delivery notifications phrase this a few ways ("Your order was delivered",
 * "Order delivered", "Delivered: …"), so we require both tokens rather than an
 * exact phrase — order# extraction from the body is what actually anchors the
 * match, so a loose subject gate is safe (a non-delivery email with both words
 * just yields no new delivery signal once its order# is already scanned).
 */
export function isOrderDeliveredSubject(subject: string | null | undefined): boolean {
  if (!subject) return false;
  const s = subject.toLowerCase();
  return s.includes('delivered') && s.includes('order');
}

export function extractOrderNumbers(text: string): ExtractedOrderNumbers {
  if (!text) return { labeled: [], unlabeled: [], all: [] };

  const labeledSet = new Map<string, true>();
  for (const pattern of LABELED_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const norm = normalize(match[1]);
      if (isPlausible(norm)) labeledSet.set(norm, true);
    }
  }
  const labeled = Array.from(labeledSet.keys());

  const unlabeledSet = new Map<string, true>();
  if (labeled.length === 0) {
    for (const pattern of UNLABELED_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text))) {
        const norm = normalize(match[1]);
        if (isPlausible(norm)) unlabeledSet.set(norm, true);
      }
    }
  }
  const unlabeled = Array.from(unlabeledSet.keys());

  const all = Array.from(new Set([...labeled, ...unlabeled]));
  return { labeled, unlabeled, all };
}
