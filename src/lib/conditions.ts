// Single source of truth for condition-grade display strings.
//
// The same 7 grades (BRAND_NEW … PARTS) are shown in several different shapes
// across the app. Historically each surface hand-rolled its own grade→label
// map, so a one-word wording change (e.g. "Refurb" → "Refurbished") meant
// editing many files and the renderings drifted apart. Add or change a grade's
// wording HERE — never re-inline a grade→label map in a component.
//
// Each VARIANT is one shape of the same data:
//   pill    — picker pills (the UI CSS-uppercases them): NEW · L-New · REFURB · A · B · C · PARTS
//   table   — compact list/table chips:                  NEW · L-NEW · REF · A · B · C · PARTS
//   compact — short rail / label copy:                   New · Like New · Refurb · A · B · C · Parts
//   label   — printed + previewed receiving label:       New · Like New · Refurbished · Used - A · … · Parts
//   full    — Zendesk / exports / pickup work orders:    Brand New · Like New · Refurbished · Used — A · … · For Parts
//   option  — generic dropdown (raw, CSS may up-case):   BRAND NEW · LIKE NEW · REFURBISHED · USED A · … · PARTS

export const CONDITION_GRADES = [
  'BRAND_NEW',
  'LIKE_NEW',
  'REFURBISHED',
  'USED_A',
  'USED_B',
  'USED_C',
  'PARTS',
] as const;

export type ConditionGrade = (typeof CONDITION_GRADES)[number];

export type ConditionLabelVariant =
  | 'pill'
  | 'table'
  | 'compact'
  | 'label'
  | 'full'
  | 'option';

export const CONDITION_LABELS: Record<ConditionLabelVariant, Record<string, string>> = {
  pill:    { BRAND_NEW: 'NEW',       LIKE_NEW: 'L-New',    REFURBISHED: 'REFURB',      USED_A: 'A',        USED_B: 'B',        USED_C: 'C',        PARTS: 'PARTS' },
  table:   { BRAND_NEW: 'NEW',       LIKE_NEW: 'L-NEW',    REFURBISHED: 'REF',         USED_A: 'A',        USED_B: 'B',        USED_C: 'C',        PARTS: 'PARTS' },
  compact: { BRAND_NEW: 'New',       LIKE_NEW: 'Like New', REFURBISHED: 'Refurb',      USED_A: 'A',        USED_B: 'B',        USED_C: 'C',        PARTS: 'Parts' },
  label:   { BRAND_NEW: 'New',       LIKE_NEW: 'Like New', REFURBISHED: 'Refurbished', USED_A: 'Used - A', USED_B: 'Used - B', USED_C: 'Used - C', PARTS: 'Parts' },
  full:    { BRAND_NEW: 'Brand New', LIKE_NEW: 'Like New', REFURBISHED: 'Refurbished', USED_A: 'Used — A', USED_B: 'Used — B', USED_C: 'Used — C', PARTS: 'For Parts' },
  option:  { BRAND_NEW: 'BRAND NEW', LIKE_NEW: 'LIKE NEW', REFURBISHED: 'REFURBISHED', USED_A: 'USED A',   USED_B: 'USED B',   USED_C: 'USED C',   PARTS: 'PARTS' },
};

/**
 * Human-readable label for a condition grade in the requested {@link
 * ConditionLabelVariant}. Unknown codes fall back to an underscore-stripped
 * upper-case form (matches the legacy hand-rolled maps); empty/nullish codes
 * default to BRAND_NEW (the receiving-line default), except callers that want
 * an "N/A" placeholder should guard for empty before calling.
 */
export function conditionLabel(
  code: string | null | undefined,
  variant: ConditionLabelVariant = 'label',
): string {
  const c = String(code || 'BRAND_NEW').trim().toUpperCase();
  return CONDITION_LABELS[variant][c] ?? c.replace(/_/g, ' ');
}

/** Compact list-row label; empty/unknown-less codes read as "N/A". */
export function conditionGradeTableLabel(code: string | null | undefined): string {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return 'N/A';
  return conditionLabel(c, 'table');
}

/**
 * `{ value, label }[]` for all 7 grades in canonical order — the single source
 * for every condition-grade dropdown/picker. `full` is the default (the verbose
 * mixed-case form used in detail panels: Brand New · Used — A · For Parts).
 */
export function conditionOptions(
  variant: ConditionLabelVariant = 'full',
): Array<{ value: ConditionGrade; label: string }> {
  return CONDITION_GRADES.map((value) => ({ value, label: conditionLabel(value, variant) }));
}

/**
 * Inline-TEXT color for a condition — the substring-matched, lenient style used
 * by the "condition + title" inline text (not chips): new → yellow-500,
 * for-parts → amber-800, else (used/unknown) → black. Single source of truth;
 * `ConditionText.getConditionColor` and `upnext-helpers.getConditionColor`
 * delegate here. (Chip/badge condition tones are a separate, per-surface
 * concern — see receiving-constants `conditionBadgeTone`.)
 */
export function conditionTextColor(condition: string | null | undefined): string {
  const c = String(condition || '').toLowerCase().trim();
  if (c.includes('new')) return 'text-yellow-500';
  if (c.includes('part')) return 'text-amber-800';
  return 'text-black';
}
