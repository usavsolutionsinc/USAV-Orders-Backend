/**
 * Live-lens node heat — Operations Studio "Live" lens
 * (PR #2 of docs/operations-studio/Full Code Base Upgrade).
 *
 * Pure: turns one node's live occupancy (the `StudioLiveNode` the
 * GET /api/studio/live feed already returns) into a heat level so a bottleneck
 * is obvious at a glance — slate (idle) → blue (active) → amber (approaching
 * SLA) → rose (over SLA / in error). It does NOT fetch or poll: the Live lens
 * is already event-driven over Ably with a debounced refetch (Studio law #4);
 * this only decides how to PAINT what's there.
 *
 * Heat precedence (first match wins):
 *   1. any item in error            ⇒ hot   (needs triage regardless of count)
 *   2. nothing sitting at the node  ⇒ idle
 *   3. oldest item ≥ its SLA        ⇒ hot
 *   4. oldest item ≥ 75% of SLA     ⇒ warm
 *   5. otherwise                    ⇒ active
 */

export type HeatLevel = 'idle' | 'active' | 'warm' | 'hot';

export interface HeatInput {
  /** Items physically sitting at the node (active + blocked). */
  total: number;
  /** Items parked in error status. */
  error: number;
  /** Oldest item's age in hours, or null when the node is empty. */
  ageHours: number | null;
  /** The node's SLA in hours, or null when unset. */
  slaHours: number | null;
}

export interface NodeHeat {
  level: HeatLevel;
  /** Fraction of SLA the oldest item has consumed (0..∞), or null without age/SLA. */
  slaRatio: number | null;
  /** Human-readable why-it's-hot, for the node tooltip. */
  reasons: string[];
}

/** Oldest item past this fraction of its SLA tips a node from active → warm. */
export const WARM_SLA_RATIO = 0.75;

export function computeNodeHeat({ total, error, ageHours, slaHours }: HeatInput): NodeHeat {
  const reasons: string[] = [];
  const slaRatio =
    ageHours != null && slaHours != null && slaHours > 0 ? ageHours / slaHours : null;

  // Errors always need triage — hot even if nothing else is queued.
  if (error > 0) {
    reasons.push(`${error} in error`);
    return { level: 'hot', slaRatio, reasons };
  }
  if (total <= 0) {
    return { level: 'idle', slaRatio, reasons };
  }
  if (slaRatio != null && slaRatio >= 1) {
    reasons.push('over SLA');
    return { level: 'hot', slaRatio, reasons };
  }
  if (slaRatio != null && slaRatio >= WARM_SLA_RATIO) {
    reasons.push('approaching SLA');
    return { level: 'warm', slaRatio, reasons };
  }
  return { level: 'active', slaRatio, reasons };
}
