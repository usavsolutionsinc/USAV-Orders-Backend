/**
 * DB-free unit tests for recordPackingTick (packing-checklist Phase 2) using
 * the house Deps-injection pattern — fakes capture collaborator calls.
 *
 * Run: npx tsx --test src/lib/packing/packing-checks.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recordPackingTick,
  PACKING_STEP_TYPE,
  type PackingChecksDeps,
} from './packing-checks';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = 'org-1' as OrgId;

interface FakeState {
  queries: Array<{ sql: string; params: unknown[] }>;
  upserts: Array<Record<string, unknown>>;
}

function fakes(opts: {
  orderRow?: Record<string, unknown> | null;
  stepRow?: Record<string, unknown> | null;
}): { deps: PackingChecksDeps; state: FakeState } {
  const state: FakeState = { queries: [], upserts: [] };
  const deps: PackingChecksDeps = {
    query: async (_orgId, sql, params) => {
      state.queries.push({ sql, params });
      if (sql.includes('FROM orders')) {
        return { rows: opts.orderRow ? [opts.orderRow] : [] };
      }
      return { rows: opts.stepRow ? [opts.stepRow] : [] };
    },
    upsertVerification: (async (args: Record<string, unknown>) => {
      state.upserts.push(args);
      return { id: 1, ...args } as never;
    }) as PackingChecksDeps['upsertVerification'],
  };
  return { deps, state };
}

test('404 when the order line does not exist in the org', async () => {
  const { deps, state } = fakes({ orderRow: null });
  const res = await recordPackingTick(
    ORG,
    { orderRowId: 5, kind: 'KIT_PART', stepId: 9, checked: true, verifiedBy: 3 },
    deps,
  );
  assert.deepEqual(res, { ok: false, status: 404, error: 'order not found' });
  assert.equal(state.upserts.length, 0);
});

test('KIT_PART tick upserts step_type PACKING_PART with the part catalog id', async () => {
  const { deps, state } = fakes({
    orderRow: { id: 5, sku_catalog_id: null },
    stepRow: { sku_catalog_id: 77 },
  });
  const res = await recordPackingTick(
    ORG,
    { orderRowId: 5, kind: 'KIT_PART', stepId: 9, checked: true, verifiedBy: 3 },
    deps,
  );
  assert.equal(res.ok, true);
  assert.equal(state.upserts.length, 1);
  const up = state.upserts[0];
  assert.equal(up.sourceKind, 'order');
  assert.equal(up.sourceRowId, 5);
  assert.equal(up.stepType, PACKING_STEP_TYPE.KIT_PART);
  assert.equal(up.stepId, 9);
  assert.equal(up.skuCatalogId, 77);
  assert.equal(up.passed, true);
  assert.equal(up.verifiedBy, 3);
});

test('untick records passed = null (clears, never deletes)', async () => {
  const { deps, state } = fakes({
    orderRow: { id: 5, sku_catalog_id: 12 },
    stepRow: { sku_catalog_id: 77 },
  });
  const res = await recordPackingTick(
    ORG,
    { orderRowId: 5, kind: 'PACKING_CHECK', stepId: 4, checked: false, verifiedBy: 3 },
    deps,
  );
  assert.equal(res.ok, true);
  assert.equal(state.upserts[0].passed, null);
  assert.equal(state.upserts[0].stepType, PACKING_STEP_TYPE.PACKING_CHECK);
});

test('category-level check falls back to the order line catalog id', async () => {
  const { deps, state } = fakes({
    orderRow: { id: 5, sku_catalog_id: 12 },
    stepRow: { sku_catalog_id: null },
  });
  const res = await recordPackingTick(
    ORG,
    { orderRowId: 5, kind: 'PACKING_CHECK', stepId: 4, checked: true, verifiedBy: 3 },
    deps,
  );
  assert.equal(res.ok, true);
  assert.equal(state.upserts[0].skuCatalogId, 12);
});

test('409 when no catalog row is resolvable for the step', async () => {
  const { deps, state } = fakes({
    orderRow: { id: 5, sku_catalog_id: null },
    stepRow: { sku_catalog_id: null },
  });
  const res = await recordPackingTick(
    ORG,
    { orderRowId: 5, kind: 'PACKING_CHECK', stepId: 4, checked: true, verifiedBy: 3 },
    deps,
  );
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.status, 409);
  assert.equal(state.upserts.length, 0);
});

test('404 when the step row is missing in the org', async () => {
  const { deps } = fakes({
    orderRow: { id: 5, sku_catalog_id: 12 },
    stepRow: null,
  });
  const res = await recordPackingTick(
    ORG,
    { orderRowId: 5, kind: 'KIT_PART', stepId: 4, checked: true, verifiedBy: 3 },
    deps,
  );
  assert.deepEqual(res, { ok: false, status: 404, error: 'kit part not found' });
});
