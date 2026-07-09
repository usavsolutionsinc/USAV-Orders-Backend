import test from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import { moveSerialToLine, type MoveSerialDeps } from '@/lib/receiving/serial-move';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = '00000000-0000-0000-0000-000000000001' as OrgId;

function fakes(overrides: Partial<MoveSerialDeps> = {}) {
  const calls = { events: [] as Array<Record<string, unknown>> };
  const deps: MoveSerialDeps = {
    runTransaction: async (_orgId, cb) => cb({} as PoolClient),
    loadSerial: async () => ({ id: 10, sku: 'SKU-A', current_status: 'TESTED' }),
    loadLine: async () => ({ id: 200, receiving_id: 5, sku: 'SKU-A' }),
    currentLineId: async () => 100,
    recordInventoryEvent: (async (input: Record<string, unknown>) => {
      calls.events.push(input);
      return { id: 999 };
    }) as unknown as MoveSerialDeps['recordInventoryEvent'],
    ...overrides,
  };
  return { deps, calls };
}

test('moveSerialToLine writes a MOVED event at the target line and PRESERVES the verdict status', async () => {
  const { deps, calls } = fakes();
  const res = await moveSerialToLine(
    { serial_unit_id: 10, target_receiving_line_id: 200, staff_id: 7 },
    ORG,
    deps,
  );
  assert.ok(res);
  assert.equal(res.moved, true);
  assert.equal(res.already_there, false);
  assert.equal(res.from_receiving_line_id, 100);
  assert.equal(res.to_receiving_line_id, 200);
  assert.equal(res.inventory_event_id, 999);

  assert.equal(calls.events.length, 1);
  const ev = calls.events[0];
  assert.equal(ev.event_type, 'MOVED');
  assert.equal(ev.receiving_line_id, 200);
  assert.equal(ev.receiving_id, 5);
  assert.equal(ev.serial_unit_id, 10);
  // The verdict must survive the move: next_status carries the unit's CURRENT
  // status forward, never reset to RECEIVED.
  assert.equal(ev.next_status, 'TESTED');
  assert.equal(ev.prev_status, 'TESTED');
});

test('moveSerialToLine is a no-op when the serial is already on the target line', async () => {
  const { deps, calls } = fakes({ currentLineId: async () => 200 });
  const res = await moveSerialToLine({ serial_unit_id: 10, target_receiving_line_id: 200 }, ORG, deps);
  assert.ok(res);
  assert.equal(res.moved, false);
  assert.equal(res.already_there, true);
  assert.equal(calls.events.length, 0);
});

test('moveSerialToLine throws when the serial unit is missing (→ 404 upstream)', async () => {
  const { deps } = fakes({ loadSerial: async () => null });
  await assert.rejects(
    () => moveSerialToLine({ serial_unit_id: 10, target_receiving_line_id: 200 }, ORG, deps),
    /serial_unit 10 not found/,
  );
});

test('moveSerialToLine throws when the target line is missing (→ 404 upstream)', async () => {
  const { deps } = fakes({ loadLine: async () => null });
  await assert.rejects(
    () => moveSerialToLine({ serial_unit_id: 10, target_receiving_line_id: 200 }, ORG, deps),
    /receiving_line 200 not found/,
  );
});

test('moveSerialToLine returns null for invalid ids', async () => {
  const { deps } = fakes();
  assert.equal(await moveSerialToLine({ serial_unit_id: 0, target_receiving_line_id: 200 }, ORG, deps), null);
  assert.equal(await moveSerialToLine({ serial_unit_id: 10, target_receiving_line_id: -1 }, ORG, deps), null);
});
