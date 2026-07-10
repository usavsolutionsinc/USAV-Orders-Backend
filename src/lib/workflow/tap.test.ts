/**
 * tapWorkflow drop-path observability + intended-tap outbox — DB-free unit
 * tests via the injected TapDeps (house Deps pattern, backend-patterns.md).
 *
 * Every silent drop path must emit a `workflow_tap_dropped` ops event with the
 * right reason, the outbox intent must bracket advance() (PENDING before,
 * LANDED/FAILED after), and nothing here may ever throw out of tapWorkflow.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
// Load BEFORE './tap': @/lib/db side-loads dotenv, populating DATABASE_URL so
// tap.ts's transitive @/lib/drizzle/db module-init (neon()) doesn't throw on a
// bare shell. Same implicit ordering applyTransition.test.ts gets via its
// state-machine import. No query is ever issued — the tests are DB-free.
import '@/lib/db';
import { tapWorkflow, type TapDeps, type WorkflowTapArgs } from './tap';
import type { AdvanceOutcome } from './advance';
import type { RecordOpsEventInput } from '@/lib/ops-events';

const ORG = 'org-1';
const UNIT = 42;

interface FakeState {
  organizationId: string;
  status: string;
  currentNodeType: string | null;
}

interface FakeOpts {
  /** undefined = not enrolled (loadTapState miss). */
  state?: FakeState;
  entryNode?: { workflowDefinitionId: number; nodeId: string } | null;
  returnsNode?: { workflowDefinitionId: number; nodeId: string } | null;
  outcome?: AdvanceOutcome;
  advanceThrows?: Error;
  emitThrows?: boolean;
  outboxEnabled?: boolean;
  outboxThrows?: boolean;
}

function fakes(opts: FakeOpts = {}) {
  const emitted: RecordOpsEventInput[] = [];
  const enrolls: unknown[] = [];
  const advances: Array<{ orgId: string; input?: Record<string, unknown> }> = [];
  const intents: Array<{ organizationId: string; serialUnitId: number; eventType: string; payload: Record<string, unknown> }> = [];
  const landed: number[] = [];
  const failed: Array<{ id: number; reason: string }> = [];
  const calls: string[] = []; // ordering probe
  let nextIntentId = 101;

  const deps: TapDeps = {
    loadTapState: async () => opts.state,
    findEntryNode: async () => opts.entryNode ?? null,
    findNodeOfType: async () => opts.returnsNode ?? null,
    enroll: async (a) => {
      enrolls.push(a);
    },
    advance: async (orgId, a) => {
      calls.push('advance');
      advances.push({ orgId, input: a.input });
      if (opts.advanceThrows) throw opts.advanceThrows;
      return (
        opts.outcome ?? { status: 'moved', from: 'n1', to: 'n2', output: 'ok', nodeType: 'inspection' }
      );
    },
    emitOps: async (input) => {
      if (opts.emitThrows) throw new Error('ops_events down');
      emitted.push(input);
    },
    outboxEnabled: () => opts.outboxEnabled ?? false,
    outbox: {
      recordIntent: async (i) => {
        if (opts.outboxThrows) throw new Error('outbox table missing');
        calls.push('recordIntent');
        intents.push(i);
        return nextIntentId++;
      },
      markLanded: async (id) => {
        calls.push('markLanded');
        landed.push(id);
      },
      markFailed: async (id, reason) => {
        calls.push('markFailed');
        failed.push({ id, reason });
      },
    },
  };

  return { deps, emitted, enrolls, advances, intents, landed, failed, calls };
}

function args(overrides: Partial<WorkflowTapArgs> = {}): WorkflowTapArgs {
  return { serialUnitId: UNIT, event: 'test_verdict', orgId: ORG, ...overrides };
}

function dropPayload(e: RecordOpsEventInput): Record<string, unknown> {
  return e.payload as Record<string, unknown>;
}

function assertDrop(
  emitted: RecordOpsEventInput[],
  reason: string,
): Record<string, unknown> {
  assert.equal(emitted.length, 1, 'exactly one drop event');
  const e = emitted[0];
  assert.equal(e.eventType, 'workflow_tap_dropped');
  assert.equal(e.entityType, 'serial_unit');
  assert.equal(e.entityId, UNIT);
  assert.equal(e.organizationId, ORG);
  const payload = dropPayload(e);
  assert.equal(payload.reason, reason);
  return payload;
}

// ── Drop paths ──────────────────────────────────────────────────────────────

test('unenrolled unit + non-receiving event → drops with reason=unenrolled, no advance', async () => {
  const f = fakes(); // no state
  await tapWorkflow(args({ event: 'test_verdict' }), f.deps);
  const payload = assertDrop(f.emitted, 'unenrolled');
  assert.equal(payload.event, 'test_verdict');
  assert.equal(f.advances.length, 0);
  assert.equal(f.enrolls.length, 0);
});

test('unenrolled unit_received with NO org → dropped silently (no org to scope the event to)', async () => {
  const f = fakes();
  await tapWorkflow(args({ event: 'unit_received', orgId: null }), f.deps);
  assert.equal(f.emitted.length, 0);
  assert.equal(f.advances.length, 0);
});

test('unit_received with org but no active workflow → reason=no_active_workflow', async () => {
  const f = fakes({ entryNode: null });
  await tapWorkflow(args({ event: 'unit_received' }), f.deps);
  assertDrop(f.emitted, 'no_active_workflow');
  assert.equal(f.enrolls.length, 0);
  assert.equal(f.advances.length, 0);
});

test('done unit + non-return event → reason=already_done', async () => {
  const f = fakes({ state: { organizationId: ORG, status: 'done', currentNodeType: 'ship' } });
  await tapWorkflow(args({ event: 'packed' }), f.deps);
  const payload = assertDrop(f.emitted, 'already_done');
  assert.equal(payload.currentNodeType, 'ship');
  assert.equal(f.advances.length, 0);
});

test('done unit + return_received but no returns node → reason=no_returns_node', async () => {
  const f = fakes({
    state: { organizationId: ORG, status: 'done', currentNodeType: 'ship' },
    returnsNode: null,
  });
  await tapWorkflow(args({ event: 'return_received' }), f.deps);
  assertDrop(f.emitted, 'no_returns_node');
  assert.equal(f.advances.length, 0);
});

test('position guard mismatch → reason=node_type_mismatch with expected/current', async () => {
  const f = fakes({ state: { organizationId: ORG, status: 'active', currentNodeType: 'inspection' } });
  await tapWorkflow(args({ event: 'listed', expectNodeType: 'list_ebay' }), f.deps);
  const payload = assertDrop(f.emitted, 'node_type_mismatch');
  assert.equal(payload.expectedNodeType, 'list_ebay');
  assert.equal(payload.currentNodeType, 'inspection');
  assert.equal(f.advances.length, 0);
});

test('advance noop → reason=advance_noop with the outcome attached', async () => {
  const f = fakes({
    state: { organizationId: ORG, status: 'active', currentNodeType: 'inspection' },
    outcome: { status: 'noop', reason: 'broken_graph' },
  });
  await tapWorkflow(args(), f.deps);
  const payload = assertDrop(f.emitted, 'advance_noop');
  assert.deepEqual(payload.outcome, { status: 'noop', reason: 'broken_graph' });
  assert.equal(f.advances.length, 1);
});

test('advance error outcome → reason=advance_error', async () => {
  const f = fakes({
    state: { organizationId: ORG, status: 'active', currentNodeType: 'inspection' },
    outcome: { status: 'error', output: 'error', nodeType: 'inspection', error: 'boom' },
  });
  await tapWorkflow(args(), f.deps);
  const payload = assertDrop(f.emitted, 'advance_error');
  assert.deepEqual(payload.outcome, {
    status: 'error',
    output: 'error',
    nodeType: 'inspection',
    error: 'boom',
  });
});

test('advance throws → reason=tap_exception, tapWorkflow never throws', async () => {
  const f = fakes({
    state: { organizationId: ORG, status: 'active', currentNodeType: 'inspection' },
    advanceThrows: new Error('db down'),
  });
  await tapWorkflow(args(), f.deps); // must not throw
  const payload = assertDrop(f.emitted, 'tap_exception');
  assert.equal(payload.error, 'db down');
});

test('successful advance (moved) emits no drop event', async () => {
  const f = fakes({ state: { organizationId: ORG, status: 'active', currentNodeType: 'inspection' } });
  await tapWorkflow(args(), f.deps);
  assert.equal(f.emitted.length, 0);
  assert.equal(f.advances.length, 1);
  assert.equal(f.advances[0].orgId, ORG);
});

test('blocked outcome is a normal await-park — no drop event', async () => {
  const f = fakes({
    state: { organizationId: ORG, status: 'active', currentNodeType: 'inspection' },
    outcome: { status: 'blocked', output: 'await', nodeType: 'inspection' },
  });
  await tapWorkflow(args(), f.deps);
  assert.equal(f.emitted.length, 0);
});

test('emitOps failing never propagates out of tapWorkflow', async () => {
  const f = fakes({ emitThrows: true }); // unenrolled → drop path → emit throws
  await tapWorkflow(args({ event: 'test_verdict' }), f.deps); // must not throw
  assert.equal(f.advances.length, 0);
});

// ── Enrollment fall-throughs still advance ──────────────────────────────────

test('unit_received with an active workflow enrolls then advances', async () => {
  const f = fakes({ entryNode: { workflowDefinitionId: 7, nodeId: 'entry' } });
  await tapWorkflow(args({ event: 'unit_received' }), f.deps);
  assert.equal(f.enrolls.length, 1);
  assert.equal(f.advances.length, 1);
  assert.equal(f.emitted.length, 0);
});

test('return_received on a done unit re-enrolls at the returns node then advances', async () => {
  const f = fakes({
    state: { organizationId: ORG, status: 'done', currentNodeType: 'ship' },
    returnsNode: { workflowDefinitionId: 7, nodeId: 'returns-1' },
  });
  await tapWorkflow(args({ event: 'return_received' }), f.deps);
  assert.equal(f.enrolls.length, 1);
  assert.equal(f.advances.length, 1);
  assert.equal(f.emitted.length, 0);
});

// ── Intended-tap outbox ─────────────────────────────────────────────────────

test('outbox OFF (default) → no intent writes at all', async () => {
  const f = fakes({ state: { organizationId: ORG, status: 'active', currentNodeType: 'inspection' } });
  await tapWorkflow(args(), f.deps);
  assert.equal(f.intents.length, 0);
  assert.equal(f.landed.length, 0);
  assert.equal(f.failed.length, 0);
});

test('outbox ON: intent recorded BEFORE advance, marked LANDED on moved', async () => {
  const f = fakes({
    state: { organizationId: ORG, status: 'active', currentNodeType: 'inspection' },
    outboxEnabled: true,
  });
  await tapWorkflow(args({ input: { verdict: 'pass' }, staffId: 9 }), f.deps);
  assert.deepEqual(f.calls, ['recordIntent', 'advance', 'markLanded']);
  assert.equal(f.intents.length, 1);
  assert.equal(f.intents[0].organizationId, ORG);
  assert.equal(f.intents[0].serialUnitId, UNIT);
  assert.equal(f.intents[0].eventType, 'test_verdict');
  assert.deepEqual(f.intents[0].payload.input, { verdict: 'pass' });
  assert.equal(f.intents[0].payload.staffId, 9);
  assert.deepEqual(f.landed, [101]);
});

test('outbox ON: blocked outcome also lands (normal await-park, not a loss)', async () => {
  const f = fakes({
    state: { organizationId: ORG, status: 'active', currentNodeType: 'inspection' },
    outcome: { status: 'blocked', output: 'await', nodeType: 'inspection' },
    outboxEnabled: true,
  });
  await tapWorkflow(args(), f.deps);
  assert.deepEqual(f.landed, [101]);
  assert.equal(f.failed.length, 0);
});

test('outbox ON: noop(locked) leaves the intent PENDING for the reconciler', async () => {
  const f = fakes({
    state: { organizationId: ORG, status: 'active', currentNodeType: 'inspection' },
    outcome: { status: 'noop', reason: 'locked' },
    outboxEnabled: true,
  });
  await tapWorkflow(args(), f.deps);
  assert.equal(f.intents.length, 1);
  assert.equal(f.landed.length, 0);
  assert.equal(f.failed.length, 0); // stays PENDING
});

test('outbox ON: durable noop marks the intent FAILED with the reason', async () => {
  const f = fakes({
    state: { organizationId: ORG, status: 'active', currentNodeType: 'inspection' },
    outcome: { status: 'noop', reason: 'broken_graph' },
    outboxEnabled: true,
  });
  await tapWorkflow(args(), f.deps);
  assert.deepEqual(f.failed, [{ id: 101, reason: 'noop:broken_graph' }]);
});

test('outbox ON: advance error outcome marks the intent FAILED', async () => {
  const f = fakes({
    state: { organizationId: ORG, status: 'active', currentNodeType: 'inspection' },
    outcome: { status: 'error', output: 'error', nodeType: 'inspection', error: 'boom' },
    outboxEnabled: true,
  });
  await tapWorkflow(args(), f.deps);
  assert.deepEqual(f.failed, [{ id: 101, reason: 'error:boom' }]);
});

test('outbox ON: advance throwing leaves the intent PENDING (the reconciler case)', async () => {
  const f = fakes({
    state: { organizationId: ORG, status: 'active', currentNodeType: 'inspection' },
    advanceThrows: new Error('crash mid-advance'),
    outboxEnabled: true,
  });
  await tapWorkflow(args(), f.deps);
  assert.equal(f.intents.length, 1);
  assert.equal(f.landed.length, 0);
  assert.equal(f.failed.length, 0); // PENDING → re-driven by tap-reconcile
});

test('outbox ON: intent write failing is non-fatal and the tap still advances', async () => {
  const f = fakes({
    state: { organizationId: ORG, status: 'active', currentNodeType: 'inspection' },
    outboxEnabled: true,
    outboxThrows: true,
  });
  await tapWorkflow(args(), f.deps); // must not throw
  assert.equal(f.advances.length, 1);
  assert.equal(f.landed.length, 0);
});
