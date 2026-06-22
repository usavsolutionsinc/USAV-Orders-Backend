import { test, expect } from '@playwright/test';

/**
 * Operations page overhaul smoke (P3-ADM-01).
 *
 * Drives the live /operations page read-only and asserts the three acceptance
 * pillars render in order:
 *   A. Goal-first — the "Today's goal" hero is the FIRST section (above the KPI
 *      snapshot), showing the floor-wide goal ring + units.
 *   B. Live stats — the KPI snapshot ("Numbers at a glance") + live feed render
 *      from /api/dashboard/operations (org-scoped, polled + Ably-patched).
 *   C. Agent hooks — the "Agents paired to the workflow" row lists the local
 *      agents (Hermes / Vision / Workflow engine), each deep-linking to /studio.
 *
 * Read-only: it never mutates and takes no build lock (mirrors
 * design-demo-showcase.spec.ts). Desktop project only.
 */

test.describe('Operations overhaul', () => {
  test('goal hero is first, live stats + agent hooks render', async ({ page }) => {
    test.skip(test.info().project.name === 'mobile', 'Desktop operations surface');

    await page.goto('/operations');

    // ── A. Goal-first: the goal hero ── (eyebrow is the top section)
    await expect(page.getByText("Today's goal", { exact: false }).first()).toBeVisible();

    // ── C. Agent hooks: the local-agents row + a Studio deep-link ──
    await expect(
      page.getByRole('heading', { name: /Agents paired to the workflow/i }),
    ).toBeVisible();
    for (const name of ['Hermes', 'Vision', 'Workflow engine']) {
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    }
    // At least one agent card links into the Studio graph.
    await expect(page.getByRole('link', { name: /Map in Studio/i }).first()).toBeVisible();

    // ── B. Live stats: the KPI snapshot + live feed ──
    await expect(page.getByRole('heading', { name: 'Numbers at a glance' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /What.s happening on the floor/i }),
    ).toBeVisible();

    // Goal hero is ABOVE the KPI snapshot in the DOM (goal-first ordering).
    const goalEyebrow = page.getByText("Today's goal", { exact: false }).first();
    const snapshot = page.getByRole('heading', { name: 'Numbers at a glance' });
    const order = await goalEyebrow.evaluate((goal, snap) => {
      const pos = goal.compareDocumentPosition(snap as Node);
      // DOCUMENT_POSITION_FOLLOWING (4) ⇒ snapshot comes after the goal.
      return (pos & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    }, await snapshot.elementHandle());
    expect(order, 'goal hero should precede the KPI snapshot').toBeTruthy();
  });
});
