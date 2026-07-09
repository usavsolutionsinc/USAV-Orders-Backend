import { test, expect, type Page } from '@playwright/test';

/**
 * Per-staff configurable table columns — the shared ChipColumns / RowMetaColumns
 * primitive + TableColumnConfigProvider + ColumnConfigButton, wired across the
 * five list tables (receiving / orders / shipped / tech / packer).
 *
 * Proves the architecture end-to-end on the real app:
 *   1. The "Columns" popover opens and is FULLY INSIDE the viewport (the bug this
 *      replaces: an `absolute right-0` panel rendered off-screen behind the
 *      sidebar). It now portals to <body> and clamps to the viewport.
 *   2. Toggling a column actually hides its cells in the DOM (`[data-col=…]`),
 *      and toggling it back restores them.
 *   3. The hidden choice persists across a reload (server-backed staff_preferences).
 *
 * Non-destructive: each test restores the column to visible at the end, so the
 * signed-in staffer's prefs are left clean. Pages with an empty current week
 * (no rows → no `[data-col]` cells) skip the hide/show assertions but still
 * verify the popover geometry.
 */

const SETTLE = 250;

/** Resolve once the background staff-preferences PUT has persisted server-side. */
function waitForPersist(page: Page) {
  return page.waitForResponse(
    (r) =>
      r.url().includes('/api/staff-preferences') &&
      r.request().method() === 'PUT' &&
      r.ok(),
    { timeout: 10_000,
    },
  );
}

/**
 * Drive the `condition` toggle to an explicit shown/hidden state, awaiting the
 * persist so the test never depends on prior state and never races a reload.
 * Returns true if it actually toggled.
 */
async function setConditionShown(page: Page, panel: ReturnType<Page['getByTestId']>, shown: boolean) {
  const toggle = panel.getByTestId('column-toggle-condition');
  const isChecked = (await toggle.getAttribute('aria-checked')) === 'true';
  if (isChecked === shown) return false;
  const persisted = waitForPersist(page);
  await toggle.click();
  await persisted;
  await page.waitForTimeout(SETTLE);
  return true;
}

/**
 * The visible Columns trigger. Several tables (e.g. receiving) keep an inactive
 * copy mounted at `display:none` (the workbench display-toggle pattern), so a
 * plain `.first()` can resolve a hidden instance — target `:visible`.
 */
function visibleTrigger(page: Page) {
  return page.locator('[data-testid="column-config-trigger"]:visible').first();
}

/** Open the Columns popover and assert it is fully within the viewport. */
async function openPanelAndAssertOnScreen(page: Page) {
  const trigger = visibleTrigger(page);
  await expect(trigger, 'Columns trigger should be present in the table header').toBeVisible({
    timeout: 20_000,
  });
  await trigger.click();

  const panel = page.getByTestId('column-config-panel');
  await expect(panel).toBeVisible();

  const box = await panel.boundingBox();
  const vp = page.viewportSize();
  expect(box, 'panel should have a layout box').not.toBeNull();
  if (box && vp) {
    // The whole panel must sit inside the viewport — the regression rendered it
    // at a negative / clipped x behind the sidebar.
    expect(box.x, 'panel left edge in-viewport').toBeGreaterThanOrEqual(0);
    expect(box.y, 'panel top edge in-viewport').toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, 'panel right edge in-viewport').toBeLessThanOrEqual(vp.width + 1);
  }
  return panel;
}

/**
 * Full round-trip for one table page: open popover (geometry-checked), hide the
 * `condition` column, assert its cells vanish, reload + assert it stays hidden,
 * then restore it.
 */
async function exerciseColumnConfig(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle').catch(() => {});

  let panel = await openPanelAndAssertOnScreen(page);

  // Scope to the ACTIVE table body. Receiving keeps inactive tables mounted at
  // display:none and the sidebar rail also renders condition cells — only the
  // visible table body is under this provider, so count within it.
  const conditionCells = page
    .locator('[data-testid="column-table-body"]:visible')
    .locator('[data-col="condition"]');

  // Normalize the baseline: condition SHOWN (independent of any prior run state).
  await setConditionShown(page, panel, true);
  const before = await conditionCells.count();

  // Hide it (awaits the persist so the reload below can't race the PUT).
  await setConditionShown(page, panel, false);
  if (before > 0) {
    await expect(conditionCells, 'condition cells hidden after toggle off').toHaveCount(0);
  }

  // Persistence: the hidden choice must survive a reload.
  await page.reload();
  await page.waitForLoadState('networkidle').catch(() => {});
  await visibleTrigger(page).click();
  panel = page.getByTestId('column-config-panel');
  await expect(panel).toBeVisible();
  await expect(
    panel.getByTestId('column-toggle-condition'),
    'condition stays hidden across reload',
  ).toHaveAttribute('aria-checked', 'false');
  if (before > 0) {
    await expect(conditionCells, 'condition still hidden after reload').toHaveCount(0);
  }

  // Restore (leave prefs clean) and assert the cells come back.
  await setConditionShown(page, panel, true);
  await expect(
    panel.getByTestId('column-toggle-condition'),
  ).toHaveAttribute('aria-checked', 'true');
  if (before > 0) {
    await expect(conditionCells.first(), 'condition cells restored').toBeVisible({ timeout: 10_000 });
  }
}

test.describe('Configurable table columns (shared primitive)', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'UI test — run on the desktop chromium project',
  );

  test('Receiving lines table', async ({ page }) => {
    // History mode is the table-only receiving view whose WeekHeader hosts the
    // Columns control (triage/unbox keep the table mounted but display:none).
    await exerciseColumnConfig(page, '/receiving/history');
  });

  test('Dashboard unshipped board (status lanes)', async ({ page }) => {
    // Shelf-board layout hosts the Columns control in the top header band; each
    // lane embeds a mini OrdersQueueTable that honors the shared hidden-key set.
    await exerciseColumnConfig(page, '/dashboard?layout=board');
  });

  test('Dashboard unshipped dense table', async ({ page }) => {
    // Dense table mode exposes the WeekHeader Columns control.
    await exerciseColumnConfig(page, '/dashboard?layout=table');
  });

  test('Tech station table', async ({ page }) => {
    await page.goto('/test');
    await page.waitForLoadState('networkidle').catch(() => {});
    const trigger = visibleTrigger(page);
    // Tech/packer right panes can require a staff selection first; if the table
    // isn't shown, this surface has nothing to configure — skip rather than fail.
    if (!(await trigger.isVisible().catch(() => false))) {
      test.skip(true, 'Tech table not visible without a staff selection in this session.');
    }
    await openPanelAndAssertOnScreen(page);
  });

  test('Packer station table', async ({ page }) => {
    await page.goto('/pack');
    await page.waitForLoadState('networkidle').catch(() => {});
    const trigger = visibleTrigger(page);
    if (!(await trigger.isVisible().catch(() => false))) {
      test.skip(true, 'Packer table not visible without a staff selection in this session.');
    }
    await openPanelAndAssertOnScreen(page);
  });
});
