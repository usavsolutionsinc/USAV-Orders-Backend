/**
 * DB-free unit tests for the Studio draft-copy + publish-flip domain logic
 * (Phase C.3). Mirrors the applyTransition / markUnitListed pattern: a fakes()
 * factory drives an in-memory query responder that captures every SQL call, so
 * we assert on both the return value and what got threaded to the tx client.
 *
 *   node --import tsx --test src/lib/studio/definitions.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import type { OrgId } from '@/lib/tenancy/constants';
import type { Diagnostic } from '@/lib/workflow/diagnostics';
import {
  copyDefinitionToDraft,
  publishDefinition,
  type CopyDefinitionToDraftDeps,
  type PublishDefinitionDeps,
} from './definitions';

const ORG = '00000000-0000-0000-0000-000000000001' as OrgId;

interface QueryCall {
  sql: string;
  params: unknown[];
}

/** Normalize whitespace so a regex over multi-line SQL is robust. */
const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim();

// ─── Draft copy ──────────────────────────────────────────────────────────────

/**
 * Fake tx client for the draft copy. `rowsFor` lets each test stub the four
 * SELECTs (source def, version-group lock, node copy source, edge copy source);
 * INSERT...RETURNING returns the draft id/version.
 */
function copyClient(opts: {
  sourceRow?: { id: number; name: string } | null;
  nodeRows?: Array<{ id: string; type: string; position_x: string; position_y: string; config: unknown }>;
  edgeRows?: Array<{ source_node: string; source_port: string; target_node: string }>;
  draftId?: number;
  draftVersion?: number;
}) {
  const queries: QueryCall[] = [];
  const client: Pick<PoolClient, 'query'> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: (async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      const s = flat(sql);
      // The version-group lock SELECTs id WHERE ... name — match it BEFORE the
      // source SELECT (which selects id, name).
      if (/^SELECT id FROM workflow_definitions WHERE organization_id = \$1 AND name = \$2 FOR UPDATE/.test(s)) {
        return { rows: [] };
      }
      if (/^SELECT id, name FROM workflow_definitions/.test(s)) {
        const row = opts.sourceRow === undefined ? { id: 10, name: 'Standard refurb' } : opts.sourceRow;
        return { rows: row ? [row] : [] };
      }
      if (/^INSERT INTO workflow_definitions/.test(s)) {
        return { rows: [{ id: opts.draftId ?? 99, version: opts.draftVersion ?? 4 }] };
      }
      if (/^SELECT id, type, position_x, position_y, config FROM workflow_nodes/.test(s)) {
        return { rows: opts.nodeRows ?? [] };
      }
      if (/^SELECT source_node, source_port, target_node FROM workflow_edges/.test(s)) {
        return { rows: opts.edgeRows ?? [] };
      }
      return { rows: [] };
    }) as PoolClient['query'],
  };
  return { client, queries };
}

/** Deterministic id minter so edge remapping is assertable. */
function seqIds(): CopyDefinitionToDraftDeps {
  let n = 0;
  let e = 0;
  return { newId: (prefix) => (prefix === 'n' ? `n-new-${++n}` : `e-new-${++e}`) };
}

test('draft copy: locks the version group, re-mints node ids + remaps edges, sets is_active=false', async () => {
  const f = copyClient({
    sourceRow: { id: 10, name: 'Standard refurb' },
    nodeRows: [
      { id: 'old-a', type: 'intake', position_x: '0', position_y: '0', config: {} },
      { id: 'old-b', type: 'list_ebay', position_x: '1', position_y: '1', config: { slaHours: 24 } },
    ],
    edgeRows: [{ source_node: 'old-a', source_port: 'done', target_node: 'old-b' }],
    draftId: 99,
    draftVersion: 4,
  });

  const res = await copyDefinitionToDraft(
    { client: f.client, orgId: ORG, staffId: 7, sourceId: 10 },
    seqIds(),
  );

  assert.equal(res.status, 200);
  if (res.status !== 200) return;
  assert.deepEqual(res.body, { ok: true, id: 99, version: 4 });
  assert.deepEqual(res.audit, { draftId: 99, sourceId: 10, name: 'Standard refurb', version: 4 });

  // Source SELECT uses FOR UPDATE and is org-scoped to the requested sourceId.
  const sourceSel = f.queries.find((q) => /^SELECT id, name FROM workflow_definitions/.test(flat(q.sql)));
  assert.ok(sourceSel);
  assert.match(flat(sourceSel!.sql), /FOR UPDATE/);
  assert.deepEqual(sourceSel!.params, [ORG, 10]);

  // The whole (org, name) version group is locked FOR UPDATE.
  const groupLock = f.queries.find((q) =>
    /^SELECT id FROM workflow_definitions WHERE organization_id = \$1 AND name = \$2 FOR UPDATE/.test(flat(q.sql)),
  );
  assert.ok(groupLock, 'version-group FOR UPDATE lock must run');
  assert.deepEqual(groupLock!.params, [ORG, 'Standard refurb']);

  // The draft INSERT sets is_active = FALSE (literal in the SELECT projection).
  const insertDef = f.queries.find((q) => /^INSERT INTO workflow_definitions/.test(flat(q.sql)));
  assert.ok(insertDef);
  assert.match(flat(insertDef!.sql), /FALSE, \$3\b/);
  assert.deepEqual(insertDef!.params, [ORG, 'Standard refurb', 7, 10]);

  // Phase E3: the canvas sticky-note `annotations` column rides along on the
  // draft fork — it is in BOTH the INSERT column list and the SELECT projection
  // (copied verbatim from the source row, no per-row re-minting).
  assert.match(
    flat(insertDef!.sql),
    /INSERT INTO workflow_definitions \(organization_id, name, version, is_active, created_by, annotations\)/,
    'annotations must be in the INSERT column list',
  );
  assert.match(
    flat(insertDef!.sql),
    /FALSE, \$3, annotations FROM workflow_definitions/,
    'annotations must be copied from the source row in the SELECT projection',
  );

  // Two node INSERTs, each with a fresh re-minted id (not the old ids).
  const nodeInserts = f.queries.filter((q) => /^INSERT INTO workflow_nodes/.test(flat(q.sql)));
  assert.equal(nodeInserts.length, 2);
  assert.deepEqual(nodeInserts[0].params, ['n-new-1', 99, 'intake', '0', '0', {}]);
  assert.deepEqual(nodeInserts[1].params, ['n-new-2', 99, 'list_ebay', '1', '1', { slaHours: 24 }]);

  // The edge is remapped through the same id map (old-a→n-new-1, old-b→n-new-2)
  // and gets its own fresh edge id.
  const edgeInserts = f.queries.filter((q) => /^INSERT INTO workflow_edges/.test(flat(q.sql)));
  assert.equal(edgeInserts.length, 1);
  assert.deepEqual(edgeInserts[0].params, ['e-new-1', 99, 'n-new-1', 'done', 'n-new-2']);
});

test('draft copy: no source row → 404, no INSERTs', async () => {
  const f = copyClient({ sourceRow: null });
  const res = await copyDefinitionToDraft({ client: f.client, orgId: ORG, staffId: 1, sourceId: 5 }, seqIds());
  assert.equal(res.status, 404);
  if (res.status !== 404) return;
  assert.equal(res.body.ok, false);
  assert.ok(!f.queries.some((q) => /^INSERT INTO/.test(flat(q.sql))), 'nothing is inserted on 404');
});

test('draft copy: no sourceId copies the active definition (different SELECT)', async () => {
  const f = copyClient({ sourceRow: { id: 10, name: 'Standard refurb' } });
  const res = await copyDefinitionToDraft({ client: f.client, orgId: ORG, staffId: 1 }, seqIds());
  assert.equal(res.status, 200);
  const sourceSel = f.queries.find((q) => /^SELECT id, name FROM workflow_definitions/.test(flat(q.sql)));
  assert.match(flat(sourceSel!.sql), /is_active = TRUE/);
  assert.deepEqual(sourceSel!.params, [ORG]);
});

// ─── Publish flip ────────────────────────────────────────────────────────────

function publishClient(opts: {
  defRow?: { id: number; name: string; version: number; is_active: boolean } | null;
  nodeRows?: Array<{ id: string; type: string; config: Record<string, unknown> }>;
  edgeRows?: Array<{ id: string; source_node: string; source_port: string; target_node: string }>;
}) {
  const queries: QueryCall[] = [];
  const client: Pick<PoolClient, 'query'> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: (async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      const s = flat(sql);
      if (/^SELECT id, name, version, is_active FROM workflow_definitions/.test(s)) {
        const row =
          opts.defRow === undefined
            ? { id: 99, name: 'Standard refurb', version: 4, is_active: false }
            : opts.defRow;
        return { rows: row ? [row] : [] };
      }
      if (/^SELECT id, type, config FROM workflow_nodes/.test(s)) {
        return { rows: opts.nodeRows ?? [{ id: 'a', type: 'intake', config: {} }] };
      }
      if (/^SELECT id, source_node, source_port, target_node FROM workflow_edges/.test(s)) {
        return { rows: opts.edgeRows ?? [] };
      }
      if (/^SELECT workflow_node_id, label, config FROM station_definitions/.test(s)) {
        return { rows: [] };
      }
      return { rows: [] };
    }) as PoolClient['query'],
  };
  return { client, queries };
}

/** Publish deps whose diagnostics return a fixed finding list (default: none). */
function publishDeps(findings: Diagnostic[] = []): PublishDefinitionDeps {
  return {
    runDiagnostics: () => findings,
    hasNode: () => true,
    getNode: () => ({ type: 'x', label: 'X', icon: 'i', category: 'process', outputs: [], run: async () => ({ output: 'done' }) }),
    summarizeStations: () => new Map(),
    stationKeys: new Set<string>(),
  };
}

test('publish: clean diagnostics → flips via the single deactivate+activate CTE, records the actor', async () => {
  const f = publishClient({
    defRow: { id: 99, name: 'Standard refurb', version: 4, is_active: false },
    nodeRows: [{ id: 'a', type: 'intake', config: {} }],
    edgeRows: [{ id: 'e1', source_node: 'a', source_port: 'done', target_node: 'a' }],
  });

  const res = await publishDefinition({ client: f.client, orgId: ORG, definitionId: 99 }, publishDeps([]));

  assert.equal(res.status, 200);
  if (res.status !== 200 || !('audit' in res)) return assert.fail('expected 200 with audit');
  assert.deepEqual(res.body, { ok: true, id: 99, version: 4 });
  assert.deepEqual(res.audit, { name: 'Standard refurb', version: 4, nodes: 1, edges: 1, warnings: 0 });

  // The definition is locked FOR UPDATE before anything is read.
  const defSel = f.queries.find((q) => /^SELECT id, name, version, is_active/.test(flat(q.sql)));
  assert.ok(defSel);
  assert.match(flat(defSel!.sql), /FOR UPDATE/);
  assert.deepEqual(defSel!.params, [ORG, 99]);

  // The flip is ONE statement: a deactivate CTE + the activate UPDATE.
  const flip = f.queries.find((q) => /WITH deactivated AS/.test(flat(q.sql)));
  assert.ok(flip, 'the single deactivate+activate CTE must run');
  assert.match(flat(flip!.sql), /SET is_active = FALSE.*UPDATE workflow_definitions.*SET is_active = TRUE/);
  assert.deepEqual(flip!.params, [ORG, 'Standard refurb', 99]);
});

test('publish: an error-severity finding ABORTS — no flip, returns PUBLISH_BLOCKED', async () => {
  const f = publishClient({ defRow: { id: 99, name: 'Standard refurb', version: 4, is_active: false } });
  const blocking: Diagnostic[] = [
    { id: 'dead-end-port:a:fail', severity: 'error', rule: 'dead-end-port', nodeId: 'a', message: 'fail port goes nowhere' },
  ];

  const res = await publishDefinition({ client: f.client, orgId: ORG, definitionId: 99 }, publishDeps(blocking));

  assert.equal(res.status, 422);
  if (res.status !== 422) return;
  assert.equal(res.body.error, 'PUBLISH_BLOCKED');
  assert.ok('diagnostics' in res.body && res.body.diagnostics.length === 1);

  // No flip statement ran — the draft stays a draft.
  assert.ok(!f.queries.some((q) => /WITH deactivated AS/.test(flat(q.sql))), 'no flip on blocked publish');
});

test('publish: empty graph (no nodes) is refused, no flip', async () => {
  const f = publishClient({
    defRow: { id: 99, name: 'Standard refurb', version: 4, is_active: false },
    nodeRows: [],
  });
  const res = await publishDefinition({ client: f.client, orgId: ORG, definitionId: 99 }, publishDeps([]));
  assert.equal(res.status, 422);
  if (res.status !== 422) return;
  assert.equal(res.body.error, 'cannot publish an empty graph');
  assert.ok(!f.queries.some((q) => /WITH deactivated AS/.test(flat(q.sql))));
});

test('publish: already-active version is idempotent — no diagnostics, no flip', async () => {
  const f = publishClient({ defRow: { id: 99, name: 'Standard refurb', version: 4, is_active: true } });
  const res = await publishDefinition({ client: f.client, orgId: ORG, definitionId: 99 }, publishDeps([]));
  assert.equal(res.status, 200);
  if (res.status !== 200) return;
  assert.deepEqual(res.body, { ok: true, alreadyActive: true, id: 99 });
  // Short-circuits before linting / flipping.
  assert.ok(!f.queries.some((q) => /FROM workflow_nodes/.test(flat(q.sql))), 'no node read when already active');
  assert.ok(!f.queries.some((q) => /WITH deactivated AS/.test(flat(q.sql))));
});

test('publish: unknown definition → 404', async () => {
  const f = publishClient({ defRow: null });
  const res = await publishDefinition({ client: f.client, orgId: ORG, definitionId: 1234 }, publishDeps([]));
  assert.equal(res.status, 404);
  if (res.status !== 404) return;
  assert.equal(res.body.ok, false);
});
