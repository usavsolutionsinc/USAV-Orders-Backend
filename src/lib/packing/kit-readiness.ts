/**
 * Kit-readiness — the single source of truth for "is the box matched?".
 *
 * Pure + DB-free: given a SKU's kit parts, the parts a packer has confirmed,
 * and the org's enforcement mode, it computes whether the pack is complete and
 * whether it should be hard-blocked. Both the packer UI (PackChecklist) and the
 * engine (kit_verify node) read their verdict from here so the matched/short
 * rule can never drift between surfaces.
 *
 * GRACEFUL DEGRADATION is the load-bearing rule: enforcement only bites when
 * expected items are KNOWN (the SKU has *critical* kit parts). No critical
 * parts ⇒ nothing to match ⇒ never blocked, whatever the mode. This is what
 * lets a tenant flip block_until_matched on without bricking packing for SKUs
 * whose BOM it hasn't populated yet.
 */

import type { PackingEnforcement } from '@/lib/tenancy/settings';

export type { PackingEnforcement };

/** Minimal shape the verdict needs from a kit part. */
export interface KitReadinessPart {
  id: number;
  critical: boolean;
}

export interface KitReadiness {
  /** # of critical parts expected in the box. */
  requiredTotal: number;
  /** # of critical parts the packer has confirmed. */
  requiredConfirmed: number;
  /** ids of critical parts not yet confirmed. */
  missingRequiredIds: number[];
  /** True when every critical part is confirmed (or there are none). */
  allRequiredIn: boolean;
  /** Whether the pack should be hard-blocked given the enforcement mode. */
  blocked: boolean;
}

export function evaluateKitReadiness(
  parts: KitReadinessPart[],
  confirmedIds: Iterable<number>,
  enforcement: PackingEnforcement,
): KitReadiness {
  const confirmed = confirmedIds instanceof Set ? confirmedIds : new Set(confirmedIds);
  const critical = parts.filter((p) => p.critical);
  const missingRequiredIds = critical.filter((p) => !confirmed.has(p.id)).map((p) => p.id);
  const requiredTotal = critical.length;
  const requiredConfirmed = requiredTotal - missingRequiredIds.length;
  const allRequiredIn = missingRequiredIds.length === 0;
  // Graceful degradation: nothing expected ⇒ never blocks, whatever the mode.
  const blocked = enforcement === 'block_until_matched' && requiredTotal > 0 && !allRequiredIn;
  return { requiredTotal, requiredConfirmed, missingRequiredIds, allRequiredIn, blocked };
}
