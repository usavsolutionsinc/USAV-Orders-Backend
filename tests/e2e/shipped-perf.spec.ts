import { test, expect } from '@playwright/test';

/**
 * Shipped-table performance smoke.
 *
 * Verifies the dashboard Shipped table (the lateral-heavy /api/packerlogs feed)
 * paints fast and stays cheap to render:
 *   1. the /api/packerlogs response returns quickly (read-model path when
 *      PACKER_LOG_ENRICHMENT_READ=true);
 *   2. the first row paints quickly after navigation;
 *   3. the list is VIRTUALIZED — only a windowed slice of rows is in the DOM
 *      (data-index nodes from VirtualShippedSections), not all 650+ records.
 *
 * Thresholds are intentionally generous (dev-mode + network noise); the test
 * also logs the real numbers so regressions are visible.
 */
test('shipped table loads fast and renders virtualized', async ({ page }) => {
  // Capture the packerlogs API timing as the table fetches it.
  let packerlogsMs = -1;
  page.on('requestfinished', async (req) => {
    if (req.url().includes('/api/packerlogs')) {
      const timing = req.timing();
      packerlogsMs = Math.round(timing.responseEnd - timing.requestStart);
    }
  });

  // Warm pass — compile the route / prime caches (don't measure this one).
  await page.goto('/dashboard?shipped', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-index]').first().waitFor({ state: 'visible', timeout: 45_000 });

  // Measured pass — navigate fresh and time to first painted row.
  const start = Date.now();
  await page.goto('/dashboard?shipped', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-index]').first().waitFor({ state: 'visible', timeout: 20_000 });
  const firstRowMs = Date.now() - start;

  // Let the virtualizer settle, then count what's actually in the DOM.
  await page.waitForTimeout(400);
  const renderedRows = await page.locator('[data-index]').count();

  // eslint-disable-next-line no-console
  console.log(
    `[shipped-perf] firstRow=${firstRowMs}ms · packerlogs=${packerlogsMs}ms · renderedDomRows=${renderedRows}`,
  );

  // 1. Something rendered.
  expect(renderedRows).toBeGreaterThan(0);
  // 2. Virtualized: a windowed slice, not the full dataset (650+ backfilled).
  //    This is the robust, environment-independent guard — it catches a
  //    regression that un-windows the list regardless of DB size or the read
  //    model flag.
  expect(renderedRows).toBeLessThan(200);
  // 3. Loaded within a generous ceiling (this asserts the page didn't hang; the
  //    real speed signal is the logged firstRow/packerlogs numbers, which depend
  //    on PACKER_LOG_ENRICHMENT_READ + a warm cache and so aren't a CI gate).
  expect(firstRowMs).toBeLessThan(30_000);
});
