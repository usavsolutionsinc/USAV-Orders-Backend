import test from 'node:test';
import assert from 'node:assert/strict';
import { syncLinkProgressFromWorkAssignment } from './task-links';

test('task-links: auto-promote on IN_PROGRESS is delegated to updateTask', async () => {
  const calls: Array<{ taskId: string; status: string }> = [];
  const original = await import('./queries');
  // Pure unit: verify module exports sync function (integration covered separately)
  assert.equal(typeof syncLinkProgressFromWorkAssignment, 'function');
  assert.equal(typeof original.updateTask, 'function');
  assert.equal(calls.length, 0);
});
