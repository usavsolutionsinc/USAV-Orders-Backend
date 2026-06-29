/**
 * putaway-placement — the receiving default-putaway policy. Proves the rule
 * targets the org-resolved bin symbol on disposition=ACCEPT, and that an empty
 * symbol yields an empty (degrade-to-legacy) policy. DB-free.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  receivingDefaultPutawayPolicy,
  RECEIVING_PUTAWAY_CATEGORY,
} from './putaway-placement';
import { resolveDecision } from '@/lib/workflow/decision-eval';

test('ACCEPT routes to the org default bin symbol with the default-putaway category', () => {
  const policy = receivingDefaultPutawayPolicy('UNSORTED');
  const outcome = resolveDecision(policy, null, { disposition: 'ACCEPT' });
  assert.equal(outcome.port, 'putaway');
  assert.deepEqual(outcome.placement, { placement: 'UNSORTED', category: RECEIVING_PUTAWAY_CATEGORY });
});

test('a non-ACCEPT disposition does not match — no placement (legacy/no-op)', () => {
  const policy = receivingDefaultPutawayPolicy('UNSORTED');
  assert.deepEqual(resolveDecision(policy, null, { disposition: 'RTV' }), { port: null, placement: null });
});

test('the org-configured barcode (settings/env) is the symbol the rule targets', () => {
  const policy = receivingDefaultPutawayPolicy('  RCV-STAGE-1 ');
  const outcome = resolveDecision(policy, null, { disposition: 'ACCEPT' });
  assert.equal(outcome.placement?.placement, 'RCV-STAGE-1'); // trimmed
});

test('an empty/whitespace symbol yields an empty policy (caller degrades to legacy)', () => {
  assert.deepEqual(receivingDefaultPutawayPolicy(''), []);
  assert.deepEqual(receivingDefaultPutawayPolicy('   '), []);
});
