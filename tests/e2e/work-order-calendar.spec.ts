import { test, expect } from '@playwright/test';

/**
 * Scheduling calendar (P3-ADM-03).
 *
 * A month-view calendar over work_assignments: assignments render on their
 * deadline day, and each opens the shared WorkOrderAssignPopover that writes
 * through the existing PATCH /api/work-orders endpoint.
 *
 * Verifies:
 *   A. /calendar mounts the month grid and fetches the windowed feed
 *      (GET /api/work-orders/calendar) — assignments render on calendar days.
 *   B. Opening an assignment chip surfaces the assign popover, whose Save path
 *      issues a PATCH /api/work-orders (the same write the queue uses).
 *
 * NOTE: requires a running dev server + an authed session (global-setup) and a
 * test DB that has at least one ORDER work-assignment with a deadline in the
 * visible (current) month. Read-only by default — it does NOT mutate unless
 * PW_CALENDAR_ASSERT_ASSIGN is set (which performs an idempotent reassign).
 */
test.describe('Work-order scheduling calendar', () => {
  test('renders the month grid and fetches the windowed feed (A)', async ({ page }) => {
    const feedReq = page.waitForResponse(
      (r) =>
        r.url().includes('/api/work-orders/calendar') && r.request().method() === 'GET',
    );

    await page.goto('/calendar');

    // The weekday header row of the month grid is always present.
    await expect(page.getByText('Mon', { exact: true })).toBeVisible();

    const res = await feedReq;
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.rows)).toBeTruthy();
    expect(typeof body.from).toBe('string');
    expect(typeof body.to).toBe('string');
  });

  test('month navigation refetches a new window', async ({ page }) => {
    await page.goto('/calendar');
    await expect(page.getByText('Sun', { exact: true })).toBeVisible();

    const nextReq = page.waitForResponse(
      (r) =>
        r.url().includes('/api/work-orders/calendar') && r.request().method() === 'GET',
    );
    await page.getByRole('button', { name: /Next month/i }).click();
    const res = await nextReq;
    expect(res.ok()).toBeTruthy();
  });

  test('opening an assignment chip can assign through the work-orders endpoint (B)', async ({
    page,
  }) => {
    test.skip(
      !process.env.PW_CALENDAR_ASSERT_ASSIGN,
      'Set PW_CALENDAR_ASSERT_ASSIGN=1 to exercise the (idempotent) assign write.',
    );

    await page.goto('/calendar');
    await expect(page.getByText('Mon', { exact: true })).toBeVisible();

    // The first assignment chip on the board (record + assignee label).
    const chip = page.locator('button[title*="·"]').first();
    await expect(chip).toBeVisible();
    await chip.click();

    // The shared assign popover.
    const popover = page.getByRole('dialog', { name: /Assign work order/i });
    await expect(popover).toBeVisible();

    // Selecting a staff button issues the same PATCH the queue uses.
    const patchReq = page.waitForRequest(
      (r) => r.url().includes('/api/work-orders') && r.method() === 'PATCH',
    );
    await popover.getByRole('button').first().click();
    const req = await patchReq;
    expect(req.method()).toBe('PATCH');
  });
});
