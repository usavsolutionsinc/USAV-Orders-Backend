/**
 * DB-free tests for per-staff rail dismiss (staff_rail_exclusions writers).
 * Run: npx tsx --test src/lib/receiving/rail-exclusions.test.ts
 */

// FIRST: well-formed DATABASE_URL before the tenancy/db barrel loads.
import '@/lib/assistant/test-db-url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addRailExclusions,
  removeRailExclusions,
  listRailExclusions,
  stationForReceivingFeed,
  type RailExclusionDeps,
} from './rail-exclusions';
import type { FeedWriteClient } from '@/lib/surfaces/feed-writes';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = '11111111-2222-3333-4444-555555555555' as OrgId;

function fakes(listRows: Array<{ entity_type: string; entity_id: string }> = []) {
  const cap = {
    inserts: [] as ReadonlyArray<unknown>[],
    deletes: [] as ReadonlyArray<unknown>[],
    txns: 0,
    listParams: [] as ReadonlyArray<unknown>[],
  };
  const client: FeedWriteClient = {
    async query(text, params = []) {
      if (text.includes('INSERT INTO staff_rail_exclusions')) cap.inserts.push(params);
      if (text.includes('DELETE FROM staff_rail_exclusions')) cap.deletes.push(params);
      return { rows: [], rowCount: 1 };
    },
  };
  const deps: RailExclusionDeps = {
    runTransaction: async (_orgId, fn) => {
      cap.txns += 1;
      return fn(client);
    },
    query: (async (_orgId: OrgId, _text: string, params: ReadonlyArray<unknown>) => {
      cap.listParams.push(params);
      return { rows: listRows, rowCount: listRows.length };
    }) as RailExclusionDeps['query'],
  };
  return { deps, cap };
}

test('stationForReceivingFeed: receiving feeds map to the RECEIVING station', () => {
  assert.equal(stationForReceivingFeed('receiving_triage'), 'RECEIVING');
  assert.equal(stationForReceivingFeed('receiving_unbox'), 'RECEIVING');
});

test('addRailExclusions: inserts one row per item, org/staff/station threaded', async () => {
  const { deps, cap } = fakes();
  const out = await addRailExclusions(
    {
      orgId: ORG,
      staffId: 7,
      feedKey: 'receiving_triage',
      items: [
        { entityType: 'RECEIVING_LINE', entityId: 41 },
        { entityType: 'RECEIVING', entityId: 88 },
      ],
    },
    deps,
  );
  assert.equal(out.ok, true);
  assert.equal(out.count, 2);
  assert.equal(out.applied.length, 2);
  assert.equal(cap.txns, 1);
  assert.equal(cap.inserts.length, 2);
  // insertStaffRailExclusion binds [orgId, staffId, station, feedKey, entityType, entityId]
  assert.deepEqual(cap.inserts[0], [ORG, 7, 'RECEIVING', 'receiving_triage', 'RECEIVING_LINE', 41]);
  assert.deepEqual(cap.inserts[1], [ORG, 7, 'RECEIVING', 'receiving_triage', 'RECEIVING', 88]);
});

test('addRailExclusions: rejects a non-receiving feedKey with 400, no transaction', async () => {
  const { deps, cap } = fakes();
  const out = await addRailExclusions(
    { orgId: ORG, staffId: 7, feedKey: 'testing_queue', items: [{ entityType: 'RECEIVING_LINE', entityId: 1 }] },
    deps,
  );
  assert.equal(out.ok, false);
  assert.equal(out.status, 400);
  assert.equal(cap.txns, 0);
});

test('addRailExclusions: rejects a non-receiving entityType with 400', async () => {
  const { deps, cap } = fakes();
  const out = await addRailExclusions(
    { orgId: ORG, staffId: 7, feedKey: 'receiving_triage', items: [{ entityType: 'SERIAL_UNIT', entityId: 1 }] },
    deps,
  );
  assert.equal(out.ok, false);
  assert.equal(out.status, 400);
  assert.equal(cap.txns, 0);
});

test('addRailExclusions: rejects empty items and non-positive ids', async () => {
  const empty = fakes();
  assert.equal((await addRailExclusions({ orgId: ORG, staffId: 7, feedKey: 'receiving_triage', items: [] }, empty.deps)).status, 400);

  const bad = fakes();
  const out = await addRailExclusions(
    { orgId: ORG, staffId: 7, feedKey: 'receiving_triage', items: [{ entityType: 'RECEIVING_LINE', entityId: 0 }] },
    bad.deps,
  );
  assert.equal(out.status, 400);
  assert.equal(bad.cap.txns, 0);
});

test('removeRailExclusions: deletes one row per item', async () => {
  const { deps, cap } = fakes();
  const out = await removeRailExclusions(
    { orgId: ORG, staffId: 7, feedKey: 'receiving_unbox', items: [{ entityType: 'RECEIVING', entityId: 88 }] },
    deps,
  );
  assert.equal(out.ok, true);
  assert.equal(cap.deletes.length, 1);
  assert.deepEqual(cap.deletes[0], [ORG, 7, 'RECEIVING', 'receiving_unbox', 'RECEIVING', 88]);
});

test('listRailExclusions: maps rows, filters by org/staff/station/feed; invalid feed → []', async () => {
  const { deps, cap } = fakes([
    { entity_type: 'RECEIVING_LINE', entity_id: '41' },
    { entity_type: 'RECEIVING', entity_id: '88' },
  ]);
  const items = await listRailExclusions(ORG, 7, 'receiving_triage', deps);
  assert.deepEqual(items, [
    { entityType: 'RECEIVING_LINE', entityId: 41 },
    { entityType: 'RECEIVING', entityId: 88 },
  ]);
  assert.deepEqual(cap.listParams[0], [ORG, 7, 'RECEIVING', 'receiving_triage']);

  const bad = fakes();
  assert.deepEqual(await listRailExclusions(ORG, 7, 'not_a_feed', bad.deps), []);
  assert.equal(bad.cap.listParams.length, 0);
});
