/**
 * Studio Simulate — unit tests over the pure ghost-run router.
 * Run: node --import tsx --test src/lib/studio/simulate.test.ts
 *
 * The simulation MUST match the engine's edge router (router.ts
 * selectNextTarget, first-match-wins), so these mirror router.test.ts plus the
 * seed graph's happy path and the test→fail→repair rework loop.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { findEntryNode, outputPortsOf, stepSimulation, type SimEdge, type SimNode } from './simulate';

// ─── The reseller seed graph: receive → test → list → pack → ship,
//     with the test→fail→repair→(re)test rework loop. ──────────────────────────
const node = (id: string, outputs: Array<{ id: string; label: string }> = []): SimNode => ({
  id,
  meta: outputs.length ? { outputs } : null,
});

const seedNodes: SimNode[] = [
  node('receive', [{ id: 'received', label: 'Received' }]),
  node('test', [
    { id: 'pass', label: 'Pass' },
    { id: 'fail', label: 'Fail' },
  ]),
  node('list', [{ id: 'listed', label: 'Listed' }]),
  node('pack', [{ id: 'packed', label: 'Packed' }]),
  node('ship', [{ id: 'shipped', label: 'Shipped' }]),
  node('repair', [{ id: 'repaired', label: 'Repaired' }]),
];

const seedEdges: SimEdge[] = [
  { id: 'e1', source: 'receive', sourcePort: 'received', target: 'test' },
  { id: 'e2', source: 'test', sourcePort: 'pass', target: 'list' },
  { id: 'e3', source: 'test', sourcePort: 'fail', target: 'repair' },
  { id: 'e4', source: 'repair', sourcePort: 'repaired', target: 'test' }, // rework loop
  { id: 'e5', source: 'list', sourcePort: 'listed', target: 'pack' },
  { id: 'e6', source: 'pack', sourcePort: 'packed', target: 'ship' },
];

test('findEntryNode returns the no-inbound-edge (intake) node', () => {
  assert.equal(findEntryNode(seedNodes, seedEdges), 'receive');
});

test('findEntryNode is null for an empty graph', () => {
  assert.equal(findEntryNode([], []), null);
});

test('findEntryNode is null when every node has an inbound edge (fully cyclic)', () => {
  const cyc: SimNode[] = [node('a', [{ id: 'o', label: 'O' }]), node('b', [{ id: 'o', label: 'O' }])];
  const cycE: SimEdge[] = [
    { id: 'x', source: 'a', sourcePort: 'o', target: 'b' },
    { id: 'y', source: 'b', sourcePort: 'o', target: 'a' },
  ];
  assert.equal(findEntryNode(cyc, cycE), null);
});

test('happy path: receive → test → list → pack → ship → terminal', () => {
  const s1 = stepSimulation(seedNodes, seedEdges, 'receive', 'received');
  assert.deepEqual(s1, { nextNodeId: 'test', edgeId: 'e1' });

  const s2 = stepSimulation(seedNodes, seedEdges, 'test', 'pass');
  assert.deepEqual(s2, { nextNodeId: 'list', edgeId: 'e2' });

  const s3 = stepSimulation(seedNodes, seedEdges, 'list', 'listed');
  assert.deepEqual(s3, { nextNodeId: 'pack', edgeId: 'e5' });

  const s4 = stepSimulation(seedNodes, seedEdges, 'pack', 'packed');
  assert.deepEqual(s4, { nextNodeId: 'ship', edgeId: 'e6' });

  // ship has a 'shipped' port but no outbound edge → terminal.
  const s5 = stepSimulation(seedNodes, seedEdges, 'ship', 'shipped');
  assert.deepEqual(s5, { nextNodeId: null, edgeId: null });
});

test('rework loop: test → fail → repair → repaired → back to test', () => {
  const fail = stepSimulation(seedNodes, seedEdges, 'test', 'fail');
  assert.deepEqual(fail, { nextNodeId: 'repair', edgeId: 'e3' });

  const repaired = stepSimulation(seedNodes, seedEdges, 'repair', 'repaired');
  assert.deepEqual(repaired, { nextNodeId: 'test', edgeId: 'e4' }); // loops back to the bench
});

test('terminal: an unwired/unknown port ends the run', () => {
  assert.deepEqual(stepSimulation(seedNodes, seedEdges, 'test', 'nonexistent-port'), {
    nextNodeId: null,
    edgeId: null,
  });
  assert.deepEqual(stepSimulation(seedNodes, [], 'receive', 'received'), {
    nextNodeId: null,
    edgeId: null,
  });
});

test('first-match wins when two edges share (node, port) — engine parity', () => {
  const dupNodes: SimNode[] = [node('a', [{ id: 'out', label: 'Out' }])];
  const dupEdges: SimEdge[] = [
    { id: 'first', source: 'a', sourcePort: 'out', target: 'b' },
    { id: 'second', source: 'a', sourcePort: 'out', target: 'c' },
  ];
  assert.deepEqual(stepSimulation(dupNodes, dupEdges, 'a', 'out'), {
    nextNodeId: 'b',
    edgeId: 'first',
  });
});

test('outputPortsOf reads a node’s declared ports (and is empty for portless nodes)', () => {
  assert.deepEqual(
    outputPortsOf(seedNodes.find((n) => n.id === 'test')).map((p) => p.id),
    ['pass', 'fail'],
  );
  assert.deepEqual(outputPortsOf(node('x')), []);
  assert.deepEqual(outputPortsOf(null), []);
});
