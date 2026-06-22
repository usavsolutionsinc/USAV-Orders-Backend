import { test, expect } from '@playwright/test';

/**
 * Design-system showcase smoke (P0-DS-01).
 *
 * Loads /design-demo against the already-running dev server and asserts each
 * primitive bay renders, the DataTable rows + sticky header are present, and the
 * Popover opens with the documented a11y wiring (trigger aria-expanded toggles;
 * panel exposes role="menu"). This is the render-proof the build pass could not
 * run because the user's `next dev` holds the build lock — it drives the live
 * server read-only and never takes a lock.
 *
 * Runs on the desktop project only (the showcase is a desktop surface).
 */

test.describe('Design system showcase', () => {
  test('renders every primitive bay and the popover opens', async ({ page }) => {
    test.skip(test.info().project.name === 'mobile', 'Desktop showcase');

    await page.goto('/design-demo');

    // Page heading.
    await expect(page.getByRole('heading', { name: /Design System · Showcase/i })).toBeVisible();

    // One bay heading per primitive (rendered as <h2> uppercase trackers).
    for (const title of ['Toolbar', 'Button · Badge · Popover', 'DataTable', 'Panel', 'Timeline', 'EmptyState']) {
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    }

    // DataTable: header cells (scope="col") + at least one demo serial row.
    await expect(page.getByRole('columnheader', { name: 'Serial' })).toBeVisible();
    await expect(page.getByText('SBLINK-2425-000017')).toBeVisible();

    // Empty-state DataTable fallback also present.
    await expect(page.getByText('Nothing here yet')).toBeVisible();

    // Popover: trigger toggles aria-expanded, panel exposes role="menu".
    const trigger = page.getByRole('button', { name: 'Open popover' });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = page.getByRole('menu', { name: 'Row actions' });
    await expect(menu).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();

    // Escape (owned by AnchoredLayer) dismisses it.
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
