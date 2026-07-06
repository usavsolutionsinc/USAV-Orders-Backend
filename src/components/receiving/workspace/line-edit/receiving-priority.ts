/**
 * Receiving priority badge — display tones for the platform-derived rank.
 *
 * The rank itself is single-sourced in src/lib/receiving/display/precedence.ts
 * (the rules-as-data SoT the server SQL `RECEIVING_PRIORITY_RANK_SQL` also
 * derives from, via priorityRankSql). Re-exported here as `receivingPriorityRank`
 * so existing badge importers keep their import path while the logic lives in one
 * place. Lower rank = higher priority.
 */
export { platformPriorityRank as receivingPriorityRank } from '@/lib/receiving/display/precedence';

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
        // ds-allow-raw-neutral: identity tone — neutral member of the colored filled-pill family
        className: 'bg-slate-400 text-white',
      };
  }
}
