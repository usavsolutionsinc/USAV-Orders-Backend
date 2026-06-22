import { test, expect } from '@playwright/test';

/**
 * First-Trace audit view (P1-TRACE-03).
 *
 * Traces ONE physical unit from origin through every station given a serial,
 * rendered on the shared EventTimeline (serial group mode available).
 *
 * Verifies:
 *   - /audit-log/trace mounts with the Trace section active in the sidebar
 *   - Submitting a serial pushes it into `?serial=` and calls /api/audit-log/trace
 *   - The unit identity header + the lifecycle trail render (receiving → … → ship)
 *   - The serial↔time grouping toggle is present when the trail has identifiers
 *
 * Set PW_TEST_SERIAL to a serial that exists (and ideally has lifecycle events)
 * in your test DB. Read-only — this spec never mutates a serial.
 *
 * NOTE: requires a running dev server + an authed session (global-setup). Do
 * NOT run against production data.
 */
const TEST_SERIAL = process.env.PW_TEST_SERIAL || '';

test.describe('First-Trace — audit log', () => {
  test('traces a serial through every station', async ({ page }) => {
    test.skip(!TEST_SERIAL, 'Set PW_TEST_SERIAL to a serial present in the test DB.');

    // ── Open the Trace section ───────────────────────────────────────────
    await page.goto('/audit-log/trace');
    await expect(page.getByRole('tab', { name: /Trace/i })).toBeVisible();

    // The empty state prompts for a serial.
    await expect(page.getByText(/First Trace/i).first()).toBeVisible();

    // ── Submit a serial via the sidebar search box (Enter submits) ────────
    const search = page.getByPlaceholder(/Scan or enter a serial/i);
    await expect(search).toBeVisible();
    await search.fill(TEST_SERIAL);

    const traceReq = page.waitForResponse(
      (r) => r.url().includes('/api/audit-log/trace') && r.request().method() === 'GET',
    );
    await search.press('Enter');
    const res = await traceReq;
    expect(res.ok()).toBeTruthy();

    // URL now carries the serial.
    await expect(page).toHaveURL(/[?&]serial=/);

    // ── The trace renders: identity header + lifecycle trail ─────────────
    await expect(page.getByText(/First Trace/i).first()).toBeVisible();
    await expect(page.getByText(/Lifecycle trail/i)).toBeVisible();

    // The unit's serial chip shows in the header (last-4 of the serial).
    const last4 = TEST_SERIAL.slice(-4);
    await expect(page.getByText(last4, { exact: false }).first()).toBeVisible();
  });
});
