/**
 * Substitution reason-code vocabulary — the shared SoT for WHY a fulfilled unit
 * deviates from what was ordered/listed. Used three ways:
 *   - the operator picker on the testing/packing card (label + tone),
 *   - the amendment timeline adapter (badge label + tone),
 *   - default display for the audit trail.
 *
 * This is the BUILT-IN vocabulary. An org may still pass a custom reason string
 * (the reason-codes table / REASON_CODE entity is the extensible store) — unknown
 * codes prettify gracefully via substitutionReasonLabel(), they are not rejected.
 * Mirrors the "format in lib, render dumb" rule: components choose a code, never
 * a class string.
 */

import type { TimelineTone } from '@/lib/timeline/types';

export interface SubstitutionReason {
  code: string;
  label: string;
  tone: TimelineTone;
  /** One-line operator hint for the picker. */
  hint?: string;
}

export const SUBSTITUTION_REASONS = [
  { code: 'CUSTOMER_REQUEST', label: 'Customer request', tone: 'info', hint: 'Buyer asked for a different variant or item.' },
  { code: 'CONDITION_REGRADE', label: 'Condition regrade', tone: 'warning', hint: 'Actual condition differs from what was listed.' },
  { code: 'DAMAGE_FOUND', label: 'Damage found', tone: 'danger', hint: 'Picked/tested unit is damaged — swapped for a sound one.' },
  { code: 'WRONG_ITEM_LISTED', label: 'Wrong item listed', tone: 'warning', hint: 'The listing/order pointed at the wrong item.' },
  { code: 'OUT_OF_STOCK', label: 'Out of stock', tone: 'warning', hint: 'Ordered unit unavailable — substituted an equivalent.' },
  { code: 'BETTER_AVAILABLE', label: 'Better unit available', tone: 'success', hint: 'Upgraded the buyer to a better unit.' },
  { code: 'OTHER', label: 'Other', tone: 'muted', hint: 'Anything else — explain in the note.' },
] as const satisfies readonly SubstitutionReason[];

export type SubstitutionReasonCode = (typeof SUBSTITUTION_REASONS)[number]['code'];

const BY_CODE = new Map<string, SubstitutionReason>(SUBSTITUTION_REASONS.map((r) => [r.code, r]));

/** Prettify an unknown code: 'SOME_REASON' → 'Some reason'. */
function prettify(code: string): string {
  const s = code.replace(/[._-]+/g, ' ').trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Display label for a reason code — built-in label or a prettified fallback. */
export function substitutionReasonLabel(code: string): string {
  return BY_CODE.get(code)?.label ?? prettify(code);
}

/** Timeline/badge tone for a reason code — built-in tone or 'muted' for custom. */
export function substitutionReasonTone(code: string): TimelineTone {
  return BY_CODE.get(code)?.tone ?? 'muted';
}

/** True when the code is one of the built-in vocabulary entries. */
export function isBuiltInSubstitutionReason(code: string): code is SubstitutionReasonCode {
  return BY_CODE.has(code);
}

/**
 * Merge tenant-stored substitution rows (rows from `reason_codes`, flow_context
 * ='substitution' — the DB owns code + label so an org can rename a built-in or
 * add a custom reason) into the display shape the picker renders. Tone + hint are
 * built-in display metadata resolved from the registry, defaulting to 'muted' /
 * no-hint for custom codes — the same graceful path as substitutionReasonLabel/
 * Tone. An empty input (DB unseeded / fetch failed) lets the caller fall back to
 * SUBSTITUTION_REASONS.
 */
export function mergeSubstitutionReasons(rows: readonly { code: string; label: string }[]): SubstitutionReason[] {
  return rows.map((r) => ({
    code: r.code,
    label: r.label,
    tone: substitutionReasonTone(r.code),
    hint: BY_CODE.get(r.code)?.hint,
  }));
}
