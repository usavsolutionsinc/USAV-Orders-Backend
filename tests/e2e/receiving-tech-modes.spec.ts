/**
 * Smoke tests for the three workspace mode displays that were refactored to
 * share components as part of the mode-first architecture:
 *
 *   1. Unbox mode  (/receiving)              — LineEditPanel, Print · receive bar
 *   2. Triage mode (/receiving?mode=triage)  — LineEditPanel, Save for unbox button
 *   3. Testing mode (/tech?view=testing)     — TestingPanel (shared CartonContextCard
 *                                              + LineEditToolbar) + Pass · … action
 *
 * These tests guard against regressions where the shared LineEditToolbar /
 * CartonContextCard composition breaks silently in any of the three modes.
 *
 * Auth is reused from the saved session in tests/.auth/admin.json (minted by
 * global-setup.ts). No credentials are inlined here.
 *
 * Data-resilience contract: the left rail may be empty in the test environment.
 * Each test asserts route-level chrome unconditionally; right-pane assertions
 * are gated on whether a rail item is present, so the suite is green against
 * an empty DB and still exercises the panel when data exists.
 */

import { test, expect } from '@playwright/test';

// How long to wait for the BootGate / sign-in splash to clear and the initial
// data fetch to land. The global timeout is 60 s; this is just the per-expect
// wait on the first always-present chrome element.
const BOOT_TIMEOUT = 20_000;

// After clicking a rail item, give the right-pane panel time to mount + fetch
// its data before asserting inner chrome.
const PANEL_TIMEOUT = 15_000;

test.use({ storageState: 'tests/.auth/admin.json' });

test.describe('Receiving + Tech workspace mode smoke tests', () => {
  // ── 1. UNBOX MODE (/receiving) ────────────────────────────────────────────
  test('unbox mode — page loads and right pane shows Print · receive bar when a line is present', async ({
    page,
  }) => {
    await page.goto('/receiving');

    // The split pane's <aside role="complementary"> is always rendered; it is
    // the stable chrome anchor regardless of rail data. Wait for it to appear
    // after the BootGate clears.
    const aside = page.getByRole('complementary');
    await expect(aside).toBeVisible({ timeout: BOOT_TIMEOUT });

    // No Next.js error overlay or app error boundary should be present.
    await expect(page.locator('#__next-error-overlay, [data-nextjs-error]')).toHaveCount(0);
    await expect(page.getByText('Application error')).toHaveCount(0);

    // The unbox rail toggle (a HorizontalButtonSlider = role="tablist", pills =
    // role="tab") exposes Queue · Unboxed · Viewed. "Viewed" is the per-staff
    // recents rail (receiving_line_views).
    await expect(page.getByRole('tab', { name: 'Queue' })).toBeVisible({ timeout: PANEL_TIMEOUT });
    await expect(page.getByRole('tab', { name: 'Unboxed' })).toBeVisible({ timeout: PANEL_TIMEOUT });
    const viewedPill = page.getByRole('tab', { name: 'Viewed' });
    await expect(viewedPill).toBeVisible({ timeout: PANEL_TIMEOUT });

    // Switching to "Viewed" deep-links ?unboxview=viewed (the recents rail).
    await viewedPill.click();
    await expect(page).toHaveURL(/unboxview=viewed/, { timeout: PANEL_TIMEOUT });

    // The unbox workspace auto-selects its top line, so the shared LineEditToolbar
    // mounts WITHOUT a rail click. Best-effort: when a line is present, assert the
    // right-pane chrome; tolerate an empty feed (no crash already asserted).
    const auditBtn = page.getByRole('button', { name: 'View audit log' });
    const opened = await auditBtn
      .first()
      .waitFor({ state: 'visible', timeout: PANEL_TIMEOUT })
      .then(() => true)
      .catch(() => false);

    if (!opened) {
      console.log('[unbox] No line auto-opened — route chrome + pills asserted, skipping panel.');
      return;
    }

    // CartonContextCard Platform pill + the unbox terminal action.
    await expect(page.getByRole('button', { name: /Platform/i }).first()).toBeVisible({ timeout: PANEL_TIMEOUT });
    await expect(
      page.getByRole('button', { name: /Print\s*[·•]\s*receive/i }),
    ).toBeVisible({ timeout: PANEL_TIMEOUT });
  });

  // ── 2. TRIAGE MODE (/receiving?mode=triage) ───────────────────────────────
  test('triage mode — page loads and right pane shows Save for unbox button when a line is present', async ({
    page,
  }) => {
    await page.goto('/receiving?mode=triage');

    const aside = page.getByRole('complementary');
    await expect(aside).toBeVisible({ timeout: BOOT_TIMEOUT });

    await expect(page.locator('#__next-error-overlay, [data-nextjs-error]')).toHaveCount(0);
    await expect(page.getByText('Application error')).toHaveCount(0);

    // Triage auto-selects its top line too, so the panel mounts without a click.
    // Best-effort: assert the triage-only terminal action when a line is present.
    const auditBtn = page.getByRole('button', { name: 'View audit log' });
    const opened = await auditBtn
      .first()
      .waitFor({ state: 'visible', timeout: PANEL_TIMEOUT })
      .then(() => true)
      .catch(() => false);

    if (!opened) {
      console.log('[triage] No line auto-opened — route chrome asserted, skipping panel.');
      return;
    }

    // Triage's terminal action: "Save for unbox" FloatingButton (caps.saveBar)…
    await expect(
      page.getByRole('button', { name: /Save for unbox/i }),
    ).toBeVisible({ timeout: PANEL_TIMEOUT });

    // …and the unbox-only "Print · receive" action bar must be ABSENT in triage.
    await expect(
      page.getByRole('button', { name: /Print\s*[·•]\s*receive/i }),
    ).toHaveCount(0);
  });

  // ── 3. TESTING MODE (/tech?view=testing) ─────────────────────────────────
  test('testing mode — page loads, toolbar shows audit/pair actions, and Pass · button is present when a line is open', async ({
    page,
  }) => {
    await page.goto('/tech?view=testing');

    // The DashboardSidebar wraps TechSidebarPanel — it renders an <aside> for
    // the left rail on desktop. Wait for any aside to appear.
    const aside = page.locator('aside').first();
    await expect(aside).toBeVisible({ timeout: BOOT_TIMEOUT });

    await expect(page.locator('#__next-error-overlay, [data-nextjs-error]')).toHaveCount(0);
    await expect(page.getByText('Application error')).toHaveCount(0);

    // The testing toolbar (LineEditToolbar mode="testing") exposes "View audit
    // log" and "Open SKU pairing" — assert at least one is reachable as soon
    // as the testing view activates (these live in the toolbar, not the panel).
    // We use a broad OR: the toolbar may render disabled but is always mounted.
    const auditBtn = page.getByRole('button', { name: 'View audit log' });
    const pairBtn = page.getByRole('button', { name: 'Open SKU pairing' });
    const copyBtn = page.getByRole('button', { name: 'Copy all testing details' });

    // At least one of the three testing-mode toolbar icons must be present.
    const anyToolbarIcon = auditBtn.or(pairBtn).or(copyBtn);
    await expect(anyToolbarIcon.first()).toBeVisible({ timeout: PANEL_TIMEOUT });

    // Try to open the first item in the testing rail.
    const railButtons = aside.locator('button');
    const railCount = await railButtons.count();

    if (railCount === 0) {
      console.log('[testing] No testing rail items found — skipping right-pane panel assertions.');
      return;
    }

    await railButtons.first().click();

    // The CartonContextCard is shared with receiving — Platform pill should
    // render once the TestingPanel mounts.
    await expect(
      page.getByRole('button', { name: /Platform/i }),
    ).toBeVisible({ timeout: PANEL_TIMEOUT });

    // The floating primary action in TestingPanel is always one of:
    //   "Pass · Print N× Label(s)"  — ready state
    //   "Pass · No Serial"           — no serial scanned yet
    //   "Pass · No SKU"              — SKU not linked
    //   "Printing N×…"              — printing in flight
    // All share the /^Pass\s*[·•]/ prefix except "Printing" — match both.
    const passBtn = page.getByRole('button', { name: /^Pass\s*[·•]|^Printing\s+\d+/i });
    await expect(passBtn).toBeVisible({ timeout: PANEL_TIMEOUT });
  });

  // ── 4. TESTING MODE — deterministic deep check of the rewrite ──────────────
  // Seeds the restore key with a REAL testing line so TestingLineWorkspace
  // auto-mounts TestingPanel (no flaky rail-clicking), then asserts the
  // rewritten panel composes the SHARED CartonContextCard (Platform pill) + the
  // Pass · Print StickyActionBar — i.e. the fork rewrite renders end to end.
  test('testing mode — restored line renders the rewritten TestingPanel chrome', async ({
    page,
    request,
  }) => {
    // Authed by the same storageState (the request fixture carries the cookie).
    const res = await request.get('/api/receiving-lines?view=testing&limit=1');
    const data = await res.json().catch(() => ({}));
    const line = (data.receiving_lines || [])[0];
    test.skip(!line || line.receiving_id == null, 'no openable testing line in this environment');

    // TestingLineWorkspace restores from this localStorage key on mount.
    await page.addInitScript((id) => {
      try {
        window.localStorage.setItem('usav:testing:last-line-id', String(id));
      } catch {
        /* private mode — non-fatal */
      }
    }, line.id);

    await page.goto('/tech?view=testing');

    await expect(page.locator('#__next-error-overlay, [data-nextjs-error]')).toHaveCount(0);

    // The testing toolbar only exists inside a mounted TestingPanel, so this
    // proves the restored row mounted the rewritten panel.
    await expect(
      page
        .getByRole('button', { name: 'Open SKU pairing' })
        .or(page.getByRole('button', { name: 'View audit log' }))
        .first(),
    ).toBeVisible({ timeout: PANEL_TIMEOUT });

    // Shared CartonContextCard header — proves testing reuses receiving's card.
    await expect(
      page.getByRole('button', { name: /Platform/i }),
    ).toBeVisible({ timeout: PANEL_TIMEOUT });

    // The Pass · Print StickyActionBar — the testing terminal action.
    await expect(
      page.getByRole('button', { name: /^Pass\s*[·•]|^Printing\s+\d+/i }),
    ).toBeVisible({ timeout: PANEL_TIMEOUT });
  });
});
