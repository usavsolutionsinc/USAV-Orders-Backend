import { test, expect } from '@playwright/test';

test.describe('Photo library deep links', () => {
  test('receivingId query param scopes the library', async ({ page }) => {
    await page.goto('/ops/photos?receivingId=1987');
    await expect(page.getByText('Receiving #1987').first()).toBeVisible();
    await expect(page.getByText(/photos in view/i)).toBeVisible();
    await page.getByRole('button', { name: /photo filters/i }).click();
    await expect(page.getByLabel('Receiving ID')).toHaveValue('1987');
  });

  test('serial unit filter deep link pre-fills entity fields', async ({ page }) => {
    await page.goto('/ops/photos?entityType=SERIAL_UNIT&entityId=42');
    await expect(page.getByText('Serial unit #42').first()).toBeVisible();
    await page.getByRole('button', { name: /photo filters/i }).click();
    await expect(page.getByLabel('Entity')).toHaveValue('SERIAL_UNIT');
    await expect(page.getByLabel('Entity ID')).toHaveValue('42');
  });
});
