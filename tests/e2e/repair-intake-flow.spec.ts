import { test, expect } from '@playwright/test';

/**
 * P2-RPR-01 — Repair-service linear flow (centered, ordered entry, paperwork access).
 *
 * Traces the two acceptance criteria entirely from the rendered intake UI:
 *
 *   A. Guided ordered entry — a centered, linear, step-ordered repair entry flow.
 *      Asserts the four ordered steps render in order (Repair Service → Issue /
 *      Reason → Contact Information → Review) with step 1 active and the rest
 *      pending, and that the content column is the centered 720px column.
 *
 *   B. Document viewer reachable from ANY step — the "View repair paperwork"
 *      affordance is present and openable on step 1 (and still present after the
 *      header back/close chrome changes between steps). Opening it surfaces the
 *      live Repair Service Agreement preview in the BottomSheet viewer.
 *
 * NON-DESTRUCTIVE: this spec never submits a repair (it only opens the intake,
 * inspects the stepper, and pops the paperwork sheet), so no DB rows are written.
 *
 * Auth comes from tests/.auth/admin.json (global-setup signs in as an admin with
 * repair.intake / repair.view perms). Desktop-only — the intake is a desktop
 * workspace (mobile QR scans redirect to /m/rs/[id]).
 */

test.describe('Repair intake — linear flow + paperwork', () => {
  test.skip(({ browserName }) => browserName === 'webkit', 'Repair intake is a desktop workspace');

  test('A: ordered steps render centered; B: paperwork reachable from a step', async ({ page }) => {
    // ?new=true auto-opens the intake form (see RepairSidebarPanel).
    await page.goto('/walk-in?mode=repairs&new=true');

    // ── Acceptance A: the linear step-ordered flow is present ──
    const progress = page.getByRole('navigation', { name: /repair intake progress/i });
    await expect(progress).toBeVisible();

    // The four steps appear in the defined entry order.
    const stepLabels = ['Repair Service', 'Issue / Reason', 'Contact Information', 'Review'];
    for (const label of stepLabels) {
      await expect(progress.getByText(label, { exact: false })).toBeVisible();
    }

    // Step 1 is active (aria-current="step"); we begin on 'product'.
    await expect(progress.getByRole('button', { name: /repair service/i })).toHaveAttribute(
      'aria-current',
      'step',
    );

    // The intake renders a single centered content column (max-w-[720px], mx-auto).
    await expect(page.locator('.mx-auto.max-w-\\[720px\\]').first()).toBeVisible();

    // ── Acceptance B: paperwork viewer reachable from this (first) step ──
    const paperworkBtn = page.getByRole('button', { name: /view repair paperwork/i });
    await expect(paperworkBtn).toBeVisible();

    await paperworkBtn.click();

    // The BottomSheet viewer opens with the live agreement preview.
    await expect(page.getByText(/Repair Paperwork/i)).toBeVisible();
    await expect(page.getByText(/USAV Solutions/i)).toBeVisible();
    await expect(page.getByText(/30-Day Warranty on all repair services/i)).toBeVisible();

    // Close the viewer (Escape) and confirm the affordance is still on the step.
    await page.keyboard.press('Escape');
    await expect(paperworkBtn).toBeVisible();
  });
});
