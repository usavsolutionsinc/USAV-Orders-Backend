import { test, expect, type Page } from '@playwright/test';

/**
 * Photo-library date-folder drill (regression: "week → Years").
 *
 * The folders view is a Year → Month → Week → Day → PO# drill driven by the
 * active URL date filter (the same state the bottom breadcrumb reads). The bug
 * this guards: when a week range is the active filter, the grid rendered the
 * top-level **Years** tiles instead of that week's **Day** folders — the drill
 * level and the date filter were desynced.
 *
 * Runs read-only against the already-running dev server (desktop project).
 */

const LEVEL = 'folder-level';
const TILE = 'photo-folder';

async function readLevel(page: Page): Promise<string | null> {
  const el = page.getByTestId(LEVEL);
  // The eyebrow CSS uppercases the label, so innerText renders e.g. "MONTHS".
  if (await el.count()) return (await el.first().innerText()).trim().toUpperCase();
  return null;
}

/** Settle the folders grid: a level eyebrow, a leaf contact sheet, or empty. */
async function waitForFolders(page: Page) {
  await expect
    .poll(async () => {
      if (await page.getByTestId(LEVEL).count()) return 'level';
      if (await page.getByText('No photos in this view').count()) return 'empty';
      if (await page.getByTestId('photo-tile').count()) return 'leaf';
      return 'loading';
    }, { timeout: 15_000 })
    .not.toBe('loading');
}

test.describe('Photo library — date-folder drill', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Desktop surface');

  test('drilling Year → Month → Week shows that week\'s Days, never Years', async ({ page }) => {
    await page.goto('/ops/photos');
    await waitForFolders(page);

    const rootLevel = await readLevel(page);
    test.skip(rootLevel === null, 'No photos in this environment — cannot exercise the drill.');
    expect(rootLevel, 'root level is Years').toBe('YEARS');
    await page.screenshot({ path: 'test-results/photos-01-years.png', fullPage: true });

    // Drill one tile at a time, asserting the level descends correctly. The
    // critical step is Week → Days (the regression): it must NOT bounce to Years.
    const descent = ['MONTHS', 'WEEKS', 'DAYS'];
    for (const expected of descent) {
      const tiles = page.getByTestId(TILE);
      if (!(await tiles.count())) {
        test.skip(true, `No ${expected} tiles to drill into (sparse data).`);
      }
      await tiles.first().click();
      await waitForFolders(page);
      await expect
        .poll(() => readLevel(page), { timeout: 15_000 })
        .toBe(expected);
      // The bug surfaced as a Years bounce at the Week→Days step.
      expect(await readLevel(page), `level after drilling to ${expected}`).not.toBe('YEARS');
      await page.screenshot({ path: `test-results/photos-${expected.toLowerCase()}.png`, fullPage: true });
    }

    // A week range must be in the URL now (Mon–Sun span).
    const url = new URL(page.url());
    expect(url.searchParams.get('dateFrom'), 'week range in URL').toBeTruthy();
    expect(url.searchParams.get('dateTo')).toBeTruthy();
  });

  test('deep-linking a week range renders Days, not Years (no desync on reload)', async ({ page }) => {
    // First reach a week via the drill to capture a real, populated week range.
    await page.goto('/ops/photos');
    await waitForFolders(page);
    test.skip((await readLevel(page)) === null, 'No photos in this environment.');

    for (const expected of ['MONTHS', 'WEEKS']) {
      const tiles = page.getByTestId(TILE);
      if (!(await tiles.count())) test.skip(true, `No ${expected} tiles (sparse data).`);
      await tiles.first().click();
      await waitForFolders(page);
      await expect.poll(() => readLevel(page), { timeout: 15_000 }).toBe(expected);
    }

    // Click a week → URL becomes a week range, level becomes Days.
    const weekTiles = page.getByTestId(TILE);
    if (!(await weekTiles.count())) test.skip(true, 'No week tiles (sparse data).');
    await weekTiles.first().click();
    await waitForFolders(page);
    await expect.poll(() => readLevel(page), { timeout: 15_000 }).toBe('DAYS');

    const weekUrl = page.url();
    expect(new URL(weekUrl).searchParams.get('dateFrom')).toBeTruthy();

    // Hard reload at the week-range URL — the drill must rehydrate to Days from
    // the filter alone (the regression: it rehydrated to Years).
    await page.goto(weekUrl);
    await waitForFolders(page);
    await expect.poll(() => readLevel(page), { timeout: 15_000 }).toBe('DAYS');
    expect(await readLevel(page), 'deep-linked week level').not.toBe('YEARS');
  });
});
