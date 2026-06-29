/**
 * DB-free unit test for recordDataWipe — fakes capture what's threaded into the
 * injected Deps (event append + workflow tap), asserting both the return value
 * and the collaborator calls. Run: node --import tsx --test src/lib/tech/recordDataWipe.test.ts
 */
import { test } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { recordDataWipe, type RecordDataWipeDeps } from './recordDataWipe';
import type { TestedUnit } from './recordTestVerdict';

const UNIT: TestedUnit = {
  id: 7,
  serial_number: 'SN-WIPE-7',
  current_status: 'TESTED',
  sku: 'TV-55',
  origin_receiving_line_id: 31,
  organization_id: 'org-1',
};

function fakes(over: Partial<RecordDataWipeDeps> = {}) {
  const calls = { append: [] as any[], tap: [] as any[] };
  const deps: RecordDataWipeDeps = {
    fetchUnit: async () => UNIT,
    appendEvent: (async (input: any) => {
      calls.append.push(input);
      return { event: { id: 4242 } as any, created: true };
    }) as RecordDataWipeDeps['appendEvent'],
    tap: (async (input: any) => {
      calls.tap.push(input);
    }) as RecordDataWipeDeps['tap'],
    ...over,
  };
  return { deps, calls };
}

test('returns null when the unit is not found / wrong tenant', async () => {
  const { deps, calls } = fakes({ fetchUnit: async () => null });
  const res = await recordDataWipe(
    { serialUnitId: 999, wipeSuccess: true, organizationId: 'org-1' },
    deps,
  );
  strictEqual(res, null);
  strictEqual(calls.append.length, 0, 'no event on a missing unit');
  strictEqual(calls.tap.length, 0, 'no tap on a missing unit');
});

test('records a DATA_WIPED event with the wipe payload, status UNCHANGED', async () => {
  const { deps, calls } = fakes();
  const res = await recordDataWipe(
    {
      serialUnitId: 7,
      wipeSuccess: true,
      wipeMethod: 'secure_erase',
      wipeCertRef: 'CERT-1',
      actorStaffId: 5,
      clientEventId: 'evt-1',
      organizationId: 'org-1',
    },
    deps,
  );
  ok(res);
  strictEqual(res!.eventId, 4242);
  strictEqual(res!.wipeSuccess, true);
  strictEqual(res!.idempotent, false);

  strictEqual(calls.append.length, 1);
  const ev = calls.append[0];
  strictEqual(ev.eventType, 'DATA_WIPED');
  strictEqual(ev.station, 'TECH');
  strictEqual(ev.serialUnitId, 7);
  strictEqual(ev.organizationId, 'org-1');
  strictEqual(ev.clientEventId, 'evt-1');
  // The defining assertion: the wipe is a gate, not a transition.
  strictEqual(ev.prevStatus, ev.nextStatus, 'wipe must not change current_status');
  strictEqual(ev.prevStatus, 'TESTED');
  deepStrictEqual(ev.payload, { wipeSuccess: true, wipeMethod: 'secure_erase', wipeCertRef: 'CERT-1' });
});

test('taps data_wiped, position-guarded to the data_wipe node', async () => {
  const { deps, calls } = fakes();
  await recordDataWipe({ serialUnitId: 7, wipeSuccess: false, actorStaffId: 5, organizationId: 'org-1' }, deps);
  strictEqual(calls.tap.length, 1);
  const tap = calls.tap[0];
  strictEqual(tap.event, 'data_wiped');
  strictEqual(tap.expectNodeType, 'data_wipe', 'must not advance a unit not at the wipe node');
  strictEqual(tap.serialUnitId, 7);
  strictEqual(tap.input.wipeSuccess, false, 'failed wipe routes to repair');
  strictEqual(tap.orgId, 'org-1');
});

test('idempotent flag reflects a replayed event (created=false)', async () => {
  const { deps } = fakes({
    appendEvent: (async () => ({ event: { id: 4242 } as any, created: false })) as RecordDataWipeDeps['appendEvent'],
  });
  const res = await recordDataWipe({ serialUnitId: 7, wipeSuccess: true, organizationId: 'org-1' }, deps);
  strictEqual(res!.idempotent, true);
});
