/**
 * placement-parity — the OBSERVE-ONLY shim for the placement strangle
 * (UNIFIED-ENGINE-MASTER-PLAN §1.6 Track 1, Stage 1.x).
 *
 * Each hardcoded placement site is converted in two moves:
 *   1. (this) OBSERVE — alongside the live hardcoded bin pick, compute what the
 *      declarative `resolveDecision → resolvePlacementBin` mechanism WOULD pick,
 *      and log match / DIVERGENCE / unseeded. Zero behavior change; the hardcoded
 *      path stays the source of truth. This proves the new mechanism returns the
 *      identical bin before anything is flipped.
 *   2. (later) CUTOVER — behind a per-site PLACEMENT_STRANGLE_* flag, the site
 *      consumes the resolved placement and the hardcode is deleted.
 *
 * The observer is fire-and-forget and SELF-GUARDED: it never throws, so a parity
 * fault (bad config, missing bin, lookup error) can never disturb the real move —
 * the same degrade-not-fail discipline `sortSerialUnitToParts` already follows.
 */

import { isPlacementParityObserve } from '@/lib/feature-flags';
import type { OrgId } from '@/lib/tenancy/constants';
import { resolveDecision, type DecisionFacts, type DecisionRule } from './decision-eval';
import {
  resolvePlacementBin,
  type PlacementResolverDeps,
  type ResolvePlacementResult,
} from './placement';

interface PlacementParityInput {
  /** Stable site key for the log line, e.g. 'parts-sort'. */
  site: string;
  /** The org whose decision policy this is (and the scope of the bin lookup). */
  orgId: OrgId;
  /** The routing facts for this unit (grade / channel / disposition). */
  facts: DecisionFacts;
  /** The declarative placement policy this site is strangling onto. */
  rules: readonly DecisionRule[];
  /** Default port for the policy (a default carries no placement). */
  defaultPort?: string | null;
  /** The bin the LIVE hardcoded path actually used (null when it picked none). */
  expected: { binId: number; binName: string } | null;
  /** Injectable bin resolver (real `locations` repo by default; fakes in tests). */
  deps?: PlacementResolverDeps;
  /** Injectable sink so the comparison is unit-testable without spying on console. */
  log?: (entry: PlacementParityLog) => void;
}

export type PlacementParityVerdict =
  | 'match' // mechanism resolved the SAME bin the hardcoded path used
  | 'divergence' // mechanism resolved a DIFFERENT bin (or one where the live path picked none)
  | 'decision_layer_unseeded' // no placement directive matched — the decision layer isn't configured for this routing yet
  | 'bin_not_found'; // a placement directive matched but its symbol resolved to no seeded bin

export interface PlacementParityLog {
  site: string;
  orgId: OrgId;
  verdict: PlacementParityVerdict;
  facts: DecisionFacts;
  /** The bin the live path used. */
  expectedBinId: number | null;
  /** The bin the decision mechanism resolved. */
  resolvedBinId: number | null;
  /** The symbolic placement the matched rule carried, if any. */
  placement: string | null;
}

function defaultLog(entry: PlacementParityLog): void {
  const head = `[placement-parity] ${entry.site} org=${entry.orgId} ${entry.verdict}`;
  if (entry.verdict === 'divergence') {
    // The one that matters — surface loudly so a real mismatch is never missed.
    console.warn(
      `${head} expectedBin=${entry.expectedBinId} resolvedBin=${entry.resolvedBinId} placement=${entry.placement} facts=${JSON.stringify(entry.facts)}`,
    );
  } else {
    console.info(`${head} bin=${entry.resolvedBinId ?? entry.expectedBinId}`);
  }
}

/**
 * Observe (don't act on) placement parity for one unit at one site. No-op unless
 * PLACEMENT_PARITY_OBSERVE is on. Awaitable for tests, but call sites should
 * fire-and-forget (`void observePlacementParity(...)`) so observation never sits
 * on the move's critical path. Never throws.
 */
export async function observePlacementParity(input: PlacementParityInput): Promise<void> {
  if (!isPlacementParityObserve()) return;
  const log = input.log ?? defaultLog;
  try {
    const outcome = resolveDecision(input.rules, input.defaultPort, input.facts);
    let resolution: ResolvePlacementResult = { resolved: false, reason: 'no_directive' };
    if (outcome.placement) {
      resolution = await resolvePlacementBin(outcome.placement, input.orgId, input.deps);
    }

    const resolvedBinId = resolution.resolved ? resolution.bin.binId : null;
    const expectedBinId = input.expected?.binId ?? null;

    let verdict: PlacementParityVerdict;
    if (!outcome.placement) {
      verdict = 'decision_layer_unseeded';
    } else if (!resolution.resolved) {
      verdict = 'bin_not_found';
    } else {
      verdict = resolvedBinId === expectedBinId ? 'match' : 'divergence';
    }

    log({
      site: input.site,
      orgId: input.orgId,
      verdict,
      facts: input.facts,
      expectedBinId,
      resolvedBinId,
      placement: outcome.placement?.placement ?? null,
    });
  } catch (err) {
    // Self-guarded: a parity fault is a no-op, never a disturbance to the move.
    console.warn(`[placement-parity] ${input.site} observer error (ignored):`, err);
  }
}
