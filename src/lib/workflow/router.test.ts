import test from 'node:test';
import assert from 'node:assert/strict';
import { selectNextTarget, type WorkflowEdgeLike } from './router';

const edges: WorkflowEdgeLike[] = [
  { sourceNode: 'inspect', sourcePort: 'pass', targetNode: 'ship' },
  { sourceNode: 'inspect', sourcePort: 'fail', targetNode: 'repair' },
  { sourceNode: 'repair', sourcePort: 'done', targetNode: 'inspect' },
];

test('selectNextTarget routes a matching (node, port) to its target', () => {
  assert.equal(selectNextTarget(edges, 'inspect', 'pass'), 'ship');
  assert.equal(selectNextTarget(edges, 'inspect', 'fail'), 'repair');
  assert.equal(selectNextTarget(edges, 'repair', 'done'), 'inspect'); // rework loop
});

test('selectNextTarget returns null when no edge matches (terminal)', () => {
  assert.equal(selectNextTarget(edges, 'ship', 'shipped'), null);
  assert.equal(selectNextTarget(edges, 'inspect', 'nonexistent-port'), null);
  assert.equal(selectNextTarget([], 'inspect', 'pass'), null);
});

test('selectNextTarget is deterministic: first matching edge wins', () => {
  const dup: WorkflowEdgeLike[] = [
    { sourceNode: 'a', sourcePort: 'out', targetNode: 'first' },
    { sourceNode: 'a', sourcePort: 'out', targetNode: 'second' },
  ];
  assert.equal(selectNextTarget(dup, 'a', 'out'), 'first');
});
