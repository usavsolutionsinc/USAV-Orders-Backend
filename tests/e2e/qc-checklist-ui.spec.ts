import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Browser-level full-CRUD coverage for the QC checklist *authoring* UI
 * (Products → QC view → QcChecklistSection). Proves a user can create, read,
 * update and delete QC steps — including the Phase-1 structured-value fields
 * (value kind + pass band) — entirely from the rendered frontend, and that the
 * form sends the correct payload (cross-checked via the API).
 *
 * Auth comes from tests/.auth/admin.json (global-setup signs in as an admin).
 * The throwaway SKU catalog is created + deleted via API around the UI run.
 *
 * Desktop-only — the QC authoring pane is a desktop workspace.
 */

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function makeCatalog(request: APIRequestContext) {
  const sku = `E2E-QCUI-${uniq()}`;
  const res = await request.post('/api/sku-catalog', {
    data: { sku, productTitle: 'E2E QC UI Widget', category: `E2E-QCUI-${uniq()}` },
  });
  expect(res.status()).toBe(201);
  return { id: (await res.json()).catalog.id as number };
}

test.describe('QC checklist authoring UI', () => {
  // Desktop-only workspace — skip the mobile project (iPhone 14 / WebKit).
  // Evaluated from project config, so no browser is launched for skipped runs.
  test.skip(({ browserName }) => browserName === 'webkit', 'QC authoring is a desktop workspace');

  test('create (with value band) → read → update → delete from the UI', async ({ page, request }) => {
    const { id } = await makeCatalog(request);
    try {
      await page.goto(`/products?view=qc&skuId=${id}`);

      // Empty state until we add a step.
      await expect(page.getByText('No QC steps defined yet.')).toBeVisible();

      // ── CREATE: open the form, fill label + structured value (PERCENT band) ──
      await page.getByRole('button', { name: 'Add Step' }).click();
      const label = `Battery health ${uniq()}`;
      await page.getByPlaceholder('Check step description').fill(label);
      // Second combobox is the value-kind picker (first is the category badge).
      await page.getByRole('combobox').nth(1).selectOption({ label: 'Percent (%)' });
      await page.getByPlaceholder('Pass min').fill('80');
      await page.getByPlaceholder('Pass max').fill('100');
      await page.getByRole('button', { name: 'Add Step' }).click();

      // ── READ: row renders with the label + the pass-band chip ──
      await expect(page.getByText(label)).toBeVisible();
      await expect(page.getByText('80–100 %')).toBeVisible();

      // Cross-check the form actually sent the structured payload.
      const afterCreate = await request.get(`/api/sku-catalog/${id}/qc-checks`);
      const created = ((await afterCreate.json()).checks ?? []).find((c: any) => c.step_label === label);
      expect(created, 'step persisted').toBeTruthy();
      expect(created.value_kind).toBe('PERCENT');
      expect(Number(created.pass_min)).toBe(80);
      expect(Number(created.pass_max)).toBe(100);

      // ── UPDATE: open edit, rename, save ──
      const row = page.locator('div.group', { hasText: label });
      await row.getByTitle('Edit step').click();
      const newLabel = `${label} (edited)`;
      await page.getByPlaceholder('Check step description').fill(newLabel);
      await page.getByRole('button', { name: 'Update' }).click();
      await expect(page.getByText(newLabel)).toBeVisible();

      // ── DELETE: open edit again, remove ──
      await page.locator('div.group', { hasText: newLabel }).getByTitle('Edit step').click();
      await page.getByTitle('Delete step').click();
      await expect(page.getByText(newLabel)).toHaveCount(0);
      await expect(page.getByText('No QC steps defined yet.')).toBeVisible();

      // Final cross-check: gone from the API too.
      const afterDelete = await request.get(`/api/sku-catalog/${id}/qc-checks`);
      expect(((await afterDelete.json()).checks ?? []).length).toBe(0);
    } finally {
      await request.delete(`/api/sku-catalog/${id}`);
    }
  });
});
