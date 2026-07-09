import type { TimelineChange } from './types';

/** Format one audit value for display, or null when absent. */
function fmtVal(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/**
 * Structured field-level diff for an audit row → the `TimelineItem.changes`
 * slot (`key: before → after`). Pure, so it's unit-tested and shared by the
 * timeline adapters.
 *
 * SECURITY-LOAD-BEARING CONTRACT: requires BOTH `before` and `after` to be
 * present. A one-sided payload yields **no** changes — which covers two cases
 * with one rule: (1) a creation/deletion with only one snapshot (nothing to
 * diff), and (2) a caller who lacks `admin.view_logs`, whose `before_data` is
 * redacted to null server-side before this runs (Operations History plan
 * §3.2 Option B). So redacting `before` is sufficient to guarantee no field
 * value — before OR after — leaks into the diff block. Do NOT relax this to a
 * one-sided diff without moving the permission gate.
 *
 * Caps at `max` rows so a huge edit can't flood a single timeline row.
 */
export function diffChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  max = 12,
): TimelineChange[] {
  if (!before || !after) return [];
  const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const out: TimelineChange[] = [];
  for (const key of keys) {
    const b = fmtVal(before[key]);
    const a = fmtVal(after[key]);
    if (b === a) continue;
    out.push({ key, before: b, after: a });
    if (out.length >= max) break;
  }
  return out;
}
