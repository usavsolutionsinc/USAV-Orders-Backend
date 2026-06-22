/**
 * Flow²-lens node heat — Operations Studio "Flow²" lens (ST2).
 *
 * Pure sibling of `live-heat.ts`: the Live lens paints CURRENT occupancy, Flow²
 * paints the TREND/THROUGHPUT picture the GET /api/studio/flow feed already
 * assembled. This only decides how to PAINT what's there — it does not fetch or
 * poll (Studio law #4); the lens fetches once on activation.
 *
 * It reuses the Live lens's `HeatLevel` so the shared HEAT_* tone maps
 * (border/ring/wash, badge, accent, dot) apply unchanged — no new color system.
 *
 * Heat precedence (first match wins):
 *   1. node is a ranked bottleneck      ⇒ hot   (the worst offenders the API surfaced)
 *   2. fail rate ≥ 25%                   ⇒ hot   (lossy step, regardless of queue)
 *   3. WIP backing up (≥ 5) or fail > 0  ⇒ warm
 *   4. some throughput/queue signal      ⇒ active
 *   5. otherwise                         ⇒ idle
 */

import type { HeatLevel } from './live-heat';

/** Flow² WIP at/above this tips a node from active → warm. */
export const WARM_WIP = 5;
/** Fail fraction at/above this is hot on its own. */
export const HOT_FAIL_RATE = 0.25;

export interface FlowHeatInput {
  /** Latest snapshot queue depth sitting at the node. */
  currentWip: number;
  /** Fraction of runs that took a fail/error port (null when no runs). */
  failRate: number | null;
  /** Completed dwell samples observed in the window. */
  runCount: number;
  /** This node is in the API's ranked bottleneck list. */
  isBottleneck: boolean;
}

export interface FlowHeat {
  level: HeatLevel;
  /** Human-readable why-it's-hot, for the node tooltip. */
  reasons: string[];
}

export function computeFlowHeat({
  currentWip,
  failRate,
  runCount,
  isBottleneck,
}: FlowHeatInput): FlowHeat {
  const reasons: string[] = [];
  const fail = failRate ?? 0;
  if (currentWip > 0) reasons.push(`${currentWip} in queue`);
  if (fail > 0) reasons.push(`${Math.round(fail * 100)}% fail`);

  if (isBottleneck) {
    reasons.unshift('top bottleneck');
    return { level: 'hot', reasons };
  }
  if (fail >= HOT_FAIL_RATE) {
    return { level: 'hot', reasons };
  }
  if (currentWip >= WARM_WIP || fail > 0) {
    return { level: 'warm', reasons };
  }
  if (currentWip > 0 || runCount > 0) {
    return { level: 'active', reasons };
  }
  return { level: 'idle', reasons };
}
