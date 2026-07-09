import test from 'node:test';
import assert from 'node:assert/strict';
import {
  transitionReceivingLine,
  guardReceivingLine,
  type ReceivingLineTransitionDeps,
} from './state-machine';
import { deriveReceivingLineStatus, resolveReceivingLineStatus } from './workflow-stages';

// ─── Deps / db fakes ──────────────────────────────────────────────────────────
// transitionReceivingLine issues: a SELECT … FOR UPDATE (the lock), then an
// UPDATE receiving_lines. With a `db` passed and NO orgId it takes the executor
// path → no BEGIN/COMMIT, no set_config. The fake routes canned rows by
// inspecting the SQL and captures every call + the event so we assert on the
// result AND what was threaded — fully DB-free.

interface LockedRow {
  workflow_status: string;
  receiving_id: number | null;
  sku: string | null;
}

function fakes(locked: LockedRow | null) {
  const calls: {
    selectParams: unknown[] | null;
    updateSql: string | null;
    updateParams: unknown[] | null;
    event: { input: any; orgId: unknown } | null;
  } = { selectParams: null, updateSql: null, updateParams: null, event: null };

  const db = {
    query: async (sql: string, params?: unknown[]) => {
      if (/FOR UPDATE/.test(sql)) {
        calls.selectParams = params ?? null;
        return { rows: locked ? [locked] : [] };
      }
      if (/UPDATE receiving_lines/.test(sql)) {
        calls.updateSql = sql;
        calls.updateParams = params ?? null;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    },
  };

  const deps: ReceivingLineTransitionDeps = {
    recordEvent: (async (input: any, _client: unknown, orgId: unknown) => {
      calls.event = { input, orgId };
      return { id: 777, ...input };
    }) as unknown as ReceivingLineTransitionDeps['recordEvent'],
  };

  return { db, deps, calls };
}

test('happy path EXPECTED → MATCHED: writes status + coarse SCANNED + event', async () => {
  const { db, deps, calls } = fakes({ workflow_status: 'EXPECTED', receiving_id: 42, sku: 'ABC' });
  const res = await transitionReceivingLine(
    { receivingLineId: 7, to: 'MATCHED', clientEventId: 'ce-1', actorStaffId: 9 },
    db,
    undefined,
    deps,
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.from, 'EXPECTED');
  assert.equal(res.to, 'MATCHED');
  assert.equal(res.changed, true);
  assert.equal(res.coarse, 'SCANNED');
  assert.equal(res.receivingId, 42);
  // UPDATE carried the fine status + the coarse projection.
  assert.ok(calls.updateParams?.includes('MATCHED'));
  assert.ok(calls.updateParams?.includes('SCANNED'));
  // Event anchored on the line, NOT a serial unit; prev/next captured.
  assert.equal(calls.event?.input.receiving_line_id, 7);
  assert.equal(calls.event?.input.serial_unit_id, null);
  assert.equal(calls.event?.input.prev_status, 'EXPECTED');
  assert.equal(calls.event?.input.next_status, 'MATCHED');
  assert.equal(calls.event?.input.payload.action, 'receiving_line_transition');
  assert.equal(calls.event?.input.payload.coarse, 'SCANNED');
  assert.equal(calls.event?.input.client_event_id, 'ce-1');
});

test('skipEvent: guarded UPDATE runs but NO inventory_event is emitted (caller owns it)', async () => {
  const { db, deps, calls } = fakes({ workflow_status: 'MATCHED', receiving_id: 42, sku: 'ABC' });
  const res = await transitionReceivingLine(
    { receivingLineId: 7, to: 'PASSED', actorStaffId: 9, skipEvent: true },
    db,
    undefined,
    deps,
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  // The lifecycle UPDATE still happened…
  assert.ok(calls.updateSql, 'workflow_status UPDATE should still run');
  assert.ok(calls.updateParams?.includes('PASSED'));
  // …but the chokepoint did NOT write an event (eventId sentinel -1, recordEvent uncalled).
  assert.equal(res.eventId, -1);
  assert.equal(calls.event, null);
});

test('404 when the line does not exist', async () => {
  const { db, deps } = fakes(null);
  const res = await transitionReceivingLine({ receivingLineId: 999, to: 'MATCHED' }, db, undefined, deps);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.status, 404);
});

test('409 on expectedFrom mismatch (optimistic concurrency)', async () => {
  const { db, deps, calls } = fakes({ workflow_status: 'MATCHED', receiving_id: 1, sku: null });
  const res = await transitionReceivingLine(
    { receivingLineId: 1, to: 'UNBOXED', expectedFrom: 'EXPECTED' },
    db,
    undefined,
    deps,
  );
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.status, 409);
  assert.equal(res.from, 'MATCHED');
  // No event written on a rejected transition.
  assert.equal(calls.event, null);
});

test('identity transition is an idempotent no-op (changed=false) but still records', async () => {
  const { db, deps } = fakes({ workflow_status: 'UNBOXED', receiving_id: 5, sku: 'X' });
  const res = await transitionReceivingLine({ receivingLineId: 5, to: 'UNBOXED' }, db, undefined, deps);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.changed, false);
  assert.equal(res.coarse, 'UNBOXED');
});

test('unmodeled edge: non-strict proceeds, strict rejects with 409', async () => {
  // DONE → EXPECTED is not a modeled edge.
  const nonStrict = fakes({ workflow_status: 'DONE', receiving_id: 1, sku: null });
  const r1 = await transitionReceivingLine(
    { receivingLineId: 1, to: 'EXPECTED' },
    nonStrict.db,
    undefined,
    nonStrict.deps,
  );
  assert.equal(r1.ok, true, 'non-strict should proceed through an unmodeled edge');

  const strict = fakes({ workflow_status: 'DONE', receiving_id: 1, sku: null });
  const r2 = await transitionReceivingLine(
    { receivingLineId: 1, to: 'EXPECTED', strict: true },
    strict.db,
    undefined,
    strict.deps,
  );
  assert.equal(r2.ok, false);
  if (r2.ok) return;
  assert.equal(r2.status, 409);
  assert.equal(strict.calls.event, null);
});

test('RECEIVED transition stamps received_by + receivedBy threaded to UPDATE', async () => {
  const { db, deps, calls } = fakes({ workflow_status: 'UNBOXED', receiving_id: 3, sku: 'Y' });
  const res = await transitionReceivingLine(
    { receivingLineId: 3, to: 'DONE', receivedBy: 88 },
    db,
    undefined,
    deps,
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.coarse, 'RECEIVED');
  assert.ok(calls.updateParams?.includes('RECEIVED'));
  assert.ok(calls.updateParams?.includes(88));
});

test('deriveReceivingLineStatus projects the 11 fine states onto the coarse 4', () => {
  assert.equal(deriveReceivingLineStatus('EXPECTED'), 'INCOMING');
  assert.equal(deriveReceivingLineStatus('ARRIVED'), 'SCANNED');
  assert.equal(deriveReceivingLineStatus('MATCHED'), 'SCANNED');
  assert.equal(deriveReceivingLineStatus('UNBOXED'), 'UNBOXED');
  for (const s of ['AWAITING_TEST', 'IN_TEST', 'PASSED', 'FAILED', 'RTV', 'SCRAP', 'DONE']) {
    assert.equal(deriveReceivingLineStatus(s), 'RECEIVED', `${s} → RECEIVED`);
  }
  assert.equal(deriveReceivingLineStatus(null), 'INCOMING');
  assert.equal(deriveReceivingLineStatus('garbage'), 'INCOMING');
});

test('resolveReceivingLineStatus prefers the stored value, else derives', () => {
  assert.equal(resolveReceivingLineStatus('UNBOXED', 'EXPECTED'), 'UNBOXED'); // stored wins
  assert.equal(resolveReceivingLineStatus(null, 'MATCHED'), 'SCANNED'); // derive-on-read
  assert.equal(resolveReceivingLineStatus('', 'DONE'), 'RECEIVED');
  assert.equal(resolveReceivingLineStatus('bogus', 'ARRIVED'), 'SCANNED'); // invalid stored → derive
});

test('guardReceivingLine: identity ok, modeled edge ok, unmodeled rejected', () => {
  assert.equal(guardReceivingLine('UNBOXED', 'UNBOXED').ok, true);
  assert.equal(guardReceivingLine('EXPECTED', 'MATCHED').ok, true);
  assert.equal(guardReceivingLine('SCRAP', 'MATCHED').ok, false);
});
