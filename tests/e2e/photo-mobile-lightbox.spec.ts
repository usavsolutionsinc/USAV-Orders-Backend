import { test, expect, type Page } from '@playwright/test';

/**
 * Mobile lightbox regression: opening a photo on a phone must NOT show a black
 * screen. The bug was that the viewer fed full-resolution `/api/photos/:id/content`
 * URLs to the grid-overview tiles, the thumbnail strip, AND the main stage, so on
 * a slow (mobile) connection everything sat black/spinner until the full images
 * loaded. The fix uses `thumbUrl` for tiles + strip and as an instant placeholder
 * under the main image. Emulated under chromium with a phone viewport (webkit
 * isn't installed in this environment).
 */
test.use({ viewport: { width: 390, height: 844 } });

async function settle(page: Page) {
  await expect
    .poll(async () => {
      if (await page.getByTestId('photo-tile').count()) return 'leaf';
      if (await page.getByTestId('photo-folder').count()) return 'folders';
      if (await page.getByText('No photos in this view').count()) return 'empty';
      return 'loading';
    }, { timeout: 15_000 })
    .not.toBe('loading');
}

/** Largest <img> rendered inside the open lightbox, by area. */
async function largestLightboxImg(page: Page) {
  return page.evaluate(() => {
    const lb = document.querySelector('[data-testid="photo-lightbox"]');
    if (!lb) return null;
    const boxes = Array.from(lb.querySelectorAll('img')).map((im) => {
      const r = im.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    return boxes.sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? null;
  });
}

test('mobile: opening a photo shows imagery, not a black screen', async ({ page }) => {
  await page.goto('/ops/photos?dateFrom=2026-06-24&dateTo=2026-06-24');
  await settle(page);

  // Drill any PO folders down to a leaf photo sheet.
  for (let i = 0; i < 4; i++) {
    if (await page.getByTestId('photo-tile').count()) break;
    const folders = page.getByTestId('photo-folder');
    if (!(await folders.count())) break;
    const before = page.url();
    await folders.first().click();
    // Wait for the click's URL change (router.replace) to commit before
    // re-checking, so settle doesn't read the stale (pre-navigation) folders.
    await page.waitForFunction((u) => location.href !== u, before, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(400);
    await settle(page);
  }
  const tiles = page.getByTestId('photo-tile');
  test.skip(!(await tiles.count()), 'No photos for 2026-06-24 in this environment.');

  await tiles.first().click();
  const lightbox = page.getByTestId('photo-lightbox');
  await expect(lightbox).toBeVisible({ timeout: 10_000 });

  // Grid overview: thumbnails must paint (at least one real image), not black tiles.
  await expect.poll(() => lightbox.locator('img').count(), { timeout: 10_000 }).toBeGreaterThan(0);

  // Drill into a single image if we opened to the grouped-grid overview.
  const overviewTile = lightbox.locator('button.aspect-square');
  if (await overviewTile.count()) {
    await overviewTile.first().click();
  }

  // The main stage must render a real (large) image — not just the 56px strip,
  // and not a perpetual spinner on a black box.
  await expect
    .poll(async () => (await largestLightboxImg(page))?.w ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(140);
});
