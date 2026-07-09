import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeReceivingStepKey,
  deriveReceivingStepFlags,
  deriveReceivingStepStates,
} from './derive-receiving-step-states';

const base = {
  scanDriven: true,
  photoCount: 0,
  serialCount: 0,
  quantityExpected: 1,
  conditionSet: false,
  labelPrinted: false,
};

test('fresh line: scan done, photos active', () => {
  const states = deriveReceivingStepStates(base);
  assert.equal(states.scan, 'done');
  assert.equal(states.photos, 'active');
  assert.equal(states.condition, 'pending');
  assert.equal(states.print, 'pending');
});

test('conditionSet alone does not mark print done (no isComplete shortcut)', () => {
  const flags = deriveReceivingStepFlags({ ...base, conditionSet: true });
  assert.equal(flags.condition, true);
  assert.equal(flags.print, false);
});

test('later steps stay pending when photos incomplete even if serials exist', () => {
  const states = deriveReceivingStepStates({
    ...base,
    serialCount: 1,
    conditionSet: true,
    labelPrinted: true,
  });
  assert.equal(states.photos, 'active');
  assert.equal(states.condition, 'pending');
  assert.equal(states.serial, 'pending');
  assert.equal(states.print, 'pending');
});

test('all gates pass: every step done', () => {
  const states = deriveReceivingStepStates({
    ...base,
    photoCount: 2,
    serialCount: 1,
    conditionSet: true,
    labelPrinted: true,
  });
  for (const key of ['scan', 'photos', 'condition', 'serial', 'print'] as const) {
    assert.equal(states[key], 'done');
  }
  assert.equal(activeReceivingStepKey({
    ...base,
    photoCount: 2,
    serialCount: 1,
    conditionSet: true,
    labelPrinted: true,
  }), null);
});

test('rail-opened carton: scan step stays active first', () => {
  const states = deriveReceivingStepStates({ ...base, scanDriven: false });
  assert.equal(states.scan, 'active');
  assert.equal(states.photos, 'pending');
});
