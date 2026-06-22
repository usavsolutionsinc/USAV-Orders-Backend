import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * P1-PCK-02 — Packing page: per-SKU pack instructions + flagged QA problems.
 *
 * The packer's scan flow (StationPacking) fetches /api/get-title-by-sku on every
 * active SKU and surfaces, BEFORE the pack is confirmed:
 *   A. `packNotes`  — "how to pack this product" (sku_catalog.notes)
 *   B. `qcFlags[]`  — the published per-SKU QC checks ("verify before sealing"),
 *                     sourced from qc_check_templates via getQcChecks.
 *
 * This is an API-contract test (the data the UI binds to). It does NOT drive the
 * browser pack flow — running the live pack is destructive (decrements stock /
 * marks shipped). The UI binding is a pure render of these two fields.
 *
 * Auth comes from the `request` fixture (global-setup signs in as admin).
 * Rows are uniquely named and torn down in finally blocks.
 */

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function makeCatalog(request: APIRequestContext) {
  const sku = `E2E-PCK-${uniq()}`;
  const res = await request.post('/api/sku-catalog', {
    data: { sku, productTitle: 'E2E Pack Widget', category: `E2E-PCK-CAT-${uniq()}` },
  });
  expect(res.status(), 'catalog create').toBe(201);
  const body = await res.json();
  return { id: body.catalog.id as number, sku: body.catalog.sku as string };
}

test.describe('packing per-SKU QA — get-title-by-sku contract', () => {
  test('A: authored pack instructions round-trip into get-title-by-sku.packNotes', async ({ request }) => {
    test.skip(test.info().project.name === 'mobile', 'API test — desktop project');
    const cat = await makeCatalog(request);
    try {
      // Before authoring: field present, null (column exists — no longer 500s).
      const before = await (await request.get(`/api/get-title-by-sku?sku=${encodeURIComponent(cat.sku)}`)).json();
      expect(before).toHaveProperty('packNotes');
      expect(before).toHaveProperty('qcFlags');
      expect(Array.isArray(before.qcFlags)).toBe(true);
      expect(before.skuCatalogId).toBe(cat.id);

      // Author "how to pack this product" guidance via the catalog PATCH.
      const note = 'Double-box. Wrap each driver in 2 layers of bubble wrap.';
      const patch = await request.patch(`/api/sku-catalog/${cat.id}`, { data: { packNotes: note } });
      expect(patch.status(), 'patch packNotes').toBe(200);

      // The packer's lookup now returns it (StationPacking binds this to the
      // "How to pack this product" notice shown before confirm).
      const after = await (await request.get(`/api/get-title-by-sku?sku=${encodeURIComponent(cat.sku)}`)).json();
      expect(after.packNotes).toBe(note);
    } finally {
      await request.delete(`/api/sku-catalog/${cat.id}`).catch(() => {});
    }
  });

  test('B: a published QC check surfaces as a qcFlag for the SKU', async ({ request }) => {
    test.skip(test.info().project.name === 'mobile', 'API test — desktop project');
    const cat = await makeCatalog(request);
    try {
      const createRes = await request.post(`/api/sku-catalog/${cat.id}/qc-checks`, {
        data: {
          stepLabel: 'Inspect hinge — known crack point',
          stepType: 'PASS_FAIL',
          sortOrder: 1,
          status: 'published',
        },
      });
      expect(createRes.status(), 'create QC step').toBe(201);

      const res = await request.get(`/api/get-title-by-sku?sku=${encodeURIComponent(cat.sku)}`);
      expect(res.ok(), 'get-title-by-sku ok').toBeTruthy();
      const body = await res.json();

      expect(Array.isArray(body.qcFlags)).toBe(true);
      const labels = (body.qcFlags as Array<{ label: string }>).map((f) => f.label);
      expect(labels).toContain('Inspect hinge — known crack point');
    } finally {
      await request.delete(`/api/sku-catalog/${cat.id}`).catch(() => {});
    }
  });

  test('B: a DRAFT QC check does NOT surface as a qcFlag', async ({ request }) => {
    test.skip(test.info().project.name === 'mobile', 'API test — desktop project');
    const cat = await makeCatalog(request);
    try {
      await request.post(`/api/sku-catalog/${cat.id}/qc-checks`, {
        data: { stepLabel: 'Draft-only step', stepType: 'PASS_FAIL', sortOrder: 1, status: 'draft' },
      });

      const res = await request.get(`/api/get-title-by-sku?sku=${encodeURIComponent(cat.sku)}`);
      const body = await res.json();
      const labels = (body.qcFlags as Array<{ label: string }>).map((f) => f.label);
      expect(labels).not.toContain('Draft-only step');
    } finally {
      await request.delete(`/api/sku-catalog/${cat.id}`).catch(() => {});
    }
  });
});
