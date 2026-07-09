import test from 'node:test';
import assert from 'node:assert/strict';
import { pickVerdictMapping, VERDICT_TO_STATUS } from './recordTestVerdict';

/**
 * The per-org verdict→status override (Wave 2 / Class A) resolves through the pure
 * pickVerdictMapping: an override wins, an unset verdict falls back to the
 * hardcoded VERDICT_TO_STATUS. Flag-gated in recordTestVerdict (default off = no
 * settings read), so this pure unit test covers the resolution rule DB-free.
 */

test('pickVerdictMapping: no override → the hardcoded default', () => {
  assert.deepEqual(pickVerdictMapping('PASS'), VERDICT_TO_STATUS.PASS);
  assert.deepEqual(pickVerdictMapping('TESTING_FAILED', null), VERDICT_TO_STATUS.TESTING_FAILED);
  assert.deepEqual(pickVerdictMapping('TEST_AGAIN', {}), VERDICT_TO_STATUS.TEST_AGAIN);
});

test('pickVerdictMapping: a per-verdict override wins; unset verdicts still fall back', () => {
  const override = { PASS: { nextStatus: 'IN_TEST' as const, eventType: 'TEST_START' as const } };
  assert.deepEqual(pickVerdictMapping('PASS', override), { nextStatus: 'IN_TEST', eventType: 'TEST_START' });
  // An override for one verdict must not affect the others.
  assert.deepEqual(pickVerdictMapping('TESTING_FAILED', override), VERDICT_TO_STATUS.TESTING_FAILED);
  assert.deepEqual(pickVerdictMapping('TEST_AGAIN', override), VERDICT_TO_STATUS.TEST_AGAIN);
});
