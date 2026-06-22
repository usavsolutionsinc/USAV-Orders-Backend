/**
 * DB-free unit tests for the template-import clone (Studio ST6 / Phase E4).
 * Mirrors definitions.test.ts: a fake tx client captures every SQL call so we
 * assert on both the return value and what got threaded to the client —
 * specifically that node ids are RE-MINTED, edges are remapped through the same
 * map, every cloned row is org-stamped, and the draft is is_active = FALSE.
 *
 *   node --import tsx --test src/lib/studio/templates.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import type { OrgId } from '@/lib/tenancy/constants';
import { createDraftFromTemplate, type CreateDraftFromTemplateDeps } from './templates';

const ORG = '00000000-0000-0000-0000-000000000001' as OrgId;

interface QueryCall {
  sql: string;
  params: unknown[];
}

/** Normalize whitespace so a regex over multi-line SQL is robust. */
const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim();

function templateClient(opts: {
  templateRow?: { slug: string; name: string; graph: unknown } | null;
  draftId?: number;
  draftVersion?: number;
}) {
  const queries: QueryCall[] = [];
  const client: Pick<PoolClient, 'query'> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: (async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      const s = flat(sql);
      if (/^SELECT slug, name, graph FROM workflow_templates/.test(s)) {
        const row = opts.templateRow === undefined ? null : opts.templateRow;
        return { rows: row ? [row] : [] };
      }
      // version-group lock — returns no rows (first import of this name).
      if (/^SELECT id FROM workflow_definitions WHERE organization_id = \$1 AND name = \$2 FOR UPDATE/.test(s)) {
        return { rows: [] };
      }
      if (/^INSERT INTO workflow_definitions/.test(s)) {
        return { rows: [{ id: opts.draftId ?? 77, version: opts.draftVersion ?? 1 }] };
      }
      return { rows: [] };
    }) as PoolClient['query'],
  };
  return { client, queries };
}

/** Deterministic id minter so edge remapping is assertable. */
function seqIds(): CreateDraftFromTemplateDeps {
  let n = 0;
  let e = 0;
  return { newId: (prefix) => (prefix === 'n' ? `n-new-${++n}` : `e-new-${++e}`) };
}

const REFURB_GRAPH = {
  nodes: [
    { id: 'receive', type: 'receiving', x: 40, y: 200, config: { station: 'RECEIVING' } },
    { id: 'test', type: 'inspection', x: 340, y: 200, config: { slaHours: 48 } },
  ],
  edges: [{ id: 'e-1', source: 'receive', sourcePort: 'received', target: 'test' }],
};

test('import: re-mints node ids, remaps the edge, org-stamps, is_active=false', async () => {
  const f = templateClient({
    templateRow: { slug: 'standard-refurb-and-list', name: 'Standard refurb-and-list', graph: REFURB_GRAPH },
    draftId: 77,
    draftVersion: 1,
  });

  const res = await createDraftFromTemplate(
    { client: f.client, orgId: ORG, staffId: 9, templateId: 3 },
    seqIds(),
  );

  assert.equal(res.status, 200);
  if (res.status !== 200) return;
  assert.deepEqual(res.body, { ok: true, id: 77, version: 1 });
  assert.deepEqual(res.audit, {
    draftId: 77,
    templateId: 3,
    templateSlug: 'standard-refurb-and-list',
    name: 'Standard refurb-and-list',
    version: 1,
    nodes: 2,
    edges: 1,
  });

  // The template is resolved from the GLOBAL table — no org predicate.
  const tplSel = f.queries.find((q) => /^SELECT slug, name, graph FROM workflow_templates/.test(flat(q.sql)));
  assert.ok(tplSel);
  assert.deepEqual(tplSel!.params, [3]);
  assert.ok(!/organization_id/.test(flat(tplSel!.sql)), 'template read must not be org-scoped (global table)');

  // The (org, name) version group is locked FOR UPDATE before the draft INSERT.
  const groupLock = f.queries.find((q) =>
    /^SELECT id FROM workflow_definitions WHERE organization_id = \$1 AND name = \$2 FOR UPDATE/.test(flat(q.sql)),
  );
  assert.ok(groupLock, 'version-group FOR UPDATE lock must run');
  assert.deepEqual(groupLock!.params, [ORG, 'Standard refurb-and-list']);

  // The draft INSERT org-stamps explicitly and sets is_active = FALSE.
  const insertDef = f.queries.find((q) => /^INSERT INTO workflow_definitions/.test(flat(q.sql)));
  assert.ok(insertDef);
  assert.match(flat(insertDef!.sql), /FALSE, \$3/);
  assert.deepEqual(insertDef!.params, [ORG, 'Standard refurb-and-list', 9]);

  // Two node INSERTs, each with a fresh re-minted id (not the template ids),
  // org-scoped via the draftId fk.
  const nodeInserts = f.queries.filter((q) => /^INSERT INTO workflow_nodes/.test(flat(q.sql)));
  assert.equal(nodeInserts.length, 2);
  assert.deepEqual(nodeInserts[0].params, ['n-new-1', 77, 'receiving', 40, 200, JSON.stringify({ station: 'RECEIVING' })]);
  assert.deepEqual(nodeInserts[1].params, ['n-new-2', 77, 'inspection', 340, 200, JSON.stringify({ slaHours: 48 })]);

  // The edge is remapped through the same id map (receive→n-new-1, test→n-new-2)
  // and gets its own fresh edge id; the port is preserved.
  const edgeInserts = f.queries.filter((q) => /^INSERT INTO workflow_edges/.test(flat(q.sql)));
  assert.equal(edgeInserts.length, 1);
  assert.deepEqual(edgeInserts[0].params, ['e-new-1', 77, 'n-new-1', 'received', 'n-new-2']);
});

test('import: an explicit name overrides the template name (and the lock keys on it)', async () => {
  const f = templateClient({
    templateRow: { slug: 'standard-refurb-and-list', name: 'Standard refurb-and-list', graph: REFURB_GRAPH },
  });
  const res = await createDraftFromTemplate(
    { client: f.client, orgId: ORG, staffId: 1, templateId: 3, name: 'My custom flow' },
    seqIds(),
  );
  assert.equal(res.status, 200);
  if (res.status !== 200) return;
  assert.equal(res.audit.name, 'My custom flow');
  const groupLock = f.queries.find((q) =>
    /^SELECT id FROM workflow_definitions WHERE organization_id = \$1 AND name = \$2 FOR UPDATE/.test(flat(q.sql)),
  );
  assert.deepEqual(groupLock!.params, [ORG, 'My custom flow']);
  const insertDef = f.queries.find((q) => /^INSERT INTO workflow_definitions/.test(flat(q.sql)));
  assert.deepEqual(insertDef!.params, [ORG, 'My custom flow', 1]);
});

test('import: unknown template → 404, nothing inserted', async () => {
  const f = templateClient({ templateRow: null });
  const res = await createDraftFromTemplate({ client: f.client, orgId: ORG, staffId: 1, templateId: 999 }, seqIds());
  assert.equal(res.status, 404);
  if (res.status !== 404) return;
  assert.equal(res.body.ok, false);
  assert.ok(!f.queries.some((q) => /^INSERT INTO/.test(flat(q.sql))), 'nothing is inserted on 404');
});

test('import: an edge with a dangling endpoint is dropped, not cloned', async () => {
  const f = templateClient({
    templateRow: {
      slug: 't',
      name: 'T',
      graph: {
        nodes: [{ id: 'a', type: 'receiving', x: 0, y: 0, config: {} }],
        edges: [{ id: 'e-bad', source: 'a', sourcePort: 'received', target: 'ghost' }],
      },
    },
  });
  const res = await createDraftFromTemplate({ client: f.client, orgId: ORG, staffId: 1, templateId: 5 }, seqIds());
  assert.equal(res.status, 200);
  if (res.status !== 200) return;
  assert.equal(res.audit.edges, 0);
  assert.ok(!f.queries.some((q) => /^INSERT INTO workflow_edges/.test(flat(q.sql))), 'no edge cloned when an endpoint dangles');
});

test('import: a template with an empty graph clones a valid empty draft', async () => {
  const f = templateClient({
    templateRow: { slug: 'blank', name: 'Blank', graph: { nodes: [], edges: [] } },
    draftVersion: 1,
  });
  const res = await createDraftFromTemplate({ client: f.client, orgId: ORG, staffId: 1, templateId: 1 }, seqIds());
  assert.equal(res.status, 200);
  if (res.status !== 200) return;
  assert.deepEqual(res.audit, {
    draftId: 77,
    templateId: 1,
    templateSlug: 'blank',
    name: 'Blank',
    version: 1,
    nodes: 0,
    edges: 0,
  });
  assert.ok(!f.queries.some((q) => /^INSERT INTO workflow_(nodes|edges)/.test(flat(q.sql))));
});
