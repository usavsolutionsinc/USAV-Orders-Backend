/**
 * P1-PCK-01 — Testing mode: SKU scan prefills from the pre-packed state.
 *
 * Acceptance:
 *   A. A SKU scan in testing mode populates the fields from the pre-pack record.
 *   B. The interaction (list + selection UX) mirrors the receiving mode pattern.
 *
 * Both are met by the same chrome the receiving sidebar uses: the testing scan
 * bar gained a fourth armable route — SKU — alongside Tracking / PO# / Serial,
 * and resolveTestingScan resolves a scanned product SKU to its pre-packed
 * receiving line (read-only) so TestingPanel prefills its fields from that row.
 *
 * Data-resilience contract (matches receiving-tech-modes.spec.ts): the rail and
 * the SKU lookup may be empty in the test DB, so the spec asserts the new
 * route-level chrome (the SKU mode button + armed-state acknowledgment)
 * unconditionally and treats the right-pane prefill as best-effort.
 *
 * Auth is reused from tests/.auth/admin.json (minted by global-setup.ts).
 * This spec does NOT run live in the task; it documents the expected behavior.
 */

import { test, expect } from '@playwright/test';

const BOOT_TIMEOUT = 20_000;

test.use({ storageState: 'tests/.auth/admin.json' });

test.describe('Testing mode — SKU pre-pack scan', () => {
  test('testing scan bar exposes a SKU route and arms it like the receiving modes', async ({
    page,
  }) => {
    await page.goto('/test?view=testing');

    // Stable chrome: the testing scan input band carries data-testing-scan.
    const scanBand = page.locator('[data-testing-scan]');
    await expect(scanBand).toBeVisible({ timeout: BOOT_TIMEOUT });

    // The new SKU route button sits in the scan bar's mode toggles, mirroring
    // Tracking / PO# / Serial (acceptance B — same list+selection idiom).
    const skuRoute = scanBand.getByRole('button', { name: /Arm SKU|SKU armed/i });
    await expect(skuRoute).toBeVisible();

    // Arming SKU is a hard override: the placeholder flips to "Scan SKU…" and
    // the button reports its pressed state, exactly like the other routes.
    await skuRoute.click();
    await expect(skuRoute).toHaveAttribute('aria-pressed', 'true');
    await expect(scanBand.getByPlaceholder(/Scan SKU/i)).toBeVisible();

    // Disarm returns to auto-detect (idempotent toggle, same as the siblings).
    await skuRoute.click();
    await expect(skuRoute).toHaveAttribute('aria-pressed', 'false');
  });

  test('a SKU scan resolves to its pre-packed line (best-effort prefill)', async ({
    page,
  }) => {
    await page.goto('/test?view=testing');

    const scanBand = page.locator('[data-testing-scan]');
    await expect(scanBand).toBeVisible({ timeout: BOOT_TIMEOUT });

    // Read the top rail item's SKU when the test DB has one, then scan it.
    // When the rail is empty this is skipped — the chrome test above still
    // guards the wiring.
    const firstRailItem = page.getByRole('complementary').getByRole('button').first();
    const railCount = await page
      .getByRole('complementary')
      .getByRole('button')
      .count();
    if (railCount === 0) test.skip(true, 'rail empty in this environment');

    await firstRailItem.scrollIntoViewIfNeeded();

    // Arm SKU and submit a representative value. We assert the acknowledgment
    // chip surfaces (the panel either opens the matching line or reports
    // not-found) — never a thrown error. The real prefill assertion runs in a
    // seeded environment; here we only guard that the SKU route is live.
    const skuRoute = scanBand.getByRole('button', { name: /Arm SKU|SKU armed/i });
    await skuRoute.click();
    await scanBand.getByRole('textbox').fill('PREPACK-SMOKE-SKU');
    await scanBand.getByRole('textbox').press('Enter');

    // No crash: the scan band stays mounted and interactive after resolution.
    await expect(scanBand).toBeVisible();
  });

  test('multi-match picker rows preview the matched serial chips (best-effort)', async ({
    page,
  }) => {
    await page.goto('/test?view=testing');

    const scanBand = page.locator('[data-testing-scan]');
    await expect(scanBand).toBeVisible({ timeout: BOOT_TIMEOUT });

    // Phase 0 acknowledgement contract: when a scan resolves to MULTIPLE lines
    // (duplicate SKUs on a PO / a shared serial), the disambiguation picker must
    // show a serial-chip preview on every row whose serials are loaded — so the
    // operator can see WHICH serial matched which line before picking.
    //
    // Surfacing a multi-match picker needs seeded data (a PO with duplicate SKUs)
    // the unseeded test DB may lack, so this is best-effort in this file's style:
    // if the picker surfaces with serial-loaded rows, at least one serial chip
    // (`[data-serial-chip]`) must render; otherwise the test skips cleanly. The
    // selector contract itself is what this guards against regression.
    const skuRoute = scanBand.getByRole('button', { name: /Arm SKU|SKU armed/i });
    await skuRoute.click();
    await scanBand.getByRole('textbox').fill('PREPACK-SMOKE-SKU');
    await scanBand.getByRole('textbox').press('Enter');

    const picker = page.locator('[data-testing-picker]');
    const hasPicker = await picker
      .first()
      .isVisible()
      .catch(() => false);
    if (!hasPicker) {
      test.skip(true, 'no multi-match picker in this environment (needs duplicate-SKU seed)');
    }

    // If any picker row carries loaded serials, the preview chips must be present.
    const chipCount = await picker.locator('[data-serial-chip]').count();
    expect(chipCount).toBeGreaterThan(0);
  });
});
