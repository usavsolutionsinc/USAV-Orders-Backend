/**
 * DB-free unit tests for the node-bound station write helpers (Operations
 * Studio Phase D / ST5). Mirrors studio/definitions.test.ts: a fake tx client
 * captures every SQL call, so we assert on both the verdict and what got
 * threaded to the client + injected validator.
 *
 *   node --import tsx --test src/lib/studio/node-station.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import type { OrgId } from '@/lib/tenancy/constants';
import type { StationConfig } from '@/lib/stations/contract';
import type { StationConfigIssue } from '@/lib/stations/validate';
import {
  NODE_STATION_PAGE_KEY,
  nodeStationModeKey,
  saveNodeStationDraft,
  publishNodeStation,
} from './node-station';

const ORG = '00000000-0000-0000-0000-000000000001' as OrgId;

interface QueryCall {
  sql: string;
  params: unknown[];
}

const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim();

/** A minimal valid composition (a checklist in queue) — content is opaque to the helper. */
const CONFIG: StationConfig = {
  slots: { queue: [{ id: 'blk_1', block: 'checklist' }] },
};

/** No-op validator → "config is valid". */
const passValidate = () => [] as StationConfigIssue[];

// ─── nodeStationModeKey / namespace ──────────────────────────────────────────

test('namespace: page key is the reserved studio-node, mode key is the node id', () => {
  assert.equal(NODE_STATION_PAGE_KEY, 'studio-node');
  assert.equal(nodeStationModeKey('refurb-v1-receive'), 'refurb-v1-receive');
});

// ─── saveNodeStationDraft ────────────────────────────────────────────────────

function saveClient(opts: { upsertRow?: Record<string, unknown> | null }) {
  const queries: QueryCall[] = [];
  const client: Pick<PoolClient, 'query'> = {
    query: (async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      const s = flat(sql);
      if (/WITH active AS/.test(s)) {
        const row =
          opts.upsertRow === undefined
            ? {
                id: 7,
                page_key: 'studio-node',
                mode_key: 'refurb-v1-receive',
                label: 'Receiving',
                workflow_node_id: 'refurb-v1-receive',
                config: CONFIG,
                version: 3,
                is_active: false,
                updated_by: 42,
                updated_at: '2026-06-22T00:00:00Z',
              }
            : opts.upsertRow;
        return { rows: row ? [row] : [] };
      }
      return { rows: [] };
    }) as PoolClient['query'],
  };
  return { client, queries };
}

test('save: registry-validates, upserts under (studio-node, nodeId), stamps node id + audit', async () => {
  const f = saveClient({});
  const res = await saveNodeStationDraft(
    { client: f.client, orgId: ORG, nodeId: 'refurb-v1-receive', label: 'Receiving', config: CONFIG, staffId: 42 },
    { validate: passValidate },
  );

  assert.equal(res.status, 200);
  if (res.status !== 200) return;
  assert.equal(res.body.draft.id, 7);
  assert.deepEqual(res.audit, {
    pageKey: 'studio-node',
    modeKey: 'refurb-v1-receive',
    version: 3,
    workflowNodeId: 'refurb-v1-receive',
  });

  // The upsert is the single CTE, scoped to org + the reserved namespace, and
  // binds workflow_node_id = the node id ($5).
  const upsert = f.queries.find((q) => /WITH active AS/.test(flat(q.sql)));
  assert.ok(upsert, 'the upsert CTE must run');
  assert.match(flat(upsert!.sql), /UPDATE station_definitions.*INSERT INTO station_definitions/);
  // params: [org, page_key, mode_key, label, workflow_node_id, config-json, staffId]
  assert.equal(upsert!.params[0], ORG);
  assert.equal(upsert!.params[1], 'studio-node');
  assert.equal(upsert!.params[2], 'refurb-v1-receive');
  assert.equal(upsert!.params[3], 'Receiving');
  assert.equal(upsert!.params[4], 'refurb-v1-receive'); // workflow_node_id binding
  assert.equal(upsert!.params[6], 42);
  // config is threaded as a JSON string (the ::jsonb cast lives in the SQL).
  assert.equal(typeof upsert!.params[5], 'string');
  assert.deepEqual(JSON.parse(upsert!.params[5] as string), CONFIG);
});

test('save: invalid config short-circuits to 422, no SQL runs', async () => {
  const f = saveClient({});
  const failValidate = () => [{ blockId: 'blk_1', message: 'Unknown block type "ghost"' }];
  const res = await saveNodeStationDraft(
    { client: f.client, orgId: ORG, nodeId: 'n1', label: 'X', config: CONFIG, staffId: 1 },
    { validate: failValidate },
  );
  assert.equal(res.status, 422);
  if (res.status !== 422) return;
  assert.equal(res.body.error, 'INVALID_CONFIG');
  assert.equal(res.body.issues.length, 1);
  assert.equal(f.queries.length, 0, 'no SQL on invalid config');
});

test('save: upsert returning no row → 500', async () => {
  const f = saveClient({ upsertRow: null });
  const res = await saveNodeStationDraft(
    { client: f.client, orgId: ORG, nodeId: 'n1', label: 'X', config: CONFIG, staffId: 1 },
    { validate: passValidate },
  );
  assert.equal(res.status, 500);
});

// ─── publishNodeStation ──────────────────────────────────────────────────────

function publishClient(opts: {
  targetRow?: Record<string, unknown> | null;
}) {
  const queries: QueryCall[] = [];
  const client: Pick<PoolClient, 'query'> = {
    query: (async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      const s = flat(sql);
      if (/^SELECT id, page_key, mode_key, version, is_active, workflow_node_id, config/.test(s)) {
        const row =
          opts.targetRow === undefined
            ? {
                id: 7,
                page_key: 'studio-node',
                mode_key: 'refurb-v1-receive',
                version: 3,
                is_active: false,
                workflow_node_id: 'refurb-v1-receive',
                config: CONFIG,
              }
            : opts.targetRow;
        return { rows: row ? [row] : [] };
      }
      if (/WITH deactivated AS/.test(s)) {
        return { rows: [{ id: 7, version: 3 }] };
      }
      return { rows: [] };
    }) as PoolClient['query'],
  };
  return { client, queries };
}

test('publish: validates then flips via the deactivate+activate CTE, records audit', async () => {
  const f = publishClient({});
  const res = await publishNodeStation(
    { client: f.client, orgId: ORG, id: 7, staffId: 42 },
    { validate: passValidate },
  );

  assert.equal(res.status, 200);
  if (res.status !== 200 || !('audit' in res)) return assert.fail('expected 200 with audit');
  assert.deepEqual(res.body, { ok: true, id: 7, version: 3 });
  assert.deepEqual(res.audit, {
    pageKey: 'studio-node',
    modeKey: 'refurb-v1-receive',
    version: 3,
    workflowNodeId: 'refurb-v1-receive',
  });

  // The target SELECT is scoped to org + the reserved page namespace.
  const sel = f.queries.find((q) => /^SELECT id, page_key/.test(flat(q.sql)));
  assert.ok(sel);
  assert.deepEqual(sel!.params, [7, ORG, 'studio-node']);

  // The flip is one statement: deactivate sibling CTE + activate target.
  const flip = f.queries.find((q) => /WITH deactivated AS/.test(flat(q.sql)));
  assert.ok(flip, 'the deactivate+activate CTE must run');
  assert.match(flat(flip!.sql), /SET is_active = FALSE.*SET is_active = TRUE/);
  // params: [id, org, page_key, mode_key, staffId]
  assert.deepEqual(flip!.params, [7, ORG, 'studio-node', 'refurb-v1-receive', 42]);
});

test('publish: already-active version is idempotent — no flip', async () => {
  const f = publishClient({
    targetRow: {
      id: 7,
      page_key: 'studio-node',
      mode_key: 'refurb-v1-receive',
      version: 3,
      is_active: true,
      workflow_node_id: 'refurb-v1-receive',
      config: CONFIG,
    },
  });
  const res = await publishNodeStation({ client: f.client, orgId: ORG, id: 7, staffId: 1 }, { validate: passValidate });
  assert.equal(res.status, 200);
  if (res.status !== 200) return;
  assert.deepEqual(res.body, { ok: true, alreadyActive: true, id: 7 });
  assert.ok(!f.queries.some((q) => /WITH deactivated AS/.test(flat(q.sql))), 'no flip when already active');
});

test('publish: unknown draft id → 404', async () => {
  const f = publishClient({ targetRow: null });
  const res = await publishNodeStation({ client: f.client, orgId: ORG, id: 999, staffId: 1 }, { validate: passValidate });
  assert.equal(res.status, 404);
  if (res.status !== 404) return;
  assert.equal(res.body.error, 'NOT_FOUND');
});

test('publish: a config that no longer validates blocks the flip (422)', async () => {
  const f = publishClient({});
  const failValidate = () => [{ blockId: 'blk_1', message: 'Unknown action "gone"' }];
  const res = await publishNodeStation({ client: f.client, orgId: ORG, id: 7, staffId: 1 }, { validate: failValidate });
  assert.equal(res.status, 422);
  if (res.status !== 422) return;
  assert.equal(res.body.error, 'INVALID_CONFIG');
  assert.ok(!f.queries.some((q) => /WITH deactivated AS/.test(flat(q.sql))), 'no flip on invalid config');
});
