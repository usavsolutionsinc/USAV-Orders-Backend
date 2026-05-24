import { bayHand, noPad, pad2 } from '@/lib/barcode-routing';

interface PartialSegments {
  zone?: string;
  aisle?: number;
  bay?: number;
  level?: number;
  position?: number;
}

/**
 * Build a placeholder-padded location code from partial segments.
 *
 * Placeholder hyphens match the *width* of the segment they replace (two for
 * pad2, one for noPad) so the unfilled label code visually aligns with its
 * filled counterpart — `A-01-01-1-01` ↔ `?---------`.
 */
export function partialCode(s: PartialSegments): string {
  const parts: string[] = [];
  parts.push(s.zone ?? '?');
  parts.push(s.aisle != null ? pad2(s.aisle) : '--');
  parts.push(s.bay != null ? pad2(s.bay) : '--');
  parts.push(s.level != null ? noPad(s.level) : '-');
  parts.push(s.position != null ? pad2(s.position) : '--');
  return parts.join('-');
}

/**
 * Human-readable breadcrumb of the picked segments.
 *
 * Zone letter is omitted intentionally — it already appears in the big code
 * and the zone/room line above this breadcrumb.
 */
export function humanReadable(s: PartialSegments): string {
  const out: string[] = [];
  if (s.aisle != null) out.push(`Aisle ${pad2(s.aisle)}`);
  if (s.bay != null) out.push(`Bay ${pad2(s.bay)} (${bayHand(s.bay)})`);
  if (s.level != null) out.push(`Level ${noPad(s.level)}`);
  if (s.position != null) out.push(`Position ${pad2(s.position)}`);
  return out.join(' → ') || 'Pick a room above';
}
