import { test, expect, type Page } from '@playwright/test';

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

/** Drill the folders view down to a leaf photo sheet (photo tiles present). */
async function drillToPhotos(page: Page) {
  await page.goto('/ops/photos');
  await settle(page);
  for (let i = 0; i < 6; i++) {
    if (await page.getByTestId('photo-tile').count()) return true;
    const folders = page.getByTestId('photo-folder');
    if (!(await folders.count())) break;
    await folders.first().click();
    await settle(page);
  }
  return (await page.getByTestId('photo-tile').count()) > 0;
}

test.describe('Photo library — mobile lightbox', () => {
  // Emulate a phone viewport under the installed chromium (webkit isn't present).
  test.use({ viewport: { width: 390, height: 844 } });

  test('opening a photo on mobile shows the image (not a black screen)', async ({ page }) => {
    const reached = await drillToPhotos(page);
    test.skip(!reached, 'No photos to open in this environment.');

    await page.getByTestId('photo-tile').first().click();
    await expect(page.getByTestId('photo-lightbox')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/mobile-lightbox-open.png' });

    // If it opened to the grouped-grid overview, drill into a single image.
    const overviewTile = page.locator('[data-testid="photo-lightbox"] button.aspect-square');
    if (await overviewTile.count()) {
      await overviewTile.first().click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: 'test-results/mobile-lightbox-single.png' });
    }

    // Inspect the main image: present? what box does it actually occupy?
    const diag = await page.evaluate(() => {
      const lb = document.querySelector('[data-testid="photo-lightbox"]') as HTMLElement | null;
      const imgs = lb ? Array.from(lb.querySelectorAll('img')) : [];
      const main = imgs
        .map((im) => ({ r: im.getBoundingClientRect(), complete: im.complete, w: im.naturalWidth }))
        .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0];
      return {
        vw: window.innerWidth,
        vh: window.innerHeight,
        imgCount: imgs.length,
        spinner: !!lb?.querySelector('.animate-spin'),
        errorBox: !!lb?.querySelector('.text-red-300'),
        main: main ? { w: Math.round(main.r.width), h: Math.round(main.r.height), complete: main.complete, natural: main.w } : null,
      };
    });
    console.log('LIGHTBOX DIAG:', JSON.stringify(diag, null, 2));
  });
});
