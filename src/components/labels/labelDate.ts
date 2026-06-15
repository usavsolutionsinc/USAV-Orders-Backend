/**
 * Shared parse/format for the label editor's date field — locale `m/d/yy`
 * round-trips between the draft string and the calendar's Date. Extracted so
 * the receiving and (future) testing label editors share one implementation.
 */

export function parseLabelDate(s: string): Date | undefined {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s.trim());
  if (m) {
    let yy = Number(m[3]);
    if (yy < 100) yy += 2000;
    const d = new Date(yy, Number(m[1]) - 1, Number(m[2]));
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function formatLabelDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}
