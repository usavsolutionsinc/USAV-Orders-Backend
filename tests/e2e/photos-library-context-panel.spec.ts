import { test, expect } from '@playwright/test';

/**
 * Photo library — fullscreen viewer context panel.
 *
 * The flat library views (grid-sm/grid-lg/grid-ticket/list) open the shared
 * `PhotoViewerModal` at the clicked photo, and the viewer surfaces a right-side
 * info panel ({@link PhotoContextPanel}) with the photo's source, a deep link
 * back to that source, dimensions, uploader, and analysis verdict.
 *
 * Seed data is not guaranteed in every environment, so each test is defensive:
 * it exercises the panel only when a photo tile exists, and always asserts the
 * surface renders without uncaught errors.
 */

test.describe('Photo library · viewer context panel', () => {
  test('clicking a grid tile opens the viewer with a details panel', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // grid-sm is a flat view — tiles open the shared lightbox (not a new tab).
    await page.goto('/ops/photos?view=grid-sm');
    await expect(page.getByText(/photos? in view/i)).toBeVisible();

    const firstTile = page.getByTestId('photo-tile').first();
    if (await firstTile.count()) {
      await firstTile.click();

      const lightbox = page.getByTestId('photo-lightbox');
      await expect(lightbox).toBeVisible();

      // Library photos carry meta, so the info panel renders by default.
      const panel = page.getByTestId('photo-context-panel');
      await expect(panel).toBeVisible();

      // The Info toggle hides and re-shows the panel.
      await page.getByRole('button', { name: /hide photo details/i }).click();
      await expect(panel).toHaveCount(0);
      await page.getByRole('button', { name: /show photo details/i }).click();
      await expect(page.getByTestId('photo-context-panel')).toBeVisible();

      // Rotate must not crash the viewer.
      await page.getByRole('button', { name: /rotate/i }).click();
      await expect(lightbox).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(page.getByTestId('photo-lightbox')).toHaveCount(0);
    }

    expect(pageErrors, `Uncaught page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });

  test('the panel deep link returns to a source-scoped library view', async ({ page }) => {
    await page.goto('/ops/photos?view=grid-sm');
    await expect(page.getByText(/photos? in view/i)).toBeVisible();

    const firstTile = page.getByTestId('photo-tile').first();
    if (!(await firstTile.count())) test.skip(true, 'no photos seeded in this environment');

    await firstTile.click();
    await expect(page.getByTestId('photo-context-panel')).toBeVisible();

    // The "view all from this source" link is present only when the photo has a
    // resolvable source (PO ref or linked ticket). When present, following it
    // lands back on a filtered library that still renders the count line.
    const sourceLink = page.getByTestId('photo-context-source-link');
    if (await sourceLink.count()) {
      const href = await sourceLink.getAttribute('href');
      expect(href).toMatch(/\/ops\/photos\?/);
      await sourceLink.click();
      await expect(page).toHaveURL(/\/ops\/photos\?/);
      await expect(page.getByText(/photos? in view/i)).toBeVisible();
    }
  });

  test('grid views render a flat contact sheet and the masonry view without crashing', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // Small grid is a flat contact sheet now (Finder-style — no day-separator
    // bands); photo tiles render directly.
    await page.goto('/ops/photos?view=grid-sm');
    await expect(page.getByText(/photos? in view/i)).toBeVisible();
    if (await page.getByTestId('photo-tile').count()) {
      await expect(page.getByTestId('photo-tile').first()).toBeVisible();
    }
    // The day-separator bands are intentionally gone.
    await expect(page.locator('[data-date]')).toHaveCount(0);

    // Large grid switches to the masonry layout; must render error-free.
    await page.goto('/ops/photos?view=grid-lg');
    await expect(page.getByText(/photos? in view/i)).toBeVisible();

    expect(pageErrors, `Uncaught page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });
});
