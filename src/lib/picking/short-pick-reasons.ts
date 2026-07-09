/**
 * Short-pick reason-code vocabulary — the built-in SoT for WHY a picker confirmed
 * fewer units than planned (the remainder is released back to STOCKED). This is
 * the BUILT-IN registry: seeded into reason_codes (flow_context='short_pick') so
 * a tenant can rename or add reasons, and the offline fallback the picker renders
 * when the DB is unseeded / unreachable. Descriptive vocabulary — nothing in code
 * branches on the value (recordShortPick always releases to STOCKED); the reason
 * is audit only. See docs/operations-studio/HARDCODED-STATUS-ENGINE-MIGRATION-PLAN.md D1.
 *
 * `hint` is operator help text shown under each option; it stays code-side (the
 * DB owns code + label) and resolves by code for built-ins, blank for custom.
 */

interface ShortPickReasonOption {
  code: string;
  label: string;
  hint: string;
}

export const SHORT_PICK_REASONS: readonly ShortPickReasonOption[] = [
  { code: 'NOT_FOUND_IN_BIN', label: 'Not in bin', hint: 'Expected here, not present' },
  { code: 'DAMAGED', label: 'Damaged', hint: 'Visible damage — needs hold' },
  { code: 'WRONG_CONDITION', label: 'Wrong condition', hint: "Grade doesn't match order" },
  { code: 'MISLABELED', label: 'Mislabeled', hint: 'SKU on unit ≠ bin label' },
  { code: 'INSUFFICIENT_STOCK', label: 'Insufficient stock', hint: 'Fewer units exist than planned' },
  { code: 'OTHER', label: 'Other', hint: 'Add a note below' },
];

const BY_CODE = new Map(SHORT_PICK_REASONS.map((r) => [r.code, r]));

/**
 * Map tenant-stored short-pick rows (DB owns code + label) into the option shape
 * the sheet renders, resolving the built-in `hint` by code (blank for custom).
 */
export function mergeShortPickReasons(
  rows: readonly { code: string; label: string }[],
): ShortPickReasonOption[] {
  return rows.map((r) => ({ code: r.code, label: r.label, hint: BY_CODE.get(r.code)?.hint ?? '' }));
}
