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
