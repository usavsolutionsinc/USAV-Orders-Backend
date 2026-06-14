/**
 * Static flow-map projection — unit tests over synthetic graphs.
 * Run: npx tsx --test src/lib/studio/static-flow-graph.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStaticFlowGraph } from './static-flow-graph';

type Node = Parameters<typeof buildStaticFlowGraph>[0][number];
type Edge = Parameters<typeof buildStaticFlowGraph>[1][number];

const node = (id: string, category?: string, outputs: Array<{ id: string; label: string }> = []): Node => ({
  id,
  meta: category || outputs.length ? { category, outputs } : null,
});
const edge = (source: string, sourcePort: string, target: string): Edge => ({ source, sourcePort, target });

test('intake category is a source even with inbound edges', () => {
  const g = buildStaticFlowGraph(
    [node('a', 'process', [{ id: 'done', label: 'Done' }]), node('b', 'intake', [{ id: 'in', label: 'In' }])],
    [edge('a', 'done', 'b')], // b has an inbound edge, but category wins
  );
  assert.equal(g.byId.get('b')?.role, 'source');
});

test('fulfill category is a sink even with outbound edges', () => {
  const g = buildStaticFlowGraph(
    [node('a', 'fulfill', [{ id: 'shipped', label: 'Shipped' }]), node('b', 'process')],
    [edge('a', 'shipped', 'b')], // a has an outbound edge, but category wins
  );
  assert.equal(g.byId.get('a')?.role, 'sink');
});

test('topology classifies untyped/process nodes: source → transform → sink', () => {
  // a(in0,out1) → b(in1,out1) → c(in1,out0)
  const g = buildStaticFlowGraph(
    [
      node('a', 'process', [{ id: 'out', label: 'Out' }]),
      node('b', 'process', [{ id: 'out', label: 'Out' }]),
      node('c', 'process'),
    ],
    [edge('a', 'out', 'b'), edge('b', 'out', 'c')],
  );
  assert.equal(g.byId.get('a')?.role, 'source');
  assert.equal(g.byId.get('b')?.role, 'transform');
  assert.equal(g.byId.get('c')?.role, 'sink');
  assert.deepEqual(g.counts, { sources: 1, transforms: 1, sinks: 1 });
});

test('orphan node (no edges) is a source, and is both entry and terminal', () => {
  const g = buildStaticFlowGraph([node('solo', 'process')], []);
  const solo = g.byId.get('solo')!;
  assert.equal(solo.role, 'source');
  assert.equal(solo.isEntry, true);
  assert.equal(solo.isTerminal, true);
});

test('dangling output ports are detected (data that goes nowhere)', () => {
  // inspection has pass + fail; only pass is wired
  const g = buildStaticFlowGraph(
    [
      node('start', 'intake', [{ id: 'in', label: 'In' }]),
      node('inspection', 'process', [
        { id: 'pass', label: 'Pass' },
        { id: 'fail', label: 'Fail' },
      ]),
      node('done', 'fulfill'),
    ],
    [edge('start', 'in', 'inspection'), edge('inspection', 'pass', 'done')],
  );
  const insp = g.byId.get('inspection')!;
  assert.deepEqual(insp.danglingPorts, ['fail']);
  assert.equal(insp.ports.find((p) => p.id === 'pass')?.wired, true);
  assert.equal(insp.ports.find((p) => p.id === 'fail')?.wired, false);
  assert.equal(insp.role, 'transform');
});

test('a node with no declared ports has no dangling ports', () => {
  const g = buildStaticFlowGraph([node('a', 'intake'), node('b')], [edge('a', 'whatever', 'b')]);
  assert.deepEqual(g.byId.get('a')?.danglingPorts, []);
  assert.deepEqual(g.byId.get('b')?.danglingPorts, []);
});

test('counts and bucket membership are consistent', () => {
  const g = buildStaticFlowGraph(
    [node('s1', 'intake'), node('t1', 'process', [{ id: 'o', label: 'O' }]), node('k1', 'fulfill')],
    [edge('s1', 'x', 't1'), edge('t1', 'o', 'k1')],
  );
  assert.deepEqual(g.sources, ['s1']);
  assert.deepEqual(g.transforms, ['t1']);
  assert.deepEqual(g.sinks, ['k1']);
  assert.equal(g.counts.sources + g.counts.transforms + g.counts.sinks, 3);
});
