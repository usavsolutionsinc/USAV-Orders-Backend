/**
 * Client mirror of RECEIVING_PRIORITY_RANK_SQL in
 * src/app/api/receiving-lines/route.ts. Lower rank = higher priority. Kept in
 * lockstep with the server CASE so the badge shows the same order the
 * "Prioritize" sort uses: unfound/untagged leads, then amazon → ebay →
 * goodwill, everything else trails. Derived at read time — no stored column.
 */
export function receivingPriorityRank(
  isUnmatched: boolean,
  sourcePlatform: string | null | undefined,
): number {
  const platform = (sourcePlatform ?? '').trim();
  if (isUnmatched || platform === '') return 1;
  switch (platform.toLowerCase()) {
    case 'amazon':
      return 2;
    case 'ebay':
      return 3;
    case 'goodwill':
      return 4;
    default:
      return 9;
  }
}

interface PriorityTone {
  /** Short label rendered in the badge (fixed-width, mirrors the Claim pill). */
  label: string;
  /** Longer text for the title tooltip. */
  title: string;
  /** Tailwind tone — color-coded so urgency reads at a glance. */
  className: string;
}

/**
 * Tone + label per rank. P1 is the most urgent (amber, like the unfound pill);
 * tagged platforms step down in heat; "other" is a quiet gray.
 */
export function receivingPriorityTone(rank: number): PriorityTone {
  switch (rank) {
    case 1:
      return {
        label: 'Urgent',
        title: 'Highest priority — unfound/untagged carton, triage first',
        className: 'bg-amber-500 text-white',
      };
    case 2:
      return {
        label: 'High',
        title: 'High priority — Amazon',
        className: 'bg-rose-500 text-white',
      };
    case 3:
      return {
        label: 'Medium',
        title: 'Medium priority — eBay',
        className: 'bg-blue-500 text-white',
      };
    case 4:
      return {
        label: 'Low',
        title: 'Low priority — Goodwill',
        className: 'bg-emerald-500 text-white',
      };
    default:
      return {
        label: 'Other',
        title: 'Lowest priority — other platform',
        className: 'bg-slate-400 text-white',
      };
  }
}
