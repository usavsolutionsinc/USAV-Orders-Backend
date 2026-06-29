/**
 * DB-free unit tests for switchActiveContext() — session-collapse groundwork.
 *
 * Run: npx tsx --test src/lib/identity/sessions.test.ts
 *
 * The helper is currently UNUSED in the live auth path; these tests pin its
 * contract (re-point pointers in one tx; report whether a live session matched)
 * so the future cutover has a tested foundation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { switchActiveContext, type SwitchActiveContextDeps } from './sessions';

const SID = 'sess-abc';
const ORG = 'org-target';
const STAFF = 42;

function fakes(rowCount: number): {
  deps: SwitchActiveContextDeps;
  capture: { updatePointers: Array<[string, string, number]>; txOrg: string[] };
} {
  const capture = { updatePointers: [] as Array<[string, string, number]>, txOrg: [] as string[] };
  const deps: SwitchActiveContextDeps = {
    async updatePointers(sessionId, orgId, staffId) {
      capture.updatePointers.push([sessionId, orgId, staffId]);
      return rowCount;
    },
    async transaction(orgId, fn) {
      capture.txOrg.push(orgId);
      return fn(null as never);
    },
  };
  return { deps, capture };
}

test('switchActiveContext re-points the pointers in one tx and reports updated', async () => {
  const { deps, capture } = fakes(1);
  const result = await switchActiveContext(SID, { orgId: ORG, staffId: STAFF }, deps);

  assert.deepEqual(result, { updated: true });
  assert.deepEqual(capture.updatePointers, [[SID, ORG, STAFF]]);
  // The update ran inside the target-org transaction envelope.
  assert.deepEqual(capture.txOrg, [ORG]);
});

test('switchActiveContext reports not-updated when no live session matches', async () => {
  const { deps, capture } = fakes(0);
  const result = await switchActiveContext(SID, { orgId: ORG, staffId: STAFF }, deps);

  assert.deepEqual(result, { updated: false });
  assert.equal(capture.updatePointers.length, 1);
});
