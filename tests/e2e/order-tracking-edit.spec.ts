import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

/**
 * Edit Order Details modal — tracking add/delete (desktop project).
 *
 * Drives the real "Edit Order Details" popover in the Shipped details panel:
 * opens an order, ADDS a demo tracking number through the UI, saves, then
 * DELETES it through the UI and saves. The "two equal attachments" model means
 * the save sends the full desired set (`PATCH /api/orders/[id]/tracking`
 * { setTrackingNumbers }) and the server reconciles links — this is the flow
 * whose primary-delete collision used to fail.
 *
 * Authoritative verification is read back from the API (DB truth); the modal is
 * also re-opened each time to confirm the UI reflects the change. The test is
 * self-contained: it adds-then-deletes (net zero) and a `finally` restores the
 * original tracking set even if it fails mid-way, so it never corrupts the row.
 *
 * Env:
 *   PW_TRACKING_ORDER_ID – non-FBA shipped order id with >=1 tracking (default 2902)
 */

const ORDER_ID = Number(process.env.PW_TRACKING_ORDER_ID || '2902');
const DEMO = `E2EDEMO${Date.now()}`;

/** Deduped tracking strings for the order, straight from the DB via the API. */
async function readTracking(request: APIRequestContext): Promise<string[]> {
  const res = await request.get(`/api/orders?orderId=${ORDER_ID}&includeShipped=true`);
  expect(res.ok(), `orders read failed (${res.status()})`).toBeTruthy();
  const json = JSON.parse(await res.text());
  const rows = (json.orders?.[0]?.tracking_number_rows || []) as Array<{ tracking?: string }>;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const t = String(row.tracking || '').trim();
    if (!t || seen.has(t.toUpperCase())) continue;
    seen.add(t.toUpperCase());
    out.push(t);
  }
  return out;
}

const trackingInputs = (page: Page) => page.getByPlaceholder(/^Tracking Number \d+$/);

/**
 * Reload the panel with FRESH server data. The dashboard restores the open
 * order from a `sessionStorage` snapshot that survives reloads, so we drop it
 * first to force `fetchDashboardOrderRowById` to re-resolve from the API.
 */
async function reloadFresh(page: Page) {
  await page.evaluate(() => {
    try {
      window.sessionStorage.removeItem('dashboard:selected-order:v2');
    } catch {
      /* ignore */
    }
  });
  await page.reload();
}

async function openModal(page: Page) {
  const editBtn = page.getByRole('button', { name: 'Edit shipping information' });
  await editBtn.first().waitFor({ state: 'visible', timeout: 20_000 });
  await editBtn.first().click();
  await expect(page.getByRole('heading', { name: 'Edit Order Details' })).toBeVisible();
}

async function saveModal(page: Page) {
  await page.getByRole('button', { name: 'Save Changes' }).click();
  // On success the modal flips to "Saved" then closes; on failure it stays open
  // with an inline error (which would make this assertion — correctly — fail).
  await expect(page.getByRole('heading', { name: 'Edit Order Details' })).toBeHidden({
    timeout: 20_000,
  });
}

async function modalTrackingValues(page: Page): Promise<string[]> {
  return trackingInputs(page).evaluateAll((els) =>
    els.map((e) => (e as HTMLInputElement).value.trim()),
  );
}

test.describe('Edit Order Details — tracking', () => {
  test('add a demo tracking number via the UI, then delete it', async ({ page, request }) => {
    test.skip(test.info().project.name === 'mobile', 'desktop modal flow');

    const original = await readTracking(request);
    expect(original.length, 'fixture order must start with >=1 tracking number').toBeGreaterThan(0);
    expect(original, 'demo value must not already be present').not.toContain(DEMO);

    await page.goto(`/dashboard?shipped&openOrderId=${ORDER_ID}`);

    try {
      // ── ADD via the UI ────────────────────────────────────────────────
      await openModal(page);
      const startCount = await trackingInputs(page).count();
      expect(startCount, 'modal should seed the existing tracking rows').toBe(original.length);

      await page.getByRole('button', { name: 'Add tracking number' }).click();
      await expect(trackingInputs(page)).toHaveCount(startCount + 1);
      await trackingInputs(page).nth(startCount).fill(DEMO);
      await saveModal(page);

      // Authoritative: DB now has original + demo.
      await expect
        .poll(() => readTracking(request), { timeout: 15_000 })
        .toEqual(expect.arrayContaining([...original, DEMO]));
      expect(await readTracking(request), 'add should not drop the original').toContain(original[0]);

      // UI reflects it: reload so the panel pulls fresh data, then reopen.
      await reloadFresh(page);
      await openModal(page);
      const afterAddValues = await modalTrackingValues(page);
      expect(afterAddValues, 'demo tracking visible in the modal').toContain(DEMO);
      expect(afterAddValues, 'original tracking still shown').toEqual(
        expect.arrayContaining(original),
      );

      // ── DELETE via the UI ─────────────────────────────────────────────
      const demoIndex = afterAddValues.indexOf(DEMO);
      expect(demoIndex, 'demo row located in modal').toBeGreaterThanOrEqual(0);
      // Delete-button aria-labels are 1-based ("Delete tracking number N").
      await page.getByRole('button', { name: `Delete tracking number ${demoIndex + 1}` }).click();
      await saveModal(page);

      // Authoritative: back to exactly the original set.
      await expect.poll(() => readTracking(request), { timeout: 15_000 }).toEqual(original);

      // UI reflects the deletion (reload for fresh panel data).
      await reloadFresh(page);
      await openModal(page);
      const finalValues = await modalTrackingValues(page);
      expect(finalValues, 'demo tracking removed from the modal').not.toContain(DEMO);
      expect(finalValues.filter(Boolean), 'modal back to the original set').toEqual(original);
      await page.getByRole('button', { name: 'Cancel' }).click();
    } finally {
      // Safety net: restore the original set regardless of where we failed.
      await request
        .patch(`/api/orders/${ORDER_ID}/tracking`, { data: { setTrackingNumbers: original } })
        .catch(() => {});
    }
  });
});
