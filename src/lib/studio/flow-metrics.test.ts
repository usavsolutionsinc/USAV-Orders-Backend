/**
 * Unit tests for the Flow² metrics assembler (pure, no DB).
 *   node --import tsx --test src/lib/studio/flow-metrics.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleFlowMetrics, formatDuration } from './flow-metrics';

const NODES = [
  { id: 'n-list', type: 'list_ebay' },
  { id: 'n-pack', type: 'pack' },
  { id: 'n-test', type: 'test-grade' },
];
const EDGES = [
  { id: 'e-listed', source: 'n-list', sourcePort: 'listed', target: 'n-pack' },
  { id: 'e-pass', source: 'n-test', sourcePort: 'pass', target: 'n-list' },
  { id: 'e-fail', source: 'n-test', sourcePort: 'fail', target: 'n-test' },
];

test('assembles per-node dwell, ports, fail-rate, WIP, and edge volume', () => {
  const r = assembleFlowMetrics({
    nodes: NODES,
    edges: EDGES,
    dwellByType: [
      { nodeType: 'test-grade', medianS: 120, p90S: 600, samples: 10 },
      { nodeType: 'list_ebay', medianS: 30, p90S: 90, samples: 5 },
    ],
    portCounts: [
      { nodeType: 'test-grade', output: 'pass', n: 8 },
      { nodeType: 'test-grade', output: 'fail', n: 2 },
      { nodeType: 'list_ebay', output: 'listed', n: 5 },
    ],
    wipSnapshots: [
      { nodeId: 'n-test', date: '2026-06-21', queueDepth: 3, blocked: 1, error: 0 },
      { nodeId: 'n-test', date: '2026-06-22', queueDepth: 7, blocked: 2, error: 0 },
      { nodeId: 'n-list', date: '2026-06-22', queueDepth: 1, blocked: 0, error: 0 },
    ],
    windowDays: 30,
  });

  assert.equal(r.ok, true);
  // test-grade: dwell + fail-rate 2/10 + currentWip from latest snapshot (7)
  assert.equal(r.nodes['n-test'].dwellMedianS, 120);
  assert.equal(r.nodes['n-test'].dwellP90S, 600);
  assert.equal(r.nodes['n-test'].failRate, 0.2);
  assert.equal(r.nodes['n-test'].currentWip, 7);
  assert.equal(r.nodes['n-test'].wipTrend.length, 2);
  assert.equal(r.nodes['n-test'].ports.pass, 8);

  // pack has no runs/stats → nulls + zero, not crash
  assert.equal(r.nodes['n-pack'].dwellMedianS, null);
  assert.equal(r.nodes['n-pack'].failRate, null);
  assert.equal(r.nodes['n-pack'].currentWip, 0);

  // edge volume = source node's port firings
  assert.equal(r.edges['e-pass'].volume, 8);
  assert.equal(r.edges['e-fail'].volume, 2);
  assert.equal(r.edges['e-listed'].volume, 5);

  // bottleneck ranking: test-grade (wip 7) outranks list_ebay (wip 1); pack absent (no signal)
  assert.equal(r.bottlenecks[0].nodeId, 'n-test');
  assert.ok(r.bottlenecks[0].score > r.bottlenecks[1].score);
  assert.ok(!r.bottlenecks.some((b) => b.nodeId === 'n-pack'));
  assert.ok(r.bottlenecks[0].reason.includes('7 in queue'));
});

test('empty inputs produce empty, ok result (no crash)', () => {
  const r = assembleFlowMetrics({
    nodes: [],
    edges: [],
    dwellByType: [],
    portCounts: [],
    wipSnapshots: [],
    windowDays: 7,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.nodes, {});
  assert.deepEqual(r.bottlenecks, []);
  assert.equal(r.windowDays, 7);
});

test('dwell p90 breaks ties when WIP is equal', () => {
  const r = assembleFlowMetrics({
    nodes: [{ id: 'a', type: 'ta' }, { id: 'b', type: 'tb' }],
    edges: [],
    dwellByType: [
      { nodeType: 'ta', medianS: 10, p90S: 50, samples: 3 },
      { nodeType: 'tb', medianS: 10, p90S: 500, samples: 3 },
    ],
    portCounts: [],
    wipSnapshots: [
      { nodeId: 'a', date: '2026-06-22', queueDepth: 2, blocked: 0, error: 0 },
      { nodeId: 'b', date: '2026-06-22', queueDepth: 2, blocked: 0, error: 0 },
    ],
    windowDays: 30,
  });
  assert.equal(r.bottlenecks[0].nodeId, 'b'); // same WIP, higher dwell p90 wins
});

test('formatDuration renders compact units', () => {
  assert.equal(formatDuration(45), '45s');
  assert.equal(formatDuration(120), '2m');
  assert.equal(formatDuration(3600), '1h');
  assert.equal(formatDuration(3900), '1h 5m');
  assert.equal(formatDuration(-1), '—');
});
