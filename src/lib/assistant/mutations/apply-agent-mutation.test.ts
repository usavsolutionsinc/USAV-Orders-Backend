/**
 * DB-free unit tests for the applyAgentMutation chokepoint (universal-feed
 * plan §2.6). A fake tenant client scripts row reads and captures writes; a
 * fake sideEffects captures the post-commit audit/ops/Ably payload.
 * Run: npm run test:assistant
 */

// The @/lib/workflow barrel (imported below for hasNode's node-type registry)
// transitively loads @/lib/drizzle/db, which needs a well-formed DATABASE_URL
// at load. `npm run test:assistant` supplies one via tsx's .env injection; no
// query ever runs (every DB call goes through the injected fake client).
import '@/lib/assistant/test-db-url'; // MUST be first: sets DATABASE_URL before the barrel loads
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '@/lib/workflow'; // side-effect: registers built-in node types (hasNode)
import {
  applyAgentMutation,
  revertAgentMutation,
  type AgentMutationSideEffects,
  type ApplyAgentMutationDeps,
} from './apply-agent-mutation';

const ORG = '11111111-2222-3333-4444-555555555555';

interface Cap {
  queries: Array<{ text: string; params: ReadonlyArray<unknown> }>;
  side: AgentMutationSideEffects[];
}

/**
 * scriptRows(text) → rows for a matching SELECT/RETURNING; default the
 * agent_mutations INSERT returns id 500.
 */
function fakes(scriptRows: (text: string) => Array<Record<string, unknown>> = () => []) {
  const cap: Cap = { queries: [], side: [] };
  let nextMutationId = 500;
  const client = {
    async query(text: string, params: ReadonlyArray<unknown> = []) {
      cap.queries.push({ text, params });
      if (text.includes('INSERT INTO agent_mutations')) {
        return { rows: [{ id: nextMutationId++ }], rowCount: 1 };
      }
      const rows = scriptRows(text);
      return { rows, rowCount: rows.length };
    },
  };
  const deps: ApplyAgentMutationDeps = {
    runTransaction: async (_orgId, fn) => fn(client as never),
    sideEffects: async (e) => {
      cap.side.push(e);
    },
  };
  return { deps, cap };
}

test('review-class (staff.create): proposes only, never applies', async () => {
  const { deps, cap } = fakes();
  const out = await applyAgentMutation(
    { organizationId: ORG, mutationKind: 'staff.create', payload: { name: 'New Tech' }, proposedByStaffId: 3 },
    deps,
  );
  assert.deepEqual(out, { ok: true, status: 'proposed', mutationId: 500, trust: 'review', targetRef: null });
  // Only the proposal INSERT (+ no affects, no dispatch write).
  const inserts = cap.queries.filter((q) => q.text.includes('INSERT INTO agent_mutations'));
  assert.equal(inserts.length, 1);
  assert.ok(inserts[0].text.includes("'proposed'"));
  assert.equal(cap.side[0].action, 'agent_mutation.propose');
  // No staff table touched.
  assert.ok(!cap.queries.some((q) => q.text.includes('INSERT INTO staff')));
});

test('auto-class (staff_rail_exclusion.insert): applies + affects + side-effects', async () => {
  const { deps, cap } = fakes();
  const out = await applyAgentMutation(
    {
      organizationId: ORG,
      mutationKind: 'staff_rail_exclusion.insert',
      payload: { staffId: 4, station: 'PACKING', feedKey: 'receiving_triage', entityType: 'RECEIVING', entityId: 77 },
      proposedByStaffId: 4,
    },
    deps,
  );
  assert.equal(out.ok, true);
  assert.equal((out as { status: string }).status, 'applied');
  assert.equal((out as { trust: string }).trust, 'auto');
  assert.equal((out as { targetRef: string }).targetRef, '77');

  assert.ok(cap.queries.some((q) => q.text.includes('INSERT INTO staff_rail_exclusions')));
  const mut = cap.queries.find((q) => q.text.includes('INSERT INTO agent_mutations'))!;
  assert.ok(mut.text.includes("'applied'"));
  // extra_audit carries the inverse for revert.
  const extra = JSON.parse(String(mut.params[5])) as { inverse: { kind: string } };
  assert.equal(extra.inverse.kind, 'staff_rail_exclusion.delete');
  assert.ok(cap.queries.some((q) => q.text.includes('INSERT INTO agent_mutation_affects')));
  assert.equal(cap.side[0].action, 'agent_mutation.apply');
});

test('draft-scoped (workflow_draft.add_node): validates draft + node type, mints id, applies', async () => {
  const { deps, cap } = fakes((text) => {
    if (text.includes('FROM workflow_definitions') && text.includes('FOR UPDATE')) {
      return [{ id: 12, is_active: false }]; // a draft
    }
    return [];
  });
  const out = await applyAgentMutation(
    { organizationId: ORG, mutationKind: 'workflow_draft.add_node', payload: { definitionId: 12, type: 'inspection' } },
    deps,
  );
  assert.equal(out.ok, true);
  assert.equal((out as { status: string }).status, 'applied');
  const targetRef = (out as { targetRef: string }).targetRef;
  assert.match(targetRef, /^n-/); // minted node id
  assert.ok(cap.queries.some((q) => q.text.includes('INSERT INTO workflow_nodes')));
});

test('draft-scoped rejects edits to the ACTIVE version (409)', async () => {
  const { deps } = fakes((text) =>
    text.includes('FROM workflow_definitions') && text.includes('FOR UPDATE') ? [{ id: 12, is_active: true }] : [],
  );
  const out = await applyAgentMutation(
    { organizationId: ORG, mutationKind: 'workflow_draft.add_node', payload: { definitionId: 12, type: 'inspection' } },
    deps,
  );
  assert.deepEqual(out, { ok: false, status: 409, error: 'the active version is read-only — edit a draft and publish it' });
});

test('unknown node type in a draft edit → 400 (mapped from the 422 writer status)', async () => {
  const { deps } = fakes((text) =>
    text.includes('FROM workflow_definitions') && text.includes('FOR UPDATE') ? [{ id: 12, is_active: false }] : [],
  );
  const out = await applyAgentMutation(
    { organizationId: ORG, mutationKind: 'workflow_draft.add_node', payload: { definitionId: 12, type: 'not_a_real_node_type_xyz' } },
    deps,
  );
  assert.equal(out.ok, false);
  assert.equal((out as { status: number }).status, 400);
});

test('unknown mutation kind → 400, no side effects', async () => {
  const { deps, cap } = fakes();
  const out = await applyAgentMutation({ organizationId: ORG, mutationKind: 'staff.delete', payload: {} }, deps);
  assert.deepEqual(out, { ok: false, status: 400, error: 'unknown mutation kind "staff.delete"' });
  assert.equal(cap.queries.length, 0);
  assert.equal(cap.side.length, 0);
});

test('entity_signal.insert is append-only: applied but non-revertable (null inverse)', async () => {
  const { deps, cap } = fakes(() => [{ id: 900 }]); // signal insert RETURNING id
  const out = await applyAgentMutation(
    {
      organizationId: ORG,
      mutationKind: 'entity_signal.insert',
      payload: { entityType: 'SERIAL_UNIT', entityId: 5, signalKind: 'test_fail_reason', notes: 'x' },
    },
    deps,
  );
  assert.equal(out.ok, true);
  const mut = cap.queries.find((q) => q.text.includes('INSERT INTO agent_mutations'))!;
  const extra = JSON.parse(String(mut.params[5])) as { inverse: unknown };
  assert.equal(extra.inverse, null);
});

test('entity_signal.insert with an invalid signal_kind is NOT recorded as applied', async () => {
  // Regression: emitEntitySignalSafe swallowed bad signals, so the chokepoint
  // committed an "applied" mutation for a write that never happened. Now a
  // validation failure surfaces as a non-applied 400 with no agent_mutations row.
  const { deps, cap } = fakes(() => [{ id: 900 }]);
  const out = await applyAgentMutation(
    {
      organizationId: ORG,
      mutationKind: 'entity_signal.insert',
      payload: { entityType: 'SERIAL_UNIT', entityId: 5, signalKind: 'definitely_not_a_signal', notes: 'x' },
    },
    deps,
  );
  assert.equal(out.ok, false);
  assert.equal((out as { status: number }).status, 400);
  // No "applied" agent_mutations row, and no post-commit side-effects fired.
  assert.ok(!cap.queries.some((q) => q.text.includes('INSERT INTO agent_mutations')));
  assert.equal(cap.side.length, 0);
});

test('revert side-effects carry the ORIGINAL mutation kind, not a placeholder', async () => {
  const inverse = { kind: 'feed_membership.set_state', payload: { feedKey: 'receiving_triage', entityType: 'RECEIVING', entityId: 42, state: 'active' } };
  const { deps, cap } = fakes((text) => {
    if (text.includes('FROM agent_mutations') && text.includes('FOR UPDATE')) {
      return [{ status: 'applied', mutation_kind: 'feed_membership.set_state', extra_audit: { inverse } }];
    }
    if (text.includes('SELECT state FROM feed_memberships')) return [{ state: 'done' }];
    return [];
  });
  const out = await revertAgentMutation(500, ORG, 4, deps);
  assert.equal(out.ok, true);
  assert.equal(cap.side[0].action, 'agent_mutation.revert');
  assert.equal(cap.side[0].mutationKind, 'feed_membership.set_state'); // not the 'entity_signal.insert' placeholder
});

test('revert: applied draft edit is undone via its captured inverse; status → reverted', async () => {
  const inverse = { kind: 'workflow_draft.remove_node', payload: { definitionId: 12, nodeId: 'n-abc' } };
  const { deps, cap } = fakes((text) => {
    if (text.includes('FROM agent_mutations') && text.includes('FOR UPDATE')) {
      return [{ status: 'applied', mutation_kind: 'workflow_draft.add_node', extra_audit: { inverse } }];
    }
    if (text.includes('FROM workflow_definitions') && text.includes('FOR UPDATE')) return [{ id: 12, is_active: false }];
    if (text.includes('FROM workflow_nodes') && text.includes('WHERE workflow_definition_id')) {
      return [{ id: 'n-abc', type: 'inspection', position_x: 0, position_y: 0, config: {} }];
    }
    return [];
  });
  const out = await revertAgentMutation(500, ORG, 4, deps);
  assert.equal(out.ok, true);
  assert.equal(out.status, 200);
  // The inverse (remove_node) ran + status flipped to reverted.
  assert.ok(cap.queries.some((q) => q.text.includes('DELETE FROM workflow_nodes')));
  assert.ok(cap.queries.some((q) => q.text.includes("SET status = 'reverted'")));
  assert.equal(cap.side[0].action, 'agent_mutation.revert');
});

test('revert: a non-applied mutation is 409; a missing one is 404', async () => {
  const proposed = fakes((text) =>
    text.includes('FROM agent_mutations') && text.includes('FOR UPDATE')
      ? [{ status: 'proposed', mutation_kind: 'staff.create', extra_audit: {} }]
      : [],
  );
  const r1 = await revertAgentMutation(500, ORG, 4, proposed.deps);
  assert.equal(r1.status, 409);

  const missing = fakes(() => []);
  const r2 = await revertAgentMutation(999, ORG, 4, missing.deps);
  assert.equal(r2.status, 404);
});

test('revert of an append-only mutation (null inverse) is 409', async () => {
  const { deps } = fakes((text) =>
    text.includes('FROM agent_mutations') && text.includes('FOR UPDATE')
      ? [{ status: 'applied', mutation_kind: 'entity_signal.insert', extra_audit: { inverse: null } }]
      : [],
  );
  const out = await revertAgentMutation(500, ORG, 4, deps);
  assert.equal(out.status, 409);
  assert.match(out.error ?? '', /not revertable/);
});

test('feed_membership.set_state captures the PRIOR state as the inverse', async () => {
  const { deps, cap } = fakes((text) =>
    text.includes('SELECT state FROM feed_memberships') ? [{ state: 'active' }] : [],
  );
  const out = await applyAgentMutation(
    {
      organizationId: ORG,
      mutationKind: 'feed_membership.set_state',
      payload: { feedKey: 'receiving_triage', entityType: 'RECEIVING', entityId: 42, state: 'done' },
    },
    deps,
  );
  assert.equal(out.ok, true);
  const mut = cap.queries.find((q) => q.text.includes('INSERT INTO agent_mutations'))!;
  const extra = JSON.parse(String(mut.params[5])) as { inverse: { payload: { state: string } } };
  assert.equal(extra.inverse.payload.state, 'active'); // restores prior
});
