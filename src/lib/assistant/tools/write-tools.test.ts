/**
 * DB-free tests for the assistant write tools (propose_mutation / revert).
 * Run: npm run test:assistant
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWriteTools, type AssistantWriteDeps } from './write-tools';
import type { AssistantToolCtx } from './types';

const ORG = '11111111-2222-3333-4444-555555555555';
const CTX: AssistantToolCtx = { organizationId: ORG, staffId: 9, permissions: new Set(['studio.manage']) };

function fakes(
  apply: (input: unknown) => ReturnType<AssistantWriteDeps['apply']>,
  revert: () => ReturnType<AssistantWriteDeps['revert']> = async () => ({ ok: true, status: 200 }),
) {
  const cap: { applied: unknown[] } = { applied: [] };
  const deps: AssistantWriteDeps = {
    apply: (async (input) => {
      cap.applied.push(input);
      return apply(input);
    }) as AssistantWriteDeps['apply'],
    revert: (async () => revert()) as AssistantWriteDeps['revert'],
  };
  return { deps, cap };
}

test('both tools gate on studio.manage; a viewer never sees them', () => {
  const tools = buildWriteTools('asst-1');
  assert.deepEqual(tools.map((t) => t.name).sort(), ['propose_mutation', 'revert_mutation']);
  for (const t of tools) assert.equal(t.permission, 'studio.manage');
});

test('propose_mutation: applied view-layer change threads org/staff/session from ctx, reports "applied"', async () => {
  const { deps, cap } = fakes(async () => ({ ok: true, status: 'applied', mutationId: 42, trust: 'auto', targetRef: '7' }));
  const [propose] = buildWriteTools('asst-77', deps);
  const out = (await propose.run(
    { mutationKind: 'feed_membership.set_state', payload: { feedKey: 'receiving_triage', entityType: 'RECEIVING', entityId: 7, state: 'done' } },
    CTX,
    {} as never,
  )) as { ok: boolean; status: string; mutationId: number; explanation: string };

  assert.equal(out.ok, true);
  assert.equal(out.status, 'applied');
  assert.equal(out.mutationId, 42);
  assert.match(out.explanation, /Applied now/);
  const applied = cap.applied[0] as { organizationId: string; proposedByStaffId: number; aiChatSessionId: string };
  assert.equal(applied.organizationId, ORG);
  assert.equal(applied.proposedByStaffId, 9); // from ctx, not the payload
  assert.equal(applied.aiChatSessionId, 'asst-77');
});

test('propose_mutation: draft edit explanation tells the user it hit their draft', async () => {
  const { deps } = fakes(async () => ({ ok: true, status: 'applied', mutationId: 1, trust: 'draft_scoped', targetRef: 'n-x' }));
  const [propose] = buildWriteTools('s', deps);
  const out = (await propose.run(
    { mutationKind: 'workflow_draft.add_node', payload: { definitionId: 12, type: 'inspection' } },
    CTX,
    {} as never,
  )) as { explanation: string };
  assert.match(out.explanation, /draft/i);
  assert.match(out.explanation, /revert/i);
});

test('propose_mutation: review-gated change is reported as queued, not applied', async () => {
  const { deps } = fakes(async () => ({ ok: true, status: 'proposed', mutationId: 5, trust: 'review', targetRef: null }));
  const [propose] = buildWriteTools('s', deps);
  const out = (await propose.run(
    { mutationKind: 'staff.create', payload: { name: 'X' } },
    CTX,
    {} as never,
  )) as { status: string; explanation: string };
  assert.equal(out.status, 'proposed');
  assert.match(out.explanation, /review/i);
});

test('propose_mutation: a rejected mutation surfaces the error, not a throw', async () => {
  const { deps } = fakes(async () => ({ ok: false, status: 409, error: 'the active version is read-only' }));
  const [propose] = buildWriteTools('s', deps);
  const out = (await propose.run(
    { mutationKind: 'workflow_draft.add_node', payload: { definitionId: 12, type: 'inspection' } },
    CTX,
    {} as never,
  )) as { ok: boolean; error: string };
  assert.equal(out.ok, false);
  assert.match(out.error, /read-only/);
});

test('revert_mutation: passes the id + ctx org/staff to the revert chokepoint', async () => {
  const revertCalls: number[] = [];
  const deps: AssistantWriteDeps = {
    apply: (async () => ({ ok: true, status: 'applied', mutationId: 1, trust: 'auto', targetRef: null })) as AssistantWriteDeps['apply'],
    revert: (async (id: number) => {
      revertCalls.push(id);
      return { ok: true, status: 200 };
    }) as AssistantWriteDeps['revert'],
  };
  const [, revert] = buildWriteTools('s', deps);
  const out = (await revert.run({ mutationId: 55 }, CTX, {} as never)) as { ok: boolean; reverted: boolean };
  assert.equal(out.ok, true);
  assert.equal(out.reverted, true);
  assert.deepEqual(revertCalls, [55]);
});
