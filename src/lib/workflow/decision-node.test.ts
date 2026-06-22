/**
 * decision.node — the registered NodeDefinition (Track 1, Stage 1). Proves the
 * thin adapter reads its config rule-table, emits the chosen port from item
 * facts (input or upstream context), and PARKS when nothing matches and there's
 * no default. The pure matcher is covered exhaustively in decision-eval.test.ts;
 * this checks the node wiring (config-read, facts-gather, park semantics).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { NodeContext } from './contract';
import { getNode } from './registry';

// Register the decision node (import side-effect, same as ./index.ts).
import './nodes/decision.node';

const ctx = (over: {
  config?: Record<string, unknown>;
  input?: Record<string, unknown>;
  context?: Record<string, unknown>;
}): NodeContext => ({
  orgId: 'test-org',
  serialUnitId: 1,
  actor: { staffId: 7, source: 'scan' },
  config: over.config ?? {},
  input: over.input ?? {},
  context: over.context ?? {},
  emit: async () => {},
});

const decision = getNode('decision');

test('decision is registered in the logic category with config-driven ports', () => {
  assert.equal(decision.category, 'logic');
  assert.ok(decision.configSchema, 'decision declares a configSchema (palette knows it is configurable)');
});

test('run() emits the port of the first matching rule (facts from input)', async () => {
  const config = {
    outputs: [
      { id: 'premium', label: 'Premium' },
      { id: 'standard', label: 'Standard' },
    ],
    rules: [
      { id: 'r1', when: { grade: 'A' }, thenPort: 'premium' },
      { id: 'r2', when: { grade: 'B' }, thenPort: 'standard' },
    ],
  };
  const res = await decision.run(ctx({ config, input: { event: 'graded', grade: 'A' } }));
  assert.equal(res.output, 'premium');
  assert.ok(!res.await);
});

test('run() reads facts from upstream context when not on the live input', async () => {
  const config = {
    outputs: [{ id: 'ebay', label: 'eBay' }],
    rules: [{ id: 'r1', when: { channel: 'ebay' }, thenPort: 'ebay' }],
  };
  const res = await decision.run(ctx({ config, context: { channel: 'ebay' } }));
  assert.equal(res.output, 'ebay');
});

test('run() falls back to defaultPort when no rule matches', async () => {
  const config = {
    outputs: [{ id: 'reject', label: 'Reject' }],
    rules: [{ id: 'r1', when: { grade: 'A' }, thenPort: 'premium' }],
    defaultPort: 'reject',
  };
  const res = await decision.run(ctx({ config, input: { grade: 'C' } }));
  assert.equal(res.output, 'reject');
});

test('run() PARKS (await) when nothing matches and there is no default', async () => {
  const config = {
    outputs: [{ id: 'premium', label: 'Premium' }],
    rules: [{ id: 'r1', when: { grade: 'A' }, thenPort: 'premium' }],
  };
  const res = await decision.run(ctx({ config, input: { grade: 'C' } }));
  assert.equal(res.await, true);
  assert.equal(res.output, 'awaiting');
});

test('run() parks on an empty/absent config rather than throwing (operator JSON is untrusted)', async () => {
  const res = await decision.run(ctx({ config: {} }));
  assert.equal(res.await, true);
});
