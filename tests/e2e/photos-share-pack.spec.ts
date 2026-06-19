import { test, expect } from '@playwright/test';

test.describe('Photo share packs', () => {
  test('public share API returns 404 for invalid token', async ({ request }) => {
    const res = await request.get('/api/photos/share-packs/not-a-real-token');
    expect(res.status()).toBe(404);
  });

  test('public share page shows not found for invalid token', async ({ page }) => {
    await page.goto('/share/photos/not-a-real-token');
    await expect(page.getByRole('heading', { name: 'Photos unavailable' })).toBeVisible();
  });
});
