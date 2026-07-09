/**
 * Agent-mutation accept/reject stats (universal-feed plan Phase 5 — the input
 * to trust-list widening). Aggregates `agent_mutations` by (mutation_kind,
 * status) for an org so a human can see which kinds the AI gets RIGHT (applied
 * and kept) vs. WRONG (reverted / rejected) before promoting a kind's trust
 * class (review → draft_scoped → auto). Read-only, org-scoped.
 *
 * The widening decision itself stays a deliberate PR that edits MUTATION_KINDS +
 * the pinned registry test (see registry.ts "Widening protocol") — this readout
 * only surfaces the evidence.
 *
 * Deps-injected (default tenantQuery) so it unit-tests DB-free.
 */

import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { MUTATION_KINDS, type MutationTrustClass } from '@/lib/surfaces/registry';

export interface MutationKindStat {
  mutationKind: string;
  /** Registry trust class, or 'unknown' for a kind no longer in the registry. */
  trust: MutationTrustClass | 'unknown';
  total: number;
  applied: number;
  reverted: number;
  rejected: number;
  proposed: number;
  approved: number;
  underReview: number;
  /**
   * applied / (applied + reverted + rejected) — the "kept vs undone/refused"
   * signal that justifies widening. null when no decided outcomes yet.
   */
  acceptanceRate: number | null;
}

export interface MutationStatsDeps {
  query: typeof tenantQuery;
}

const defaultDeps: MutationStatsDeps = { query: tenantQuery };

const STATUS_FIELD: Record<string, keyof MutationKindStat> = {
  applied: 'applied',
  reverted: 'reverted',
  rejected: 'rejected',
  proposed: 'proposed',
  approved: 'approved',
  under_review: 'underReview',
};

function trustOf(kind: string): MutationTrustClass | 'unknown' {
  return Object.hasOwn(MUTATION_KINDS, kind)
    ? MUTATION_KINDS[kind as keyof typeof MUTATION_KINDS].trust
    : 'unknown';
}

/** Per-kind mutation outcome stats, newest activity first, most-used kind first. */
export async function getMutationTrustStats(
  orgId: OrgId,
  deps: MutationStatsDeps = defaultDeps,
): Promise<MutationKindStat[]> {
  const r = await deps.query<{ mutation_kind: string; status: string; n: number }>(
    orgId,
    `SELECT mutation_kind, status, COUNT(*)::int AS n
       FROM agent_mutations
      WHERE organization_id = $1
      GROUP BY mutation_kind, status`,
    [orgId],
  );

  const byKind = new Map<string, MutationKindStat>();
  for (const row of r.rows) {
    let stat = byKind.get(row.mutation_kind);
    if (!stat) {
      stat = {
        mutationKind: row.mutation_kind,
        trust: trustOf(row.mutation_kind),
        total: 0,
        applied: 0,
        reverted: 0,
        rejected: 0,
        proposed: 0,
        approved: 0,
        underReview: 0,
        acceptanceRate: null,
      };
      byKind.set(row.mutation_kind, stat);
    }
    const n = Number(row.n) || 0;
    stat.total += n;
    const field = STATUS_FIELD[row.status];
    if (field) (stat[field] as number) += n;
  }

  const stats = Array.from(byKind.values());
  for (const s of stats) {
    const decided = s.applied + s.reverted + s.rejected;
    s.acceptanceRate = decided > 0 ? Math.round((s.applied / decided) * 1000) / 10 : null;
  }
  // Most-exercised kinds first (the ones with enough evidence to act on).
  stats.sort((a, b) => b.total - a.total || a.mutationKind.localeCompare(b.mutationKind));
  return stats;
}
