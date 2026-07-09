/**
 * DB-free tests for the view-layer projection writers (feed-writes.ts).
 * Run: npm run test:assistant
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createNodeSurface,
  deleteNodeSurface,
  deleteStaffRailExclusion,
  insertStaffRailExclusion,
  setFeedMembershipState,
  setNodeSurfaceConfig,
  type FeedWriteClient,
} from './feed-writes';

const ORG = '11111111-2222-3333-4444-555555555555';

function fakeClient(rowsFor: (text: string) => Array<Record<string, unknown>> = () => []) {
  const queries: Array<{ text: string; params: ReadonlyArray<unknown> }> = [];
  const client: FeedWriteClient = {
    async query(text, params = []) {
      queries.push({ text, params });
      const rows = rowsFor(text);
      return { rows, rowCount: rows.length };
    },
  };
  return { client, queries };
}

test('insertStaffRailExclusion: validates kinds, ON CONFLICT DO NOTHING, delete inverse', async () => {
  const { client, queries } = fakeClient();
  const r = await insertStaffRailExclusion(client, ORG, {
    staffId: 4,
    station: 'PACKING',
    feedKey: 'receiving_triage',
    entityType: 'RECEIVING',
    entityId: 88,
  });
  assert.equal(r.ok, true);
  assert.equal(r.entityId, 88);
  assert.equal(r.inverse?.kind, 'staff_rail_exclusion.delete');
  assert.ok(queries[0].text.includes('ON CONFLICT'));
  assert.equal(queries[0].params[0], ORG); // explicit org
});

test('insertStaffRailExclusion rejects an unregistered feed_key', async () => {
  const { client } = fakeClient();
  const r = await insertStaffRailExclusion(client, ORG, {
    staffId: 4,
    station: 'PACKING',
    feedKey: 'not_a_feed',
    entityType: 'RECEIVING',
    entityId: 1,
  });
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /unknown feed_key/);
});

test('deleteStaffRailExclusion inverse re-inserts', async () => {
  const { client } = fakeClient();
  const r = await deleteStaffRailExclusion(client, ORG, {
    staffId: 4,
    station: 'PACKING',
    feedKey: 'receiving_triage',
    entityType: 'RECEIVING',
    entityId: 5,
  });
  assert.equal(r.inverse?.kind, 'staff_rail_exclusion.insert');
});

test('setFeedMembershipState captures prior state; 404 when row absent', async () => {
  const present = fakeClient((t) => (t.includes('SELECT state FROM feed_memberships') ? [{ state: 'active' }] : []));
  const r = await setFeedMembershipState(present.client, ORG, {
    feedKey: 'receiving_triage',
    entityType: 'RECEIVING',
    entityId: 5,
    state: 'done',
  });
  assert.equal(r.ok, true);
  assert.equal((r.inverse?.payload as { state: string }).state, 'active');

  const absent = fakeClient(() => []);
  const r2 = await setFeedMembershipState(absent.client, ORG, {
    feedKey: 'receiving_triage',
    entityType: 'RECEIVING',
    entityId: 5,
    state: 'done',
  });
  assert.equal(r2.ok, false);
});

test('setFeedMembershipState rejects an invalid state', async () => {
  const { client } = fakeClient(() => [{ state: 'active' }]);
  const r = await setFeedMembershipState(client, ORG, {
    feedKey: 'receiving_triage',
    entityType: 'RECEIVING',
    entityId: 5,
    state: 'snoozed',
  });
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /invalid state/);
});

test('setNodeSurfaceConfig merges patch onto prior config; inverse restores prior', async () => {
  const { client, queries } = fakeClient((t) =>
    t.includes('SELECT config FROM node_surfaces') ? [{ config: { sort: 'age', limit: 20 } }] : [],
  );
  const r = await setNodeSurfaceConfig(client, ORG, { nodeSurfaceId: 7, configPatch: { sort: 'priority' } });
  assert.equal(r.ok, true);
  const upd = queries.find((q) => q.text.includes('UPDATE node_surfaces'))!;
  assert.deepEqual(JSON.parse(String(upd.params[2])), { sort: 'priority', limit: 20 });
  assert.deepEqual((r.inverse?.payload as { configPatch: unknown }).configPatch, { sort: 'age', limit: 20 });
});

// The draft-lock query createNodeSurface/deleteNodeSurface run before writing.
const draftRow = (t: string) => t.includes('FROM workflow_definitions') || t.includes('JOIN workflow_definitions');
const activeRow = draftRow;

test('createNodeSurface locks an owned draft, returns delete inverse; conflict → not created', async () => {
  const created = fakeClient((t) =>
    draftRow(t) ? [{ is_active: false }] : t.includes('INSERT INTO node_surfaces') ? [{ id: 33 }] : [],
  );
  const r = await createNodeSurface(created.client, ORG, { definitionId: 12, nodeId: 'n-a', feedKey: 'testing_queue' });
  assert.equal(r.ok, true);
  assert.equal(r.inverse?.kind, 'node_surface.delete');
  // The definition lock ran first, org-scoped, before the INSERT.
  const lockIdx = created.queries.findIndex((q) => q.text.includes('FROM workflow_definitions'));
  const insIdx = created.queries.findIndex((q) => q.text.includes('INSERT INTO node_surfaces'));
  assert.ok(lockIdx >= 0 && lockIdx < insIdx, 'draft lock precedes the insert');
  assert.equal(created.queries[lockIdx].params[0], ORG);

  const conflict = fakeClient((t) => (draftRow(t) ? [{ is_active: false }] : [])); // insert RETURNING empty
  const r2 = await createNodeSurface(conflict.client, ORG, { definitionId: 12, nodeId: 'n-a', feedKey: 'testing_queue' });
  assert.equal(r2.ok, false);
  assert.equal(r2.status, 409);
});

test('createNodeSurface: 404 when the definition is missing / not owned by the org', async () => {
  const { client, queries } = fakeClient(() => []); // definition lookup returns no row
  const r = await createNodeSurface(client, ORG, { definitionId: 999, nodeId: 'n-a', feedKey: 'testing_queue' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  // Never reached the INSERT — the guard short-circuits.
  assert.ok(!queries.some((q) => q.text.includes('INSERT INTO node_surfaces')));
});

test('createNodeSurface: 409 on the active version (publish-gate bypass blocked)', async () => {
  const { client, queries } = fakeClient((t) => (activeRow(t) ? [{ is_active: true }] : []));
  const r = await createNodeSurface(client, ORG, { definitionId: 5, nodeId: 'n-a', feedKey: 'testing_queue' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.ok(!queries.some((q) => q.text.includes('INSERT INTO node_surfaces')));
});

test('deleteNodeSurface: 409 when the owning definition is the active version', async () => {
  const { client, queries } = fakeClient((t) => (t.includes('JOIN workflow_definitions') ? [{ is_active: true }] : []));
  const r = await deleteNodeSurface(client, ORG, { nodeSurfaceId: 7 });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.ok(!queries.some((q) => q.text.includes('DELETE FROM node_surfaces')));
});

test('deleteNodeSurface: deletes on a draft and captures a create inverse', async () => {
  const { client } = fakeClient((t) =>
    t.includes('JOIN workflow_definitions')
      ? [{ is_active: false }]
      : t.includes('DELETE FROM node_surfaces')
        ? [{ workflow_definition_id: 12, node_id: 'n-a', feed_key: 'testing_queue', role: 'inbox', config: {} }]
        : [],
  );
  const r = await deleteNodeSurface(client, ORG, { nodeSurfaceId: 7 });
  assert.equal(r.ok, true);
  assert.equal(r.inverse?.kind, 'node_surface.create');
  assert.equal((r.inverse?.payload as { definitionId: number }).definitionId, 12);
});
