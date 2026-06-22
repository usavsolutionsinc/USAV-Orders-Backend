import { bayHand, noPad, pad2 } from '@/lib/barcode-routing';

/**
 * Width-matched placeholder code (e.g. `?---------` lines up with a real filled
 * code like `A-01-01-1`) for the live preview before all steps are picked.
 */
export function partialCode(s: { zone?: string; aisle?: number; bay?: number; level?: number }): string {
  const parts: string[] = [];
  parts.push(s.zone ?? '?');
  parts.push(s.aisle != null ? pad2(s.aisle) : '--');
  parts.push(s.bay != null ? pad2(s.bay) : '--');
  parts.push(s.level != null ? noPad(s.level) : '-');
  return parts.join('-');
}

/**
 * Human-readable breakdown ("Aisle 01 → Bay 02 (left) → Level 1"). The zone
 * letter is omitted intentionally — it's already in the big code and the
 * zone/room line, so a third copy adds noise without information.
 */
export function humanReadable(s: { zone?: string; aisle?: number; bay?: number; level?: number }): string {
  const out: string[] = [];
  if (s.aisle != null) out.push(`Aisle ${pad2(s.aisle)}`);
  if (s.bay != null) out.push(`Bay ${pad2(s.bay)} (${bayHand(s.bay)})`);
  if (s.level != null) out.push(`Level ${noPad(s.level)}`);
  return out.join(' → ') || 'Pick a room above';
}
