/**
 * placement-policy — resolve a tenant's placement rules from its Studio graph
 * (UNIFIED-ENGINE-MASTER-PLAN §1.6 Track 1, Stage 1.x).
 *
 * This is what makes the placement strangle "config, not code": instead of a
 * site hardcoding a bin, it asks for the org's decision-table rules and resolves
 * the destination from them — so an operator editing a `decision` node in
 * /studio (DecisionRulesEditor) changes runtime routing with no deploy.
 *
 * The policy is the UNION of every `decision` node's rules in the org's ACTIVE
 * workflow definition. A site passes its facts (e.g. { disposition: 'parts' });
 * `resolveDecision` first-match-wins picks the rule, and the rule's `then`
 * placement directive is what the action layer (`placement.ts`) resolves to a
 * bin. When the org's graph carries no matching placement rule, the loader
 * returns the rules it found (possibly none) and the caller falls back to its
 * system-default policy — so a tenant that hasn't authored a decision node keeps
 * today's behavior exactly.
 *
 * DB reads are lazy-imported in the default deps so importing this module (tests
 * inject fakes) never pulls in the drizzle client — the engine's DB-free-test
 * discipline.
 */

import type { OrgId } from '@/lib/tenancy/constants';
import {
  parseDecisionRules,
  resolveDecision,
  type DecisionFacts,
  type DecisionRule,
} from './decision-eval';
import {
  resolvePlacementBin,
  type PlacementResolverDeps,
  type ResolvedPlacement,
} from './placement';

interface PlacementPolicyDeps {
  /** Configs of every `decision` node in the org's ACTIVE workflow definition. */
  loadActiveDecisionConfigs: (orgId: OrgId) => Promise<Array<Record<string, unknown>>>;
}

const defaultDeps: PlacementPolicyDeps = {
  loadActiveDecisionConfigs: async (orgId) => {
    const { db } = await import('@/lib/drizzle/db');
    const { workflowDefinitions, workflowNodes } = await import('@/lib/drizzle/schema');
    const { and, eq, desc } = await import('drizzle-orm');

    const [def] = await db
      .select({ id: workflowDefinitions.id })
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.organizationId, orgId),
          eq(workflowDefinitions.isActive, true),
        ),
      )
      .orderBy(desc(workflowDefinitions.version))
      .limit(1);
    if (!def) return [];

    const rows = await db
      .select({ config: workflowNodes.config })
      .from(workflowNodes)
      .where(
        and(
          eq(workflowNodes.workflowDefinitionId, def.id),
          eq(workflowNodes.type, 'decision'),
        ),
      );
    return rows.map((r) => (r.config ?? {}) as Record<string, unknown>);
  },
};

/**
 * The org's placement rules — the union of every decision node's `config.rules`
 * in its active definition. Returns [] when the org has no active definition or
 * no decision nodes (the caller then uses its system-default policy). Never
 * throws on a read fault — degrades to [] so a strangled site falls back safely.
 */
export async function loadOrgPlacementRules(
  orgId: OrgId,
  deps: PlacementPolicyDeps = defaultDeps,
): Promise<DecisionRule[]> {
  try {
    const configs = await deps.loadActiveDecisionConfigs(orgId);
    return configs.flatMap((cfg) => parseDecisionRules(cfg.rules));
  } catch (err) {
    console.warn(`[placement-policy] could not load org=${orgId} decision rules (ignored):`, err);
    return [];
  }
}

/** A resolved site placement + which policy layer it came from (for logging). */
interface SitePlacementResult {
  bin: ResolvedPlacement;
  source: 'org' | 'system';
}

/**
 * Resolve a destination bin for a strangled site from the declarative policy:
 * the org's Studio decision rules FIRST (config wins), then the caller's
 * system-default policy. Returns null when neither yields a resolvable bin —
 * the caller then degrades to its legacy hardcoded resolver. Never throws (each
 * layer self-guards). This is the single entry a converting site calls.
 */
export async function resolveSitePlacementBin(args: {
  orgId: OrgId;
  facts: DecisionFacts;
  /** The site's built-in default policy (expresses today's hardcoded routing). */
  systemPolicy: readonly DecisionRule[];
  policyDeps?: PlacementPolicyDeps;
  binDeps?: PlacementResolverDeps;
}): Promise<SitePlacementResult | null> {
  const tryPolicy = async (
    rules: readonly DecisionRule[],
    source: 'org' | 'system',
  ): Promise<SitePlacementResult | null> => {
    const placement = resolveDecision(rules, null, args.facts).placement;
    if (!placement) return null;
    const res = await resolvePlacementBin(placement, args.orgId, args.binDeps);
    return res.resolved ? { bin: res.bin, source } : null;
  };

  const orgRules = await loadOrgPlacementRules(args.orgId, args.policyDeps);
  return (await tryPolicy(orgRules, 'org')) ?? (await tryPolicy(args.systemPolicy, 'system'));
}
