import test from 'node:test';
import assert from 'node:assert/strict';
import { linkShipment, setPrimaryShipmentLink, unlinkShipment } from './shipment-links';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = 'org-1' as unknown as OrgId;

function fakeClient(opts: { maxSeq?: number } = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: (async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/COALESCE\(MAX\(box_seq\)/.test(sql)) return { rows: [{ n: opts.maxSeq ?? 1 }] };
      if (/INSERT INTO shipment_links/.test(sql)) {
        return { rows: [{ id: 10, box_seq: params[4], is_primary: params[5] }] };
      }
      return { rows: [] };
    }) as any,
  };
  return { client, calls };
}

test('linkShipment with explicit boxSeq + isPrimary demotes others before upserting primary', async () => {
  const { client, calls } = fakeClient();
  const r = await linkShipment(
    ORG,
    { ownerType: 'RECEIVING', ownerId: 7, shipmentId: 99, direction: 'INBOUND', boxSeq: 1, isPrimary: true, role: 'PO_ANCHOR', linkedBy: 5 },
    client,
  );
  assert.equal(r.is_primary, true);
  const demote = calls.findIndex((c) => /UPDATE shipment_links SET is_primary = false/.test(c.sql));
  const insert = calls.findIndex((c) => /INSERT INTO shipment_links/.test(c.sql));
  assert.ok(demote >= 0 && insert > demote, 'demote must precede insert');
  assert.ok(!calls.some((c) => /MAX\(box_seq\)/.test(c.sql)), 'no seq query when boxSeq is given');
  const ins = calls[insert];
  assert.deepEqual(
    [ins.params[0], ins.params[1], ins.params[2], ins.params[3], ins.params[4], ins.params[5], ins.params[6], ins.params[7]],
    [ORG, 'RECEIVING', 7, 99, 1, true, 'INBOUND', 'PO_ANCHOR'],
  );
});

test('linkShipment without boxSeq computes MAX+1; no demote when not primary', async () => {
  const { client, calls } = fakeClient({ maxSeq: 4 });
  await linkShipment(ORG, { ownerType: 'RECEIVING', ownerId: 7, shipmentId: 100, direction: 'INBOUND' }, client);
  assert.ok(calls.some((c) => /MAX\(box_seq\)/.test(c.sql)), 'computes next seq');
  assert.ok(!calls.some((c) => /SET is_primary = false/.test(c.sql)), 'no demote when not primary');
  const ins = calls.find((c) => /INSERT INTO shipment_links/.test(c.sql))!;
  assert.equal(ins.params[4], 4);
  assert.equal(ins.params[5], false);
});

test('setPrimaryShipmentLink flips primary to the chosen shipment in one UPDATE', async () => {
  const { client, calls } = fakeClient();
  await setPrimaryShipmentLink(ORG, 'ORDER', 12, 77, client);
  const u = calls.find((c) => /UPDATE shipment_links SET is_primary = \(shipment_id = \$4\)/.test(c.sql))!;
  assert.deepEqual(u.params, [ORG, 'ORDER', 12, 77]);
});

test('unlinkShipment deletes the owner↔shipment row', async () => {
  const { client, calls } = fakeClient();
  await unlinkShipment(ORG, 'RECEIVING', 7, 99, client);
  const d = calls.find((c) => /DELETE FROM shipment_links/.test(c.sql))!;
  assert.deepEqual(d.params, [ORG, 'RECEIVING', 7, 99]);
});
