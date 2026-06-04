import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceItem, type AdvanceDeps } from './advance';
import { selectNextTarget, type WorkflowEdgeLike } from './router';
import { ERROR_OUTPUT } from './runtime';
import type {
  AdvanceLock,
  ItemState,
  NodeDefinition,
  NodeResult,
  RunRecord,
  WorkflowEvent,
  WorkflowStore,
} from './contract';

const ORG = 'test-org';
const ACTOR = { staffId: 7, source: 'scan' as const };
const DEF_ID = 1;

/** Build a node definition whose run() returns a fixed result (or throws). */
function node(type: string, run: NodeDefinition['run']): NodeDefinition {
  return { type, label: type, icon: 'Box', category: 'process', outputs: [], run };
}

const returns = (result: NodeResult): NodeDefinition['run'] => async () => result;
const throws = (msg: string): NodeDefinition['run'] => async () => {
  throw new Error(msg);
};

interface HarnessOpts {
  nodes: Record<string, { type: string; config?: Record<string, unknown> }>;
  edges: WorkflowEdgeLike[];
  defs: NodeDefinition[];
  start: string;
  initialStatus?: ItemState['status'];
  state?: ItemState | null; // override (e.g. null = not enrolled)
  lock?: AdvanceLock;
}

function harness(opts: HarnessOpts) {
  let state: ItemState | null =
    opts.state === undefined
      ? {
          serialUnitId: 1,
          workflowDefinitionId: DEF_ID,
          currentNodeId: opts.start,
          status: opts.initialStatus ?? 'active',
          context: {},
        }
      : opts.state;

  const runs: RunRecord[] = [];
  const events: WorkflowEvent[] = [];
  const defMap = new Map(opts.defs.map((d) => [d.type, d]));

  const store: WorkflowStore = {
    async loadState() {
      return state;
    },
    async loadNode(_defId, nodeId) {
      const n = opts.nodes[nodeId];
      return n ? { type: n.type, config: n.config ?? {} } : null;
    },
    async resolveNext(_defId, sourceNode, sourcePort) {
      return selectNextTarget(opts.edges, sourceNode, sourcePort);
    },
    async moveTo(s, nextNodeId, patch) {
      state = {
        ...s,
        currentNodeId: nextNodeId,
        status: 'active',
        context: { ...s.context, ...patch },
      };
    },
    async setStatus(s, status, patch) {
      state = { ...s, status, context: patch ? { ...s.context, ...patch } : s.context };
    },
    async recordRun(r) {
      runs.push(r);
    },
  };

  const deps: AdvanceDeps = {
    store,
    getNode: (type) => {
      const d = defMap.get(type);
      if (!d) throw new Error(`unknown type ${type}`);
      return d;
    },
    emit: async (e) => {
      events.push(e);
    },
    lock: opts.lock,
  };

  return {
    deps,
    runs,
    events,
    get state() {
      return state;
    },
  };
}

test('advance: moves an item along a linear edge', async () => {
  const h = harness({
    nodes: { a: { type: 'pass' }, b: { type: 'pass' } },
    edges: [{ sourceNode: 'a', sourcePort: 'ok', targetNode: 'b' }],
    defs: [node('pass', returns({ output: 'ok' }))],
    start: 'a',
  });

  const out = await advanceItem(h.deps, { orgId: ORG, serialUnitId: 1, actor: ACTOR });

  assert.equal(out.status, 'moved');
  if (out.status === 'moved') {
    assert.equal(out.from, 'a');
    assert.equal(out.to, 'b');
    assert.equal(out.output, 'ok');
  }
  assert.equal(h.state?.currentNodeId, 'b');
  assert.equal(h.runs.length, 1);
  assert.equal(h.events.length, 1);
});

test('advance: terminal node (no matching edge) marks the item done', async () => {
  const h = harness({
    nodes: { last: { type: 'pass' } },
    edges: [],
    defs: [node('pass', returns({ output: 'ok' }))],
    start: 'last',
  });

  const out = await advanceItem(h.deps, { orgId: ORG, serialUnitId: 1, actor: ACTOR });

  assert.equal(out.status, 'done');
  assert.equal(h.state?.status, 'done');
});

test('advance: conditional routing — inspection fail goes to repair', async () => {
  const h = harness({
    nodes: { inspect: { type: 'inspection' }, ship: { type: 'pass' }, repair: { type: 'pass' } },
    edges: [
      { sourceNode: 'inspect', sourcePort: 'pass', targetNode: 'ship' },
      { sourceNode: 'inspect', sourcePort: 'fail', targetNode: 'repair' },
    ],
    defs: [
      node('inspection', returns({ output: 'fail' })),
      node('pass', returns({ output: 'ok' })),
    ],
    start: 'inspect',
  });

  const out = await advanceItem(h.deps, { orgId: ORG, serialUnitId: 1, actor: ACTOR });

  assert.equal(out.status, 'moved');
  if (out.status === 'moved') assert.equal(out.to, 'repair');
  assert.equal(h.state?.currentNodeId, 'repair');
});

test('advance: await:true parks the item as blocked (no routing)', async () => {
  const h = harness({
    nodes: { a: { type: 'wait' }, b: { type: 'pass' } },
    edges: [{ sourceNode: 'a', sourcePort: 'ok', targetNode: 'b' }],
    defs: [node('wait', returns({ output: 'ok', await: true }))],
    start: 'a',
  });

  const out = await advanceItem(h.deps, { orgId: ORG, serialUnitId: 1, actor: ACTOR });

  assert.equal(out.status, 'blocked');
  assert.equal(h.state?.status, 'blocked');
  assert.equal(h.state?.currentNodeId, 'a'); // did not move
});

test('advance: a throwing node is captured as an error transition', async () => {
  const h = harness({
    nodes: { a: { type: 'boom' } },
    edges: [],
    defs: [node('boom', throws('kaboom'))],
    start: 'a',
  });

  const out = await advanceItem(h.deps, { orgId: ORG, serialUnitId: 1, actor: ACTOR });

  assert.equal(out.status, 'error');
  if (out.status === 'error') assert.match(out.error, /kaboom/);
  assert.equal(h.state?.status, 'error');
  assert.equal(h.runs.length, 1);
  assert.match(String(h.runs[0].error), /kaboom/);
  assert.equal(h.runs[0].output, ERROR_OUTPUT);
});

test('advance: unknown node type errors without throwing', async () => {
  const h = harness({
    nodes: { a: { type: 'ghost' } },
    edges: [],
    defs: [], // no def registered for 'ghost'
    start: 'a',
  });

  const out = await advanceItem(h.deps, { orgId: ORG, serialUnitId: 1, actor: ACTOR });

  assert.equal(out.status, 'error');
  if (out.status === 'error') assert.match(out.error, /Unknown node type/);
  assert.equal(h.state?.status, 'error');
});

test('advance: node output data is merged into item context', async () => {
  const h = harness({
    nodes: { a: { type: 'tester' }, b: { type: 'pass' } },
    edges: [{ sourceNode: 'a', sourcePort: 'pass', targetNode: 'b' }],
    defs: [node('tester', returns({ output: 'pass', data: { testId: 42 } }))],
    start: 'a',
  });

  await advanceItem(h.deps, { orgId: ORG, serialUnitId: 1, actor: ACTOR });

  assert.equal(h.state?.context.testId, 42);
});

test('advance: not enrolled is a no-op', async () => {
  const h = harness({
    nodes: {},
    edges: [],
    defs: [],
    start: 'a',
    state: null,
  });

  const out = await advanceItem(h.deps, { orgId: ORG, serialUnitId: 1, actor: ACTOR });

  assert.equal(out.status, 'noop');
  if (out.status === 'noop') assert.equal(out.reason, 'not_enrolled');
});

test('advance: an already-done item is a no-op', async () => {
  const h = harness({
    nodes: { a: { type: 'pass' } },
    edges: [],
    defs: [node('pass', returns({ output: 'ok' }))],
    start: 'a',
    initialStatus: 'done',
  });

  const out = await advanceItem(h.deps, { orgId: ORG, serialUnitId: 1, actor: ACTOR });

  assert.equal(out.status, 'noop');
  if (out.status === 'noop') assert.equal(out.reason, 'already_terminal');
});

test('advance: a held lock makes advance a no-op (no double-advance)', async () => {
  let runCalled = false;
  const heldLock: AdvanceLock = { async acquire() { return false; }, async release() {} };
  const h = harness({
    nodes: { a: { type: 'pass' } },
    edges: [{ sourceNode: 'a', sourcePort: 'ok', targetNode: 'b' }],
    defs: [node('pass', async () => { runCalled = true; return { output: 'ok' }; })],
    start: 'a',
    lock: heldLock,
  });

  const out = await advanceItem(h.deps, { orgId: ORG, serialUnitId: 1, actor: ACTOR });

  assert.equal(out.status, 'noop');
  if (out.status === 'noop') assert.equal(out.reason, 'locked');
  assert.equal(runCalled, false); // node never ran
  assert.equal(h.state?.currentNodeId, 'a');
});
