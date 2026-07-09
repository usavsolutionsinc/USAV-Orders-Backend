/**
 * DB-free unit tests for recordEntitySignal / emitEntitySignalSafe
 * (Deps-injection pattern; fake client captures every query).
 * Run: npm run test:surfaces
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emitEntitySignalSafe,
  recordEntitySignal,
  type RecordEntitySignalDeps,
  type RecordEntitySignalInput,
  type SignalQueryExecutor,
} from './record-entity-signal';

const ORG = '11111111-2222-3333-4444-555555555555';

interface CapturedQuery {
  text: string;
  params: ReadonlyArray<unknown>;
}

function fakes(opts: { insertedId?: number | null; failOnSignalInsert?: boolean } = {}) {
  const insertedId = opts.insertedId === undefined ? 77 : opts.insertedId;
  const cap = {
    queries: [] as CapturedQuery[],
    transactions: [] as string[],
  };
  const client: SignalQueryExecutor = {
    async query(text, params = []) {
      cap.queries.push({ text, params });
      if (text.includes('INSERT INTO entity_signals')) {
        if (opts.failOnSignalInsert) throw new Error('boom');
        return { rows: insertedId === null ? [] : [{ id: insertedId }] };
      }
      return { rows: [] };
    },
  };
  const deps: RecordEntitySignalDeps = {
    runTransaction: async (orgId, fn) => {
      cap.transactions.push(orgId);
      return fn(client);
    },
  };
  return { deps, cap, client };
}

const baseInput: RecordEntitySignalInput = {
  organizationId: ORG,
  entityType: 'SERIAL_UNIT',
  entityId: 9041,
  signalKind: 'test_fail_reason',
  notes: 'no audio from left channel',
  severity: 2,
  meta: { verdict: 'TESTING_FAILED' },
  actorStaffId: 12,
};

test('happy path: opens a tenant tx, writes signal + ops_event, returns id', async () => {
  const { deps, cap } = fakes();
  const out = await recordEntitySignal(baseInput, deps);

  assert.deepEqual(out, { ok: true, id: 77, duplicate: false });
  assert.deepEqual(cap.transactions, [ORG]); // org threaded into withTenantTransaction
  assert.equal(cap.queries.length, 2);

  const [signal, ops] = cap.queries;
  assert.ok(signal.text.includes('INSERT INTO entity_signals'));
  // Named arbiter: only the source_ref partial-unique may be absorbed — any
  // future unique violation must surface as a real error, not duplicate:true.
  assert.ok(signal.text.includes('ON CONFLICT (organization_id, signal_kind, source_ref)'));
  assert.ok(signal.text.includes('WHERE source_ref IS NOT NULL'));
  assert.equal(signal.params[0], ORG); // explicit org, never GUC-only
  assert.equal(signal.params[1], 'SERIAL_UNIT');
  assert.equal(signal.params[2], 9041);
  assert.equal(signal.params[3], 'test_fail_reason');
  assert.equal(signal.params[6], 2); // severity
  assert.equal(signal.params[10], null); // sourceRef NULL for internal kind

  assert.ok(ops.text.includes('INSERT INTO ops_events'));
  assert.ok(ops.text.includes("'signal_recorded'"));
  assert.equal(ops.params[0], ORG);
  assert.equal(ops.params[2], 'serial_unit'); // registry ops mapping (lowercase)
  assert.equal(ops.params[3], 9041);
  assert.equal(ops.params[4], 12); // actor threaded
  assert.equal(ops.params[5], 'entity-signal:77'); // idempotent client_event_id
  assert.equal(ops.params[6], null); // workflow_node_id: none in scope → NULL
});

test('nodeId flows onto the ops_events workflow_node_id "where" axis', async () => {
  const { deps, cap } = fakes();
  await recordEntitySignal({ ...baseInput, nodeId: 'node-abc-123' }, deps);
  const [, ops] = cap.queries;
  assert.ok(ops.text.includes('workflow_node_id'));
  assert.equal(ops.params[6], 'node-abc-123'); // Studio-node placement carried to the event spine
});

test('caller-owned client: rides the caller tx under a SAVEPOINT, never opens its own', async () => {
  const { deps, cap, client } = fakes();
  const out = await recordEntitySignal({ ...baseInput, client }, deps);
  assert.equal(out.ok, true);
  assert.deepEqual(cap.transactions, []); // no own transaction
  const texts = cap.queries.map((q) => q.text);
  assert.equal(texts[0], 'SAVEPOINT entity_signal_emit');
  assert.equal(texts[texts.length - 1], 'RELEASE SAVEPOINT entity_signal_emit');
  assert.equal(cap.queries.length, 4); // savepoint + signal + ops_event + release
});

test('in-tx failure rolls back to the savepoint so the caller tx is not poisoned', async () => {
  const { deps, cap, client } = fakes({ failOnSignalInsert: true });
  await emitEntitySignalSafe({ ...baseInput, client }, deps); // must not reject
  const texts = cap.queries.map((q) => q.text);
  assert.equal(texts[0], 'SAVEPOINT entity_signal_emit');
  assert.equal(texts[texts.length - 1], 'ROLLBACK TO SAVEPOINT entity_signal_emit');
});

test('idempotent duplicate (source_ref conflict): no ops_event, duplicate:true', async () => {
  const { deps, cap } = fakes({ insertedId: null });
  const out = await recordEntitySignal(
    { ...baseInput, entityType: 'ORDER', signalKind: 'buyer_note', sourceRef: 'ebay:note:abc', notes: 'pls ship fast' },
    deps,
  );
  assert.deepEqual(out, { ok: true, id: null, duplicate: true });
  assert.equal(cap.queries.length, 1); // signal insert only — ops emission skipped
});

test('validation: unknown kind / wrong entity type / bad id → ok:false, zero queries', async () => {
  const { deps, cap } = fakes();
  const cases: Array<Partial<RecordEntitySignalInput>> = [
    { signalKind: 'nonexistent_kind' },
    { entityType: 'FBA_SHIPMENT' }, // test_fail_reason does not anchor on FBA_SHIPMENT
    { entityId: 0 },
    { entityId: 1.5 },
  ];
  for (const patch of cases) {
    const out = await recordEntitySignal({ ...baseInput, ...patch }, deps);
    assert.equal(out.ok, false, JSON.stringify(patch));
  }
  assert.equal(cap.queries.length, 0);
  assert.equal(cap.transactions.length, 0);
});

test('origin contract: external kind requires sourceRef; internal kind forbids it', async () => {
  const { deps, cap } = fakes();
  const noRef = await recordEntitySignal(
    { ...baseInput, entityType: 'ORDER', signalKind: 'buyer_note', sourceRef: null },
    deps,
  );
  assert.equal(noRef.ok, false);
  const internalWithRef = await recordEntitySignal({ ...baseInput, sourceRef: 'x:1' }, deps);
  assert.equal(internalWithRef.ok, false);
  assert.equal(cap.queries.length, 0);
});

test('emitEntitySignalSafe: swallows DB errors and validation failures', async () => {
  const boom = fakes({ failOnSignalInsert: true });
  await emitEntitySignalSafe(baseInput, boom.deps); // must not reject
  assert.equal(boom.cap.queries.length, 1);

  const invalid = fakes();
  await emitEntitySignalSafe({ ...baseInput, signalKind: 'nope' }, invalid.deps); // must not reject
  assert.equal(invalid.cap.queries.length, 0);
});
