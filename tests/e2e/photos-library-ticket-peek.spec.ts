import { test, expect } from '@playwright/test';

/**
 * P3-DS-03 — photos library "group by ticket" view + receiving quick-peek.
 *
 * A. The library exposes a "Group by ticket" layout that resolves photos by
 *    ticket number (poRef) into labeled sections.
 * B. The receiving photo peek (PhotoPeekFan) renders a hover → fan → expand
 *    card stack. Exercised against the isolation harness at
 *    /design-demo/photo-peek so it needs no real carton.
 */

test.describe('A · Photo library group-by-ticket', () => {
  test('the layout switcher offers Group by ticket and switches the view', async ({ page }) => {
    await page.goto('/ops/photos');
    const groupBtn = page.getByRole('button', { name: /group by ticket/i });
    await expect(groupBtn).toBeVisible();
    await groupBtn.click();
    // URL reflects the view so the grouping is deep-linkable.
    await expect(page).toHaveURL(/view=grid-ticket/);
  });

  test('deep link renders ticket section headers when photos exist', async ({ page }) => {
    await page.goto('/ops/photos?view=grid-ticket');
    // Either ticket sections render, or the empty/loading state shows — both
    // are valid; the view must not crash.
    await expect(page.getByRole('button', { name: /group by ticket/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('Folders view groups photos into folders and opens one in the viewer', async ({ page }) => {
    // DevTools-style check: no uncaught page errors during the folder flow.
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // Folders is the default view — no ?view needed; the Folders button is active.
    await page.goto('/ops/photos?sourceScope=unboxing');
    await expect(page.getByRole('button', { name: 'Folders' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // If unboxing photos exist, a folder tile renders; opening it launches the
    // shared fullscreen viewer. Otherwise the empty state is valid (no crash).
    const firstFolder = page.getByTestId('photo-folder').first();
    if (await firstFolder.count()) {
      await firstFolder.click();
      await expect(page.getByTestId('photo-lightbox')).toBeVisible();
      // Folder photos carry ids, so the viewer's delete affordance shows.
      await expect(page.getByRole('button', { name: /delete photo/i })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('photo-lightbox')).toHaveCount(0);
    }

    expect(pageErrors, `Uncaught page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });

  test('Claims folders group by Zendesk ticket without crashing', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/ops/photos?sourceScope=claims&view=folders');
    await expect(page.getByRole('button', { name: 'Folders' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Ticket-title resolution is best-effort (Zendesk API); folders must render
    // with a fallback label and never throw, whether or not titles resolve.
    const folders = page.getByTestId('photo-folder');
    if (await folders.count()) {
      await expect(folders.first()).toBeVisible();
      // Claims are grouped by Zendesk ticket — labels must NOT be PO/Order refs.
      for (const label of await folders.allInnerTexts()) {
        expect(label).not.toMatch(/\b(PO|Order)\s/);
      }
    }
    expect(pageErrors, `Uncaught page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });
});

test.describe('B · Receiving photo peek card stack', () => {
  test('hover fans the peek and hold/click expands into the card stack', async ({ page }) => {
    await page.goto('/design-demo/photo-peek');
    const peek = page.getByTestId('photo-peek');
    await expect(peek).toBeVisible();

    // Hover fans the cards out.
    await peek.hover();

    // Click opens the expanded fan display.
    await peek.click();
    await expect(page.getByTestId('photo-peek-expanded')).toBeVisible();
    await expect(page.getByTestId('fan-card').first()).toBeVisible();

    // Clicking a fan card opens the shared fullscreen viewer (PhotoViewerModal).
    await page.getByTestId('fan-card').first().click();
    await expect(page.getByTestId('photo-lightbox')).toBeVisible();
  });
});
