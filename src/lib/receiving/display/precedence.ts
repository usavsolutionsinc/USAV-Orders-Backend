/**
 * Receiving precedence — rules-as-data SoT.
 *
 * Plan: docs/todo/polymorphic-tables-database-refactor-plan.md §2c / §7 Step E.
 * Model: src/lib/order-lifecycle.ts (precedence expressed as inspectable data,
 * presentation kept out).
 *
 * The receiving "Prioritize" rank was duplicated THREE times — the server SQL
 * `RECEIVING_PRIORITY_RANK_SQL` (app/api/receiving-lines/route.ts), the client
 * badge `receivingPriorityRank` (components/.../receiving-priority.ts), and the
 * manual-tier twin in lib/receiving/priority-override.ts. This module is the one
 * place the rank data lives; the SQL fragment and the JS rank are both DERIVED
 * from it, so the badge and the sort can never drift.
 *
 * Pure + isomorphic — no DB, no React. The server SQL builder and the client
 * badge both import from here. (The Incoming-exclusive `delivery_state` buckets
 * are NOT here: they need server-only carrier predicates and belong to the
 * incoming street — see streets/incoming/delivery-state.ts.)
 */

/** Rank for a manually/auto-flagged carton (is_priority) — leads the sort. */
export const PRIORITY_RANK_FLAGGED = 0;
/** Rank for an unmatched / untagged carton (no source platform). */
export const PRIORITY_RANK_UNMATCHED = 1;
/** Rank for any platform without a specific rank below. */
export const PRIORITY_RANK_OTHER = 9;

/**
 * Platform → rank, after the flagged (0) and unmatched (1) cases. This array IS
 * the source of truth; both the SQL CASE and the JS lookup derive from it. Add a
 * platform here and both surfaces update together.
 */
export const PRIORITY_PLATFORM_RANKS: ReadonlyArray<{ platform: string; rank: number }> = [
  { platform: 'amazon', rank: 2 },
  { platform: 'ebay', rank: 3 },
  { platform: 'goodwill', rank: 4 },
];

/**
 * The platform-derived rank (lower = higher priority). This is the JS twin of the
 * SQL CASE inside {@link priorityRankSql} — same data, same order. The manual
 * `priority_tier` override is applied separately (it COALESCEs over this in SQL;
 * the badge shows this platform half).
 */
export function platformPriorityRank(
  isUnmatched: boolean,
  sourcePlatform: string | null | undefined,
  isPriority?: boolean | null,
): number {
  if (isPriority) return PRIORITY_RANK_FLAGGED;
  const platform = (sourcePlatform ?? '').trim();
  if (isUnmatched || platform === '') return PRIORITY_RANK_UNMATCHED;
  const hit = PRIORITY_PLATFORM_RANKS.find((r) => r.platform === platform.toLowerCase());
  return hit ? hit.rank : PRIORITY_RANK_OTHER;
}

/** Column/expression names for {@link priorityRankSql} (lets carton/line callers vary the alias). */
export interface PriorityRankSqlCols {
  /** Manual override column, e.g. 'r.priority_tier'. */
  tier: string;
  /** is_priority boolean column, e.g. 'r.is_priority'. */
  isPriority: string;
  /** source column (the 'unmatched' sentinel), e.g. 'r.source'. */
  source: string;
  /** source_platform column, e.g. 'r.source_platform'. */
  sourcePlatform: string;
}

/**
 * Build the `COALESCE(tier, CASE …)` priority-rank SQL fragment from the same
 * rank data the JS twin uses. Drop-in replacement for the hand-written
 * `RECEIVING_PRIORITY_RANK_SQL` const — manual tier wins via COALESCE, then the
 * platform CASE.
 */
export function priorityRankSql(cols: PriorityRankSqlCols): string {
  const platformWhens = PRIORITY_PLATFORM_RANKS
    .map((r) => `    WHEN lower(${cols.sourcePlatform}) = '${r.platform}' THEN ${r.rank}`)
    .join('\n');
  return `
  COALESCE(${cols.tier}, CASE
    WHEN COALESCE(${cols.isPriority}, false) THEN ${PRIORITY_RANK_FLAGGED}
    WHEN ${cols.source} = 'unmatched' OR ${cols.sourcePlatform} IS NULL THEN ${PRIORITY_RANK_UNMATCHED}
${platformWhens}
    ELSE ${PRIORITY_RANK_OTHER}
  END)`;
}
