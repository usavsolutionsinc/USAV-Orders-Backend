/**
 * Built-in station nodes — event-gating + routing through the seeded
 * "Standard refurb-and-list" v1 graph shape (see
 * src/lib/migrations/2026-06-11b_seed_reseller_workflow_v1.sql).
 *
 * Uses the REAL registered NodeDefinitions (import side-effects below) with
 * the same in-memory store harness as advance.test.ts, so it proves the
 * Phase-1 contract end to end: taps advance, replays park, fail loops
 * through repair, and ship is terminal.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceItem, type AdvanceDeps, type AdvanceOutcome } from './advance';
import { selectNextTarget, type WorkflowEdgeLike } from './router';
import { getNode } from './registry';
import type { ItemState, RunRecord, WorkflowStore } from './contract';

// Register the built-in nodes (import side-effect, same as ./index.ts).
import './nodes/receiving.node';
import './nodes/inspection.node';
import './nodes/repair.node';
import './nodes/list-ebay.node';
import './nodes/pack.node';
import './nodes/ship.node';

const ORG = 'test-org';
const DEF_ID = 1;
const ACTOR = { staffId: 7, source: 'scan' as const };

// Mirror of the seeded refurb-v1 graph (node id → type, edges).
const NODES: Record<string, { type: string }> = {
  receive: { type: 'receiving' },
  'test-grade': { type: 'inspection' },
  repair: { type: 'repair' },
  list: { type: 'list_ebay' },
  pack: { type: 'pack' },
  ship: { type: 'ship' },
};
const EDGES: WorkflowEdgeLike[] = [
  { sourceNode: 'receive', sourcePort: 'received', targetNode: 'test-grade' },
  { sourceNode: 'test-grade', sourcePort: 'pass', targetNode: 'list' },
  { sourceNode: 'test-grade', sourcePort: 'fail', targetNode: 'repair' },
  { sourceNode: 'repair', sourcePort: 'repaired', targetNode: 'test-grade' },
  { sourceNode: 'list', sourcePort: 'listed', targetNode: 'pack' },
  { sourceNode: 'pack', sourcePort: 'packed', targetNode: 'ship' },
  // ship.shipped intentionally unrouted → terminal
];

function harness(start: string) {
  let state: ItemState | null = {
    serialUnitId: 1,
    workflowDefinitionId: DEF_ID,
    currentNodeId: start,
    status: 'active',
    context: {},
  };
  const runs: RunRecord[] = [];

  const store: WorkflowStore = {
    async loadState() {
      return state;
    },
    async loadNode(_defId, nodeId) {
      const n = NODES[nodeId];
      return n ? { type: n.type, config: {} } : null;
    },
    async resolveNext(_defId, sourceNode, sourcePort) {
      return selectNextTarget(EDGES, sourceNode, sourcePort);
    },
    async moveTo(s, nextNodeId, patch) {
      state = {
        ...s,
        currentNodeId: nextNodeId,
        status: 'active',
        context: { ...s.context, ...patch },
      };
    },
    async setStatus(s, status, patch) {
      state = { ...s, status, context: patch ? { ...s.context, ...patch } : s.context };
    },
    async recordRun(r) {
      runs.push(r);
    },
  };

  const deps: AdvanceDeps = { store, getNode, emit: async () => {} };

  return {
    deps,
    runs,
    get state() {
      return state;
    },
    advance(input: Record<string, unknown>): Promise<AdvanceOutcome> {
      return advanceItem(deps, { orgId: ORG, serialUnitId: 1, actor: ACTOR, input });
    },
  };
}

test('happy path: received → pass → listed → packed → shipped → done', async () => {
  const h = harness('receive');

  let out = await h.advance({ event: 'unit_received' });
  assert.equal(out.status, 'moved');
  assert.equal(h.state?.currentNodeId, 'test-grade');

  out = await h.advance({ event: 'test_verdict', verdict: 'PASS' });
  assert.equal(out.status, 'moved');
  assert.equal(h.state?.currentNodeId, 'list');
  assert.equal(h.state?.context.verdict, 'PASS');

  out = await h.advance({ event: 'listed', listingId: 'ebay-123' });
  assert.equal(out.status, 'moved');
  assert.equal(h.state?.currentNodeId, 'pack');

  out = await h.advance({ event: 'packed' });
  assert.equal(out.status, 'moved');
  assert.equal(h.state?.currentNodeId, 'ship');

  out = await h.advance({ event: 'shipped', trackingNumber: '1Z…' });
  assert.equal(out.status, 'done'); // shipped port unrouted → terminal
  assert.equal(h.state?.status, 'done');
});

test('fail → repair → repaired → re-test loop', async () => {
  const h = harness('test-grade');

  let out = await h.advance({ event: 'test_verdict', verdict: 'TESTING_FAILED' });
  assert.equal(out.status, 'moved');
  assert.equal(h.state?.currentNodeId, 'repair');

  out = await h.advance({ event: 'repair_completed', repairId: 55 });
  assert.equal(out.status, 'moved');
  assert.equal(h.state?.currentNodeId, 'test-grade'); // back on the bench

  out = await h.advance({ event: 'test_verdict', verdict: 'PASS' });
  assert.equal(out.status, 'moved');
  assert.equal(h.state?.currentNodeId, 'list');
});

test('TEST_AGAIN re-parks at the bench (no routing)', async () => {
  const h = harness('test-grade');

  const out = await h.advance({ event: 'test_verdict', verdict: 'TEST_AGAIN' });
  assert.equal(out.status, 'blocked');
  assert.equal(h.state?.currentNodeId, 'test-grade');
});

test('idempotency: replaying an event a node is not gated on parks, never advances', async () => {
  const h = harness('test-grade');

  // A re-scan replays unit_received against a unit already past receiving.
  let out = await h.advance({ event: 'unit_received' });
  assert.equal(out.status, 'blocked');
  assert.equal(h.state?.currentNodeId, 'test-grade'); // did not move

  // …and the real verdict still routes normally afterwards.
  out = await h.advance({ event: 'test_verdict', verdict: 'PASS' });
  assert.equal(out.status, 'moved');
  assert.equal(h.state?.currentNodeId, 'list');
});

test('every built-in declares the ports the seeded edges route on', () => {
  const expectations: Record<string, string[]> = {
    receiving: ['received'],
    inspection: ['pass', 'fail'],
    repair: ['repaired'],
    list_ebay: ['listed'],
    pack: ['packed'],
    ship: ['shipped'],
  };
  for (const [type, ports] of Object.entries(expectations)) {
    const def = getNode(type);
    assert.deepEqual(
      def.outputs.map((o) => o.id),
      ports,
      `${type} ports`,
    );
  }
});
