/**
 * DB-free tests for the granular draft-graph writers (draft-graph-writes.ts).
 * `npm run test:assistant` supplies DATABASE_URL via tsx's .env injection (the
 * @/lib/workflow barrel needs a well-formed URL at load; no query runs).
 * Run: npm run test:assistant
 */

import '@/lib/assistant/test-db-url'; // MUST be first: sets DATABASE_URL before the barrel loads
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  draftAddEdge,
  draftAddNode,
  draftRemoveNode,
  draftUpdateNodeConfig,
  draftReplaceNodeConfig,
  type DraftGraphClient,
} from './draft-graph-writes';
import '@/lib/workflow'; // register builtin nodes so station/decision configSchemas resolve

const ORG = '11111111-2222-3333-4444-555555555555';

function fakeClient(rowsFor: (text: string) => Array<Record<string, unknown>>) {
  const queries: Array<{ text: string; params: ReadonlyArray<unknown> }> = [];
  const client: DraftGraphClient = {
    async query(text, params = []) {
      queries.push({ text, params });
      const rows = rowsFor(text);
      return { rows, rowCount: rows.length };
    },
  };
  return { client, queries };
}

const draftDef = (t: string) =>
  t.includes('FROM workflow_definitions') && t.includes('FOR UPDATE') ? [{ id: 12, is_active: false }] : [];

test('draftAddNode: 404 when the definition is missing', async () => {
  const { client } = fakeClient(() => []);
  const r = await draftAddNode(client, ORG, { definitionId: 99, type: 'inspection' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
});

test('draftAddNode: 409 on the active version', async () => {
  const { client } = fakeClient((t) =>
    t.includes('FROM workflow_definitions') ? [{ id: 12, is_active: true }] : [],
  );
  const r = await draftAddNode(client, ORG, { definitionId: 12, type: 'inspection' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
});

test('draftAddNode: 422 on an unknown node type', async () => {
  const { client } = fakeClient(draftDef);
  const r = await draftAddNode(client, ORG, { definitionId: 12, type: 'totally_made_up' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 422);
});

test('draftAddNode: mints n-<uuid>, inserts, inverse removes it', async () => {
  const { client, queries } = fakeClient(draftDef);
  const r = await draftAddNode(client, ORG, { definitionId: 12, type: 'inspection', x: 10, y: 20 });
  assert.equal(r.ok, true);
  assert.match(r.targetRef!, /^n-/);
  assert.equal(r.inverse?.kind, 'workflow_draft.remove_node');
  const ins = queries.find((q) => q.text.includes('INSERT INTO workflow_nodes'))!;
  assert.equal(ins.params[0], r.targetRef);
});

test('draftRemoveNode: captures node + edges as the restore inverse', async () => {
  const { client } = fakeClient((t) => {
    if (t.includes('FROM workflow_definitions')) return [{ id: 12, is_active: false }];
    if (t.includes('SELECT id, type, position_x')) return [{ id: 'n-a', type: 'inspection', position_x: 1, position_y: 2, config: { k: 1 } }];
    if (t.includes('SELECT id, source_node')) return [{ id: 'e-1', source_node: 'n-a', source_port: 'ok', target_node: 'n-b' }];
    return [];
  });
  const r = await draftRemoveNode(client, ORG, { definitionId: 12, nodeId: 'n-a' });
  assert.equal(r.ok, true);
  assert.equal(r.inverse?.kind, 'workflow_draft.restore_node');
  const payload = r.inverse!.payload as { node: { id: string }; edges: unknown[] };
  assert.equal(payload.node.id, 'n-a');
  assert.equal(payload.edges.length, 1);
});

test('draftUpdateNodeConfig: merges + captures FULL prior config as replace inverse', async () => {
  const { client, queries } = fakeClient((t) => {
    if (t.includes('FROM workflow_definitions')) return [{ id: 12, is_active: false }];
    // 'pack' has no configSchema, so the merged config passes validation.
    if (t.includes('SELECT type, config FROM workflow_nodes')) return [{ type: 'pack', config: { a: 1, b: 2 } }];
    return [];
  });
  const r = await draftUpdateNodeConfig(client, ORG, { definitionId: 12, nodeId: 'n-a', configPatch: { b: 9 } });
  assert.equal(r.ok, true);
  const upd = queries.find((q) => q.text.includes('UPDATE workflow_nodes'))!;
  assert.deepEqual(JSON.parse(String(upd.params[2])), { a: 1, b: 9 });
  assert.equal(r.inverse?.kind, 'workflow_draft.replace_node_config');
  assert.deepEqual((r.inverse!.payload as { config: unknown }).config, { a: 1, b: 2 });
});

test('draftAddEdge: one-port-one-target — displaces the existing edge and records its restore', async () => {
  const { client, queries } = fakeClient((t) => {
    if (t.includes('FROM workflow_definitions')) return [{ id: 12, is_active: false }];
    if (t.includes('SELECT id, target_node FROM workflow_edges')) return [{ id: 'e-old', target_node: 'n-old' }];
    return [];
  });
  const r = await draftAddEdge(client, ORG, { definitionId: 12, source: 'n-a', sourcePort: 'ok', target: 'n-b' });
  assert.equal(r.ok, true);
  assert.ok(queries.some((q) => q.text.includes('DELETE FROM workflow_edges') && q.text.includes('source_port')));
  const inv = r.inverse!.payload as { restore: { target: string } | null };
  assert.equal(inv.restore?.target, 'n-old'); // inverse restores the displaced edge
});

// ── Node-config validation at the write path (validate-config.ts) ────────────

test('draftUpdateNodeConfig: rejects a patch that violates the type schema (400, no UPDATE)', async () => {
  const { client, queries } = fakeClient((t) => {
    if (t.includes('FROM workflow_definitions') && t.includes('FOR UPDATE')) return [{ id: 12, is_active: false }];
    if (t.includes('SELECT type, config FROM workflow_nodes')) return [{ type: 'inspection', config: {} }];
    return [];
  });
  const r = await draftUpdateNodeConfig(client, ORG, {
    definitionId: 12, nodeId: 'n1', configPatch: { slaHours: 'later' },
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.match(r.error!, /invalid node config: config\.slaHours must be a number/);
  // the write must NOT have happened
  assert.equal(queries.some((q) => q.text.includes('UPDATE workflow_nodes SET config')), false);
});

test('draftUpdateNodeConfig: accepts a valid patch and writes it', async () => {
  const { client, queries } = fakeClient((t) => {
    if (t.includes('FROM workflow_definitions') && t.includes('FOR UPDATE')) return [{ id: 12, is_active: false }];
    if (t.includes('SELECT type, config FROM workflow_nodes')) return [{ type: 'inspection', config: { trigger: 'scan' } }];
    return [];
  });
  const r = await draftUpdateNodeConfig(client, ORG, {
    definitionId: 12, nodeId: 'n1', configPatch: { slaHours: 24 },
  });
  assert.equal(r.ok, true);
  const upd = queries.find((q) => q.text.includes('UPDATE workflow_nodes SET config'))!;
  assert.deepEqual(JSON.parse(String(upd.params[2])), { trigger: 'scan', slaHours: 24 });
});

test('draftReplaceNodeConfig: rejects an off-enum replacement (400, no UPDATE)', async () => {
  const { client, queries } = fakeClient((t) => {
    if (t.includes('FROM workflow_definitions') && t.includes('FOR UPDATE')) return [{ id: 12, is_active: false }];
    if (t.includes('SELECT type, config FROM workflow_nodes')) return [{ type: 'inspection', config: {} }];
    return [];
  });
  const r = await draftReplaceNodeConfig(client, ORG, {
    definitionId: 12, nodeId: 'n1', config: { trigger: 'banner' },
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(queries.some((q) => q.text.includes('UPDATE workflow_nodes SET config')), false);
});

test('draftReplaceNodeConfig: a config of only extra (undeclared) keys is accepted', async () => {
  const { client, queries } = fakeClient((t) => {
    if (t.includes('FROM workflow_definitions') && t.includes('FOR UPDATE')) return [{ id: 12, is_active: false }];
    if (t.includes('SELECT type, config FROM workflow_nodes')) return [{ type: 'pack', config: {} }];
    return [];
  });
  const r = await draftReplaceNodeConfig(client, ORG, {
    definitionId: 12, nodeId: 'n1', config: { whatever: [1, 2, 3] },
  });
  assert.equal(r.ok, true);
  assert.ok(queries.some((q) => q.text.includes('UPDATE workflow_nodes SET config')));
});
