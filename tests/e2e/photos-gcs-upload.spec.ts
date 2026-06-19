import { test, expect } from '@playwright/test';

/**
 * Photos platform smoke tests — require auth + GCS configured in preview.
 * Skip when PHOTOS_UPLOAD_PROVIDER=legacy in the target env.
 */
test.describe('Photos GCS platform', () => {
  test.skip(!process.env.E2E_PHOTOS_GCS, 'Set E2E_PHOTOS_GCS=1 to run photo platform E2E');

  test('photo library page loads for authenticated staff', async ({ page }) => {
    await page.goto('/ops/photos');
    await expect(page.getByRole('heading', { name: /photo library/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('share pack public route returns 404 for bogus token', async ({ request }) => {
    const res = await request.get('/api/photos/share-packs/not-a-real-token');
    expect(res.status()).toBe(404);
  });
});
