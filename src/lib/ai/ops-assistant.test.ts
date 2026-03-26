import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLocalOpsQueryKind, pickLocalOpsDimension } from '@/lib/ai/ops-assistant';

test('detectLocalOpsQueryKind recognizes shipped summary prompts', () => {
  assert.equal(
    detectLocalOpsQueryKind('How many orders were shipped last week and by who?'),
    'summary'
  );
});

test('detectLocalOpsQueryKind recognizes missing attribution prompts', () => {
  assert.equal(
    detectLocalOpsQueryKind('Which shipped orders last week are missing a tester?'),
    'missing_attribution'
  );
});

test('pickLocalOpsDimension defaults shipped summaries to packer and switches for tester prompts', () => {
  assert.equal(
    pickLocalOpsDimension('How many orders were shipped last week and by who?'),
    'packer'
  );
  assert.equal(
    pickLocalOpsDimension('Show this week shipped orders by tester'),
    'tester'
  );
});
