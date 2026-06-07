import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WARRANTY_LIFECYCLE,
  REPAIR_ALLOWED_FROM,
  repairNextStatus,
  canTransition,
} from './transitions';
import { WARRANTY_CLAIM_STATUSES } from './types';

test('happy-path lifecycle is submit→approve→close', () => {
  assert.deepEqual(WARRANTY_LIFECYCLE.submit, { from: ['LOGGED'], to: 'SUBMITTED' });
  assert.deepEqual(WARRANTY_LIFECYCLE.approve, { from: ['SUBMITTED'], to: 'APPROVED' });
  assert.equal(WARRANTY_LIFECYCLE.close.to, 'CLOSED');
});

test('submit is only allowed from LOGGED', () => {
  assert.equal(canTransition('submit', 'LOGGED'), true);
  for (const s of WARRANTY_CLAIM_STATUSES) {
    if (s !== 'LOGGED') assert.equal(canTransition('submit', s), false, `${s} should not submit`);
  }
});

test('approve and deny both require SUBMITTED', () => {
  assert.equal(canTransition('approve', 'SUBMITTED'), true);
  assert.equal(canTransition('deny', 'SUBMITTED'), true);
  assert.equal(canTransition('approve', 'LOGGED'), false);
  assert.equal(canTransition('deny', 'APPROVED'), false);
});

test('close is allowed from the terminal-ish states only', () => {
  for (const s of ['APPROVED', 'DENIED', 'REPAIRED', 'EXPIRED'] as const) {
    assert.equal(canTransition('close', s), true, `${s} should close`);
  }
  for (const s of ['LOGGED', 'SUBMITTED', 'IN_REPAIR', 'CLOSED'] as const) {
    assert.equal(canTransition('close', s), false, `${s} should not close`);
  }
});

test('repairs only from APPROVED or IN_REPAIR', () => {
  assert.deepEqual(REPAIR_ALLOWED_FROM, ['APPROVED', 'IN_REPAIR']);
});

test('repair outcome FIXED → REPAIRED, otherwise IN_REPAIR', () => {
  assert.equal(repairNextStatus('FIXED'), 'REPAIRED');
  assert.equal(repairNextStatus('PENDING_PARTS'), 'IN_REPAIR');
  assert.equal(repairNextStatus('NOT_FIXABLE'), 'IN_REPAIR');
  assert.equal(repairNextStatus(null), 'IN_REPAIR');
  assert.equal(repairNextStatus(undefined), 'IN_REPAIR');
});

test('every lifecycle target is a known status (no typos)', () => {
  for (const v of Object.values(WARRANTY_LIFECYCLE)) {
    assert.ok((WARRANTY_CLAIM_STATUSES as readonly string[]).includes(v.to), `${v.to} is a valid status`);
    for (const f of v.from) {
      assert.ok((WARRANTY_CLAIM_STATUSES as readonly string[]).includes(f), `${f} is a valid status`);
    }
  }
});
