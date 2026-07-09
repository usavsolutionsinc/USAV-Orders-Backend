/**
 * placement — the action layer that turns a decision node's SYMBOLIC placement
 * directive into a concrete bin the guarded writer can move a unit into
 * (Track 1, Stage 1.x — the placement strangle).
 *
 * The split this enforces:
 *   • decision-eval / decision.node  → pure ROUTING. Picks a graph port and,
 *     optionally, a symbolic `DecisionPlacement` (a bin barcode / lane key /
 *     target table). No DB, no side effects — the thin-adapter law.
 *   • THIS module                    → the ACTION half. Resolves the symbol to a
 *     real `locations` row, so a strangled site can hand the resolved `binId`
 *     to `applyTransition({ binId })` (which already stamps `bin_id` on the
 *     inventory_event). Resolution is the only DB touch, and it is injectable so
 *     the policy stays unit-testable DB-free (mirrors `resolvePartsBin`).
 *
 * Why a separate module and not a field on applyTransition: a placement symbol
 * may be unresolvable (bin not seeded for this org) — and an unresolved
 * placement must DEGRADE (the unit's status write still has to succeed), exactly
 * as `sortSerialToParts` returns `{ sorted:false, reason }` rather than throwing.
 * Keeping resolution here lets each strangled call site decide what to do when a
 * bin is missing, instead of failing the whole transition.
 */

import type { OrgId } from '@/lib/tenancy/constants';
import type { DecisionPlacement } from './decision-eval';

/** A placement symbol resolved to a concrete, addressable bin. */
export interface ResolvedPlacement {
  binId: number;
  binName: string;
}

/** Why a placement could not be resolved to a bin (for the caller's degrade path). */
export type PlacementResolutionMiss =
  | 'no_directive' // the rule carried no `placement` symbol (route-only)
  | 'bin_not_found'; // the symbol didn't match any seeded location for this org

export type ResolvePlacementResult =
  | { resolved: true; bin: ResolvedPlacement }
  | { resolved: false; reason: PlacementResolutionMiss };

/** Injectable lookups (real `locations` repo by default; fakes in tests). */
export interface PlacementResolverDeps {
  findByBarcode: (barcode: string) => Promise<{ id: number; name: string } | null>;
  findByName: (name: string) => Promise<{ id: number; name: string } | null>;
}

// The real `locations` repo pulls in the eager drizzle/db client, so it is
// LAZY-imported inside the default deps — importing this module (with injected
// fakes) stays DB-free, the same discipline the rest of the engine's
// Deps-injection tests rely on.
const defaultDeps: PlacementResolverDeps = {
  findByBarcode: async (barcode) => {
    const { findLocationByBarcode } = await import('@/lib/repositories/inventory/locations');
    return findLocationByBarcode(barcode);
  },
  findByName: async (name) => {
    const { findLocationByName } = await import('@/lib/repositories/inventory/locations');
    return findLocationByName(name);
  },
};

/**
 * Resolve a `DecisionPlacement.placement` symbol to a concrete bin. Matches the
 * `resolvePartsBin` precedence (barcode first, then name) so a directive can name
 * a bin either way. Returns a discriminated miss — never throws — so the caller's
 * status write can proceed even when the target bin isn't seeded.
 *
 * Note: `category` / `targetTable` / `targetQueue` are NOT resolved here — they
 * are coarser routing the per-site strangle consumes directly. This resolver
 * owns only the bin half (the `applyTransition({ binId })` seam).
 *
 * @param orgId reserved for the org-scoped lookup the GUC-wrapped repo will use;
 *        accepted now so call sites pass it from the start and the signature is
 *        stable when the repo reads become tenant-scoped.
 */
export async function resolvePlacementBin(
  placement: DecisionPlacement | null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- threaded for the forthcoming org-scoped lookup; see @param
  orgId: OrgId,
  deps: PlacementResolverDeps = defaultDeps,
): Promise<ResolvePlacementResult> {
  const symbol = placement?.placement?.trim();
  if (!symbol) return { resolved: false, reason: 'no_directive' };

  const loc = (await deps.findByBarcode(symbol)) ?? (await deps.findByName(symbol));
  if (!loc) return { resolved: false, reason: 'bin_not_found' };

  return { resolved: true, bin: { binId: loc.id, binName: loc.name } };
}
