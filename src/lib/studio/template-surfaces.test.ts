/**
 * Unit tests for template → surface seeding (Phase 5). Pure core is DB-free; the
 * seed step is tested with a fake tx client that captures the SQL calls.
 *   node --import tsx --test src/lib/studio/template-surfaces.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplateSurfaceSeeds, seedTemplateSurfaces } from './template-surfaces';
import type { TemplateGraphNode } from './templates';
import type { OrgId } from '@/lib/tenancy/constants';

const nodes: TemplateGraphNode[] = [
  { id: 'tpl-recv', type: 'receiving', x: 0, y: 0 },
  { id: 'tpl-test', type: 'testing', x: 1, y: 0 },
  { id: 'tpl-ship', type: 'fulfillment', x: 2, y: 0 },
  { id: 'tpl-unmapped', type: 'not-a-surface-node', x: 3, y: 0 },
];
const idMap = new Map<string, string>([
  ['tpl-recv', 'n-recv-1'],
  ['tpl-test', 'n-test-1'],
  ['tpl-ship', 'n-ship-1'],
  ['tpl-unmapped', 'n-unmapped-1'],
]);

test('a receiving node seeds every receiving surface, bound to the re-minted id', () => {
  const seeds = buildTemplateSurfaceSeeds([nodes[0]], idMap);
  const keys = seeds.map((s) => s.surfaceKey).sort();
  // All surfaces whose workflowNodeType === 'receiving' (unbox/triage/incoming/pickup/history).
  assert.deepEqual(keys, ['history', 'incoming', 'pickup', 'triage', 'unbox']);
  for (const s of seeds) assert.equal(s.workflowNodeId, 'n-recv-1');
});

test('testing + fulfillment nodes seed their surfaces', () => {
  const seeds = buildTemplateSurfaceSeeds([nodes[1], nodes[2]], idMap);
  const keys = new Set(seeds.map((s) => s.surfaceKey));
  assert.ok(keys.has('test'), 'testing node → test surface');
  assert.ok(keys.has('pack'), 'fulfillment node → pack surface');
  assert.ok(keys.has('outbound'), 'fulfillment node → outbound surface');
});

test('a node whose type binds no surface, or that is unmapped, is skipped', () => {
  assert.deepEqual(buildTemplateSurfaceSeeds([nodes[3]], idMap), []);
  // Node present but not in the id map → skipped (no unmapped ids smuggled in).
  assert.deepEqual(buildTemplateSurfaceSeeds([nodes[0]], new Map()), []);
});

test('two nodes of the same type do not double-seed a surface (first wins)', () => {
  const dupNodes: TemplateGraphNode[] = [
    { id: 'r1', type: 'receiving', x: 0, y: 0 },
    { id: 'r2', type: 'receiving', x: 1, y: 0 },
  ];
  const map = new Map([['r1', 'n-r1'], ['r2', 'n-r2']]);
  const seeds = buildTemplateSurfaceSeeds(dupNodes, map);
  const pairs = seeds.map((s) => `${s.pageKey}::${s.modeKey}`);
  assert.equal(new Set(pairs).size, pairs.length, 'no duplicate (page,mode)');
  for (const s of seeds) assert.equal(s.workflowNodeId, 'n-r1', 'first node wins the binding');
});

test('seedTemplateSurfaces inserts one draft station_definition per seed', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const fakeClient = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      return { rows: [{ id: calls.length }] } as { rows: { id: number }[] };
    },
  };
  const seeds = buildTemplateSurfaceSeeds([nodes[0]], idMap);
  const inserted = await seedTemplateSurfaces(fakeClient, 'org-1' as OrgId, 7, seeds);

  assert.equal(inserted, seeds.length);
  assert.equal(calls.length, seeds.length);
  for (const c of calls) {
    assert.match(c.sql, /INSERT INTO\s+station_definitions/i);
    assert.match(c.sql, /is_active.*FALSE|FALSE,\s*\$6/i);
    assert.match(c.sql, /'\{"slots":"legacy"\}'/); // draft renders legacy
    assert.match(c.sql, /NOT EXISTS/i); // idempotent per (org,page,mode,node)
    assert.equal(c.params[0], 'org-1'); // org-stamped
    assert.equal(c.params[5], 7); // updated_by = staffId
  }
});
