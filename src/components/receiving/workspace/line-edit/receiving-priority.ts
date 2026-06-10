/**
 * Client mirror of RECEIVING_PRIORITY_RANK_SQL in
 * src/app/api/receiving-lines/route.ts. Lower rank = higher priority. Kept in
 * lockstep with the server CASE so the badge shows the same order the
 * "Prioritize" sort uses: an explicit priority flag (pending-order match or
 * manual toggle) leads at rank 0, then unfound/untagged, then amazon → ebay →
 * goodwill, everything else trails. Platform half derived at read time.
 */
export function receivingPriorityRank(
  isUnmatched: boolean,
  sourcePlatform: string | null | undefined,
  isPriority?: boolean | null,
): number {
  if (isPriority) return 0;
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
 *
 * Labels MUST stay within the manual-tier vocabulary in
 * lib/receiving/priority-override.ts (Priority/High/Medium/Low) — the urgency
 * pill shows this derived label collapsed and the manual tiers as options, so
 * a word that isn't a selectable tier reads as a broken picker.
 */
export function receivingPriorityTone(rank: number): PriorityTone {
  switch (rank) {
    case 0:
      return {
        label: 'Priority',
        title: 'Flagged priority — pending-order match or manual; test/unbox first',
        className: 'bg-red-600 text-white',
      };
    case 1:
      return {
        label: 'High',
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
        // blue-600 (not -500) so the collapsed urgency pill matches the
        // platform/type pills, which share DEFAULT_ACTIVE's blue-600.
        className: 'bg-blue-600 text-white',
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
