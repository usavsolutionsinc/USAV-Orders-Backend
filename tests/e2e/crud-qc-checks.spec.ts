import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Full-CRUD lifecycle coverage for the QC checklist endpoints brought onto the
 * house pattern + Phase-1 structured-value schema (docs/qc-crud-endpoints-plan.md):
 *
 *   - /api/sku-catalog/[id]/qc-checks         catalog authoring CRUD (value fields)
 *   - /api/receiving-lines/[id]/qc-checks     tech inline authoring CRUD
 *   - /api/serial-units/[id]/checklist        per-unit execution (value derivation)
 *   - /api/serial-units/[id]/checklist/bulk   bulk settle / clear
 *
 * API-level tests using the authenticated `request` fixture — the session
 * cookie comes from tests/.auth/admin.json (global-setup signs in as an admin).
 * Every test creates uniquely-named rows and tears them down in finally blocks,
 * so the suite is idempotent and leaves no residue.
 */

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/** Spin up a throwaway active SKU catalog row; returns { id, sku }. */
async function makeCatalog(request: APIRequestContext) {
  const sku = `E2E-QC-${uniq()}`;
  const res = await request.post('/api/sku-catalog', {
    data: { sku, productTitle: 'E2E QC Widget', category: `E2E-QC-CAT-${uniq()}` },
  });
  expect(res.status(), 'catalog create').toBe(201);
  const body = await res.json();
  return { id: body.catalog.id as number, sku: body.catalog.sku as string };
}

// ─────────────────────────────────────────────────────────────────────────────
test.describe('qc-checks — catalog authoring CRUD', () => {
  test('create → read → update → publish → delete (with structured value fields)', async ({ request }) => {
    const cat = await makeCatalog(request);
    try {
      // CREATE — a PERCENT step with a pass band.
      const createRes = await request.post(`/api/sku-catalog/${cat.id}/qc-checks`, {
        data: {
          stepLabel: 'Battery health',
          stepType: 'MEASURE',
          sortOrder: 1,
          valueKind: 'PERCENT',
          valueUnit: '%',
          passMin: 80,
          passMax: 100,
          status: 'published',
        },
      });
      expect(createRes.status(), 'create step').toBe(201);
      const created = await createRes.json();
      expect(created.success).toBe(true);
      const check = created.check;
      expect(check.step_label).toBe('Battery health');
      expect(check.value_kind).toBe('PERCENT');
      expect(check.value_unit).toBe('%');
      expect(Number(check.pass_min)).toBe(80);
      expect(Number(check.pass_max)).toBe(100);
      expect(check.status).toBe('published');
      const checkId = check.id as number;

      // READ — the step is present with its value config.
      const getRes = await request.get(`/api/sku-catalog/${cat.id}/qc-checks`);
      expect(getRes.status()).toBe(200);
      const list = await getRes.json();
      const found = (list.checks ?? []).find((c: any) => c.id === checkId);
      expect(found, 'step in list').toBeTruthy();
      expect(found.value_kind).toBe('PERCENT');

      // UPDATE — change the label + widen the band.
      const putRes = await request.put(`/api/sku-catalog/${cat.id}/qc-checks`, {
        data: { checkId, stepLabel: 'Battery health (min 75%)', passMin: 75 },
      });
      expect(putRes.status(), 'update step').toBe(200);
      const updated = await putRes.json();
      expect(updated.check.step_label).toBe('Battery health (min 75%)');
      expect(Number(updated.check.pass_min)).toBe(75);

      // PUBLISH TOGGLE — status-only edit (audited as qc_check.publish).
      const unpub = await request.put(`/api/sku-catalog/${cat.id}/qc-checks`, {
        data: { checkId, status: 'draft' },
      });
      expect(unpub.status()).toBe(200);
      expect((await unpub.json()).check.status).toBe('draft');

      // DELETE
      const delRes = await request.delete(`/api/sku-catalog/${cat.id}/qc-checks`, {
        data: { checkId },
      });
      expect(delRes.status()).toBe(200);
      expect((await delRes.json()).deleted).toBe(true);

      // Confirm gone.
      const after = await request.get(`/api/sku-catalog/${cat.id}/qc-checks`);
      const stillThere = ((await after.json()).checks ?? []).some((c: any) => c.id === checkId);
      expect(stillThere).toBe(false);
    } finally {
      await request.delete(`/api/sku-catalog/${cat.id}`);
    }
  });

  test('ENUM step round-trips its value_enum list', async ({ request }) => {
    const cat = await makeCatalog(request);
    try {
      const res = await request.post(`/api/sku-catalog/${cat.id}/qc-checks`, {
        data: { stepLabel: 'Cosmetic grade', valueKind: 'ENUM', valueEnum: ['A', 'B', 'C'] },
      });
      expect(res.status()).toBe(201);
      const check = (await res.json()).check;
      expect(check.value_kind).toBe('ENUM');
      expect(check.value_enum).toEqual(['A', 'B', 'C']);
    } finally {
      await request.delete(`/api/sku-catalog/${cat.id}`);
    }
  });

  test('?publishedOnly=1 hides draft steps; default view shows them', async ({ request }) => {
    const cat = await makeCatalog(request);
    try {
      const pub = await request.post(`/api/sku-catalog/${cat.id}/qc-checks`, {
        data: { stepLabel: 'published step', status: 'published' },
      });
      const draft = await request.post(`/api/sku-catalog/${cat.id}/qc-checks`, {
        data: { stepLabel: 'draft step', status: 'draft' },
      });
      const pubId = (await pub.json()).check.id;
      const draftId = (await draft.json()).check.id;

      const allRes = await request.get(`/api/sku-catalog/${cat.id}/qc-checks`);
      const allIds = ((await allRes.json()).checks ?? []).map((c: any) => c.id);
      expect(allIds).toContain(pubId);
      expect(allIds).toContain(draftId);

      const pubOnly = await request.get(`/api/sku-catalog/${cat.id}/qc-checks?publishedOnly=1`);
      const pubIds = ((await pubOnly.json()).checks ?? []).map((c: any) => c.id);
      expect(pubIds).toContain(pubId);
      expect(pubIds).not.toContain(draftId);
    } finally {
      await request.delete(`/api/sku-catalog/${cat.id}`);
    }
  });

  test('Idempotency-Key replays the create instead of duplicating', async ({ request }) => {
    const cat = await makeCatalog(request);
    try {
      const key = `idem-${uniq()}`;
      const opts = {
        headers: { 'Idempotency-Key': key },
        data: { stepLabel: 'idempotent step' },
      };
      const first = await request.post(`/api/sku-catalog/${cat.id}/qc-checks`, opts);
      const second = await request.post(`/api/sku-catalog/${cat.id}/qc-checks`, opts);
      expect(first.status()).toBe(201);
      expect(second.status()).toBe(201);
      const firstId = (await first.json()).check.id;
      const secondId = (await second.json()).check.id;
      expect(secondId).toBe(firstId);

      // Exactly one row exists for that label.
      const listRes = await request.get(`/api/sku-catalog/${cat.id}/qc-checks`);
      const matches = ((await listRes.json()).checks ?? []).filter(
        (c: any) => c.step_label === 'idempotent step',
      );
      expect(matches.length).toBe(1);
    } finally {
      await request.delete(`/api/sku-catalog/${cat.id}`);
    }
  });

  test('validation: bad bodies → 400 INVALID_BODY', async ({ request }) => {
    const cat = await makeCatalog(request);
    try {
      // missing stepLabel
      const a = await request.post(`/api/sku-catalog/${cat.id}/qc-checks`, { data: {} });
      expect(a.status()).toBe(400);
      expect((await a.json()).error).toBe('INVALID_BODY');

      // passMin > passMax
      const b = await request.post(`/api/sku-catalog/${cat.id}/qc-checks`, {
        data: { stepLabel: 'bad band', passMin: 100, passMax: 1 },
      });
      expect(b.status()).toBe(400);

      // valueEnum without ENUM kind
      const c = await request.post(`/api/sku-catalog/${cat.id}/qc-checks`, {
        data: { stepLabel: 'bad enum', valueKind: 'NUMBER', valueEnum: ['x'] },
      });
      expect(c.status()).toBe(400);
    } finally {
      await request.delete(`/api/sku-catalog/${cat.id}`);
    }
  });

  test('update of unknown checkId → 404', async ({ request }) => {
    const cat = await makeCatalog(request);
    try {
      const res = await request.put(`/api/sku-catalog/${cat.id}/qc-checks`, {
        data: { checkId: 999999999, stepLabel: 'nope' },
      });
      expect(res.status()).toBe(404);
    } finally {
      await request.delete(`/api/sku-catalog/${cat.id}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('qc-checks — tech inline authoring (receiving-lines)', () => {
  async function firstLineId(request: APIRequestContext): Promise<number | null> {
    const res = await request.get('/api/receiving-lines?view=recent&limit=10');
    if (!res.ok()) return null;
    const rows: any[] = (await res.json()).receiving_lines ?? [];
    return rows[0]?.id ?? null;
  }

  test('create → update → delete a step from the testing screen', async ({ request }) => {
    const lineId = await firstLineId(request);
    test.skip(lineId == null, 'no receiving lines in this environment');

    let checkId: number | undefined;
    try {
      const create = await request.post(`/api/receiving-lines/${lineId}/qc-checks`, {
        data: { stepLabel: `E2E tech step ${uniq()}`, valueKind: 'BOOLEAN' },
      });
      expect(create.status(), 'tech create').toBeLessThan(300);
      const cj = await create.json();
      expect(cj.ok).toBe(true);
      checkId = cj.check.id;

      const update = await request.put(`/api/receiving-lines/${lineId}/qc-checks`, {
        data: { checkId, stepLabel: 'E2E tech step (edited)' },
      });
      expect(update.status()).toBeLessThan(300);
      expect((await update.json()).check.step_label).toBe('E2E tech step (edited)');
    } finally {
      if (checkId) {
        const del = await request.delete(`/api/receiving-lines/${lineId}/qc-checks`, {
          data: { checkId },
        });
        expect(del.status()).toBeLessThan(300);
      }
    }
  });

  test('validation: missing stepLabel → 400', async ({ request }) => {
    const lineId = await firstLineId(request);
    test.skip(lineId == null, 'no receiving lines in this environment');
    const res = await request.post(`/api/receiving-lines/${lineId}/qc-checks`, { data: {} });
    expect(res.status()).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('qc-checks — per-unit execution + bulk', () => {
  /** Find an existing serial unit that already has a sku_catalog_id. */
  async function findCataloguedUnit(
    request: APIRequestContext,
  ): Promise<{ unitId: number; skuCatalogId: number } | null> {
    const listRes = await request.get('/api/inventory/units?limit=50');
    if (!listRes.ok()) return null;
    const items: any[] = (await listRes.json()).items ?? [];
    for (const it of items) {
      const detail = await request.get(`/api/serial-units/${it.id}`);
      if (!detail.ok()) continue;
      const su = (await detail.json()).serial_unit;
      if (su?.sku_catalog_id != null) {
        return { unitId: su.id, skuCatalogId: su.sku_catalog_id };
      }
    }
    return null;
  }

  test('record a value step (server derives pass/fail) + bulk settle/clear', async ({ request }) => {
    const unit = await findCataloguedUnit(request);
    test.skip(unit == null, 'no catalogued serial units in this environment');
    const { unitId, skuCatalogId } = unit!;

    const createdStepIds: number[] = [];
    try {
      // Author a PERCENT step (pass band 80..100) + a BOOLEAN step on the unit's SKU.
      const pct = await request.post(`/api/sku-catalog/${skuCatalogId}/qc-checks`, {
        data: { stepLabel: `E2E pct ${uniq()}`, valueKind: 'PERCENT', valueUnit: '%', passMin: 80, passMax: 100, status: 'published' },
      });
      expect(pct.status()).toBe(201);
      const pctStepId = (await pct.json()).check.id as number;
      createdStepIds.push(pctStepId);

      const bool = await request.post(`/api/sku-catalog/${skuCatalogId}/qc-checks`, {
        data: { stepLabel: `E2E bool ${uniq()}`, valueKind: 'BOOLEAN', status: 'published' },
      });
      expect(bool.status()).toBe(201);
      const boolStepId = (await bool.json()).check.id as number;
      createdStepIds.push(boolStepId);

      // GET checklist — our steps appear with structured config.
      const checklist = await request.get(`/api/serial-units/${unitId}/checklist`);
      expect(checklist.status()).toBe(200);
      const steps: any[] = (await checklist.json()).steps ?? [];
      const pctStep = steps.find((s) => s.step_id === pctStepId);
      expect(pctStep, 'pct step resolved for unit').toBeTruthy();
      expect(pctStep.value_kind).toBe('PERCENT');
      expect(Number(pctStep.pass_min)).toBe(80);

      // RECORD a passing value (90 ∈ [80,100]) — server derives passed=true.
      const pass = await request.post(`/api/serial-units/${unitId}/checklist`, {
        data: { stepId: pctStepId, valueNum: 90 },
      });
      expect(pass.status()).toBe(200);
      const passV = (await pass.json()).verification;
      expect(passV.passed).toBe(true);
      expect(Number(passV.value_num)).toBe(90);

      // RECORD a failing value (50 ∉ [80,100]) — server derives passed=false.
      const fail = await request.post(`/api/serial-units/${unitId}/checklist`, {
        data: { stepId: pctStepId, valueNum: 50 },
      });
      expect(fail.status()).toBe(200);
      expect((await fail.json()).verification.passed).toBe(false);

      // BOOLEAN step with passed omitted → defaults true (legacy tap-to-pass).
      const boolRec = await request.post(`/api/serial-units/${unitId}/checklist`, {
        data: { stepId: boolStepId },
      });
      expect(boolRec.status()).toBe(200);
      expect((await boolRec.json()).verification.passed).toBe(true);

      // BULK clear → removes this unit's recorded results.
      const clear = await request.post(`/api/serial-units/${unitId}/checklist/bulk`, {
        data: { action: 'clear' },
      });
      expect(clear.status()).toBe(200);
      const clearBody = await clear.json();
      expect(clearBody.ok).toBe(true);
      expect(clearBody.progress.completed).toBe(0);

      // BULK pass → settles "passable" steps (boolean / no value kind). Steps
      // that need a real measurement (PERCENT/NUMBER/ENUM/TEXT) are skipped on
      // purpose, so the band step is NOT blanket-passed. (plan §4)
      const passAll = await request.post(`/api/serial-units/${unitId}/checklist/bulk`, {
        data: { action: 'pass' },
      });
      expect(passAll.status()).toBe(200);
      const passAllBody = await passAll.json();
      expect(passAllBody.ok).toBe(true);
      expect(passAllBody.steps_affected).toBeGreaterThanOrEqual(1);

      const afterPass = await request.get(`/api/serial-units/${unitId}/checklist`);
      const afterSteps: any[] = (await afterPass.json()).steps ?? [];
      const boolAfter = afterSteps.find((s) => s.step_id === boolStepId);
      const pctAfter = afterSteps.find((s) => s.step_id === pctStepId);
      expect(boolAfter?.passed, 'boolean step bulk-passed').toBe(true);
      expect(pctAfter?.passed, 'value-input step is NOT blanket-passed by bulk').toBeNull();
    } finally {
      // Clear this unit's results first (FK), then remove the steps we authored.
      await request.post(`/api/serial-units/${unitId}/checklist/bulk`, { data: { action: 'clear' } });
      for (const id of createdStepIds) {
        await request.delete(`/api/sku-catalog/${skuCatalogId}/qc-checks`, { data: { checkId: id } });
      }
    }
  });

  test('validation: missing stepId → 400', async ({ request }) => {
    const unit = await findCataloguedUnit(request);
    test.skip(unit == null, 'no catalogued serial units in this environment');
    const res = await request.post(`/api/serial-units/${unit!.unitId}/checklist`, { data: {} });
    expect(res.status()).toBe(400);
  });
});
