/**
 * DB-free tests for assistant pre-loop enrichment.
 * Run: npx tsx --test src/lib/assistant/enrich-turn.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichAssistantTurn, type EnrichTurnDeps } from './enrich-turn';

const ORG = '11111111-2222-3333-4444-555555555555';

test('enrichAssistantTurn: local_ops short-circuits before enrich', async () => {
  let enrichCalled = 0;
  const deps: EnrichTurnDeps = {
    resolveLocal: async (msg, orgId) => {
      assert.equal(orgId, ORG);
      assert.match(msg, /shipped/i);
      return {
        mode: 'local_ops',
        reply: '42 shipped this week',
        analysis: {
          mode: 'local_ops',
          modeLabel: 'Local ops',
          title: 'Shipping',
          summary: '42',
          kind: 'shipping_summary',
        } as never,
      };
    },
    enrich: async () => {
      enrichCalled += 1;
      return 'should not run';
    },
    detect: () => [],
    extract: () => ({}),
  };
  const out = await enrichAssistantTurn(ORG, 'how many shipped this week', deps);
  assert.equal(out.kind, 'local_ops');
  if (out.kind === 'local_ops') {
    assert.equal(out.resolution.reply, '42 shipped this week');
  }
  assert.equal(enrichCalled, 0);
});

test('enrichAssistantTurn: threads org + intents into enrich when not local_ops', async () => {
  const cap: { orgId?: string; message?: string; intents?: string[] } = {};
  const deps: EnrichTurnDeps = {
    resolveLocal: async () => null,
    detect: () => ['orders', 'shipped'],
    extract: () => ({ orderId: '12345' }),
    enrich: async (args) => {
      cap.orgId = args.orgId;
      cap.message = args.message;
      cap.intents = args.intents;
      return `[Live data]\norders...\n\nUser question: ${args.message}`;
    },
  };
  const out = await enrichAssistantTurn(ORG, 'find order 12345', deps);
  assert.equal(out.kind, 'enriched');
  if (out.kind === 'enriched') {
    assert.equal(cap.orgId, ORG);
    assert.equal(cap.message, 'find order 12345');
    assert.deepEqual(cap.intents, ['orders', 'shipped']);
    assert.match(out.userMessage, /Live data/);
  }
});
