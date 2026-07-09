/**
 * DB-free tests for agent-mutation trust stats (Phase 5 trust-widening evidence).
 * Run: npx tsx --test src/lib/assistant/mutations/trust-stats.test.ts
 */

import '@/lib/assistant/test-db-url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getMutationTrustStats, type MutationStatsDeps } from './trust-stats';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = '11111111-2222-3333-4444-555555555555' as OrgId;

function fakes(rows: Array<{ mutation_kind: string; status: string; n: number }>) {
  const cap: { params: ReadonlyArray<unknown>[] } = { params: [] };
  const deps: MutationStatsDeps = {
    query: (async (_orgId: OrgId, _text: string, params: ReadonlyArray<unknown>) => {
      cap.params.push(params);
      return { rows, rowCount: rows.length };
    }) as MutationStatsDeps['query'],
  };
  return { deps, cap };
}

test('getMutationTrustStats: folds statuses per kind, computes acceptance, attaches trust', async () => {
  const { deps, cap } = fakes([
    { mutation_kind: 'staff_rail_exclusion.insert', status: 'applied', n: 8 },
    { mutation_kind: 'staff_rail_exclusion.insert', status: 'reverted', n: 2 },
    { mutation_kind: 'workflow_draft.add_node', status: 'applied', n: 3 },
    { mutation_kind: 'staff.create', status: 'proposed', n: 5 },
    { mutation_kind: 'staff.create', status: 'rejected', n: 1 },
  ]);
  const stats = await getMutationTrustStats(ORG, deps);

  // Most-exercised kind first: staff_rail_exclusion.insert (10) > staff.create (6) > add_node (3)
  assert.equal(stats[0].mutationKind, 'staff_rail_exclusion.insert');
  assert.equal(stats[0].trust, 'auto');
  assert.equal(stats[0].total, 10);
  assert.equal(stats[0].applied, 8);
  assert.equal(stats[0].reverted, 2);
  assert.equal(stats[0].acceptanceRate, 80); // 8 / (8+2)

  const staffCreate = stats.find((s) => s.mutationKind === 'staff.create')!;
  assert.equal(staffCreate.trust, 'review');
  assert.equal(staffCreate.proposed, 5);
  assert.equal(staffCreate.rejected, 1);
  assert.equal(staffCreate.acceptanceRate, 0); // 0 applied / (0+0+1) decided

  const addNode = stats.find((s) => s.mutationKind === 'workflow_draft.add_node')!;
  assert.equal(addNode.trust, 'draft_scoped');
  assert.equal(addNode.acceptanceRate, 100); // 3 / (3+0+0)

  assert.deepEqual(cap.params[0], [ORG]); // org-scoped
});

test('getMutationTrustStats: unknown kind → trust "unknown", no decided outcomes → null rate', async () => {
  const { deps } = fakes([{ mutation_kind: 'legacy.kind_gone', status: 'proposed', n: 2 }]);
  const stats = await getMutationTrustStats(ORG, deps);
  assert.equal(stats[0].trust, 'unknown');
  assert.equal(stats[0].acceptanceRate, null); // only 'proposed', nothing decided
});

test('getMutationTrustStats: empty → []', async () => {
  const { deps } = fakes([]);
  assert.deepEqual(await getMutationTrustStats(ORG, deps), []);
});
