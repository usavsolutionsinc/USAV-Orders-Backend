import { test, expect, type Route, type Page } from '@playwright/test';

/**
 * Testing mode — scan an unfound carton handle (R-{id}) when the carton exists
 * but has zero receiving_lines yet. Must open Package Pairing (not "Not found").
 *
 * Mirrors the unit contract in resolve-testing-scan.test.ts; all network is mocked.
 */

const UNFOUND_ID = 42;
const UNFOUND_TRACKING = '1Z999AA10123456784';
const SCAN_VALUE = `R-${UNFOUND_ID}`;

const unmatchedCartonPayload = {
  success: true,
  receiving: {
    id: UNFOUND_ID,
    tracking: UNFOUND_TRACKING,
    source: 'unmatched',
    carrier: 'UPS',
    zoho_purchaseorder_id: null,
    zoho_purchaseorder_number: null,
  },
  purchase_orders: [],
  lines: [],
  totals: { expected: 0, received: 0, lines: 0, lines_complete: 0 },
  events: [],
};

async function routeTestingShell(page: Page): Promise<void> {
  // Keep rails empty so nothing auto-selects before the scan.
  await page.route('**/api/receiving-lines**', async (route: Route) => {
    const url = route.request().url();
    if (url.includes(`receiving_id=${UNFOUND_ID}`)) {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ success: true, receiving_lines: [] }),
      });
      return;
    }
    if (url.includes('id=-42')) {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ success: false }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ success: true, receiving_lines: [] }),
    });
  });

  await page.route(`**/api/receiving/${UNFOUND_ID}`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(unmatchedCartonPayload),
    });
  });

  await page.route('**/api/receiving/unfound-queue**', (route: Route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rows: [] }),
    }),
  );

  await page.route('**/api/receiving/triage/**', (route: Route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ success: true, rows: [] }),
    }),
  );
}

test.describe('Testing mode — lineless unfound carton handle scan', () => {
  test.use({ storageState: 'tests/.auth/admin.json' });

  test('R-{id} with zero lines opens Package Pairing workspace (not Not found)', async ({
    page,
  }) => {
    await routeTestingShell(page);
    await page.goto('/test?view=testing');

    const scanBand = page.locator('[data-testing-scan]');
    await expect(scanBand).toBeVisible({ timeout: 20_000 });

    const scanInput = scanBand.getByRole('textbox');
    await scanInput.fill(SCAN_VALUE);
    await scanInput.press('Enter');

    await expect(page.getByText('Found via carton handle')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Not found', { exact: true })).toHaveCount(0);

    // Package Pairing hub from TestingPoUnboxingSection → LineMatchingSection
    await expect(page.getByText('Package Pairing').first()).toBeVisible({ timeout: 10_000 });

    // QoL: a lineless unfound carton opens on the Zoho PO tab by DEFAULT (no
    // click) — the next correct action is "Acknowledge by Zoho SKU" / link a PO.
    await expect(page.getByRole('tab', { name: 'Zoho PO', selected: true })).toBeVisible();
    // exact: the empty-state callout below also contains the phrase "Acknowledge
    // by Zoho SKU", so match only the ZohoPoPairTab eyebrow heading.
    await expect(page.getByText('Acknowledge by Zoho SKU', { exact: true })).toBeVisible();

    // QoL: empty-carton teaching callout above the items surface.
    await expect(page.getByText('No items yet', { exact: true })).toBeVisible();

    // QoL: one-tap escape hatch to the Unbox station (photos / receive). Assert
    // presence only — clicking would client-nav to /unbox and pull in unmocked
    // routes, which would make this hermetic spec flaky.
    await expect(page.getByText('Open in unbox')).toBeVisible();

    // Unfound carton context — the carton is identified as an "Unfound PO"
    // (header + rail both label it; assert the first occurrence is visible).
    await expect(page.getByText('Unfound PO').first()).toBeVisible();
  });

  test('R-{id} with missing carton still shows Not found', async ({ page }) => {
    const MISSING_ID = 999;
    await page.route('**/api/receiving-lines**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ success: true, receiving_lines: [] }),
      });
    });
    await page.route(`**/api/receiving/${MISSING_ID}`, async (route: Route) => {
      await route.fulfill({
        status: 404,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Package not found' }),
      });
    });

    await page.goto('/test?view=testing');
    const scanBand = page.locator('[data-testing-scan]');
    await expect(scanBand).toBeVisible({ timeout: 20_000 });

    const scanInput = scanBand.getByRole('textbox');
    await scanInput.fill(`R-${MISSING_ID}`);
    await scanInput.press('Enter');

    await expect(page.getByText('Not found', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Package Pairing')).toHaveCount(0);
  });
});
