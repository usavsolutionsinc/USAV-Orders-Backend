/**
 * DB-free tests for the assistant context registry. Run: npm run test:assistant
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAssistantContext,
  registerAssistantContext,
  subscribeAssistantContext,
} from './context-store';

test('last-registered wins; unregister restores the previous entry', () => {
  assert.equal(getAssistantContext(), null);

  const offA = registerAssistantContext({ page: 'operations', mode: 'analytics' });
  assert.equal(getAssistantContext()?.page, 'operations');

  const offB = registerAssistantContext({ page: 'studio', skill: 'graph vocab' });
  assert.equal(getAssistantContext()?.page, 'studio');

  offB();
  assert.equal(getAssistantContext()?.page, 'operations');
  offA();
  assert.equal(getAssistantContext(), null);
});

test('out-of-order unregister removes the right entry (no stack corruption)', () => {
  const offA = registerAssistantContext({ page: 'a' });
  const offB = registerAssistantContext({ page: 'b' });
  offA(); // remove the OLDER entry first
  assert.equal(getAssistantContext()?.page, 'b');
  offB();
  assert.equal(getAssistantContext(), null);
  offB(); // double-unregister is a no-op
  assert.equal(getAssistantContext(), null);
});

test('subscribers fire on register/unregister; snapshot is referentially stable', () => {
  let fired = 0;
  const unsub = subscribeAssistantContext(() => {
    fired += 1;
  });
  const off = registerAssistantContext({ page: 'x' });
  const snap1 = getAssistantContext();
  const snap2 = getAssistantContext();
  assert.equal(snap1, snap2); // same reference between emissions
  off();
  unsub();
  assert.equal(fired, 2);
});
