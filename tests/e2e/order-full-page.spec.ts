import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Full-page order view — /o/[orderId] (desktop project).
 *
 * Covers the "open in full page" feature built on top of the shipped slide-over:
 *   1. the magnifier in the slide-over header navigates to /o/[id];
 *   2. /o/[id] renders the two-column Shopify layout (main + right rail) with all
 *      sections and an editable Notes box seeded from DB truth;
 *   3. an FBA order id routes to the FBA workspace instead of dead-ending (gated
 *      on PW_FBA_ORDER_ID);
 *   4. editing a note on the page persists (save-on-blur) — read back from the API.
 *
 * Self-contained: the notes round-trip restores the original value in `finally`,
 * so it never leaves the fixture order dirty.
 *
 * Env:
 *   PW_FULLPAGE_ORDER_ID – non-FBA order id to drive (default 2902, shared with
 *                          order-tracking-edit.spec.ts)
 *   PW_FBA_ORDER_ID      – a known FBA order id; when unset, the FBA test skips
 */

const ORDER_ID = Number(
  process.env.PW_FULLPAGE_ORDER_ID || process.env.PW_TRACKING_ORDER_ID || '2902',
);
const FBA_ORDER_ID = process.env.PW_FBA_ORDER_ID ? Number(process.env.PW_FBA_ORDER_ID) : null;

const isMobile = () => test.info().project.name === 'mobile';

/** The order's notes straight from the DB via the API (same source the page reads). */
async function readNotes(request: APIRequestContext, id: number): Promise<string> {
  const res = await request.get(`/api/orders?orderId=${id}&includeShipped=true`);
  expect(res.ok(), `orders read failed (${res.status()})`).toBeTruthy();
  const json = JSON.parse(await res.text());
  return String(json.orders?.[0]?.notes ?? '');
}

test.describe('Order full-page view (/o/[id])', () => {
  test('magnifier in the shipped slide-over opens the full-page order view', async ({ page }) => {
    test.skip(isMobile(), 'desktop full-page flow');

    await page.goto(`/dashboard?shipped&openOrderId=${ORDER_ID}`);

    const magnifier = page.getByRole('button', { name: 'Open full order page' }).first();
    await magnifier.waitFor({ state: 'visible', timeout: 25_000 });
    await magnifier.click();

    await expect(page).toHaveURL(new RegExp(`/o/${ORDER_ID}(?:[/?#]|$)`), { timeout: 15_000 });
    // The page loaded (not the not-found state) → the sidebar summary is present.
    await expect(page.getByRole('heading', { name: 'Order summary' })).toBeVisible({
      timeout: 20_000,
    });
  });

  test('renders the two-column layout with every section + a DB-seeded notes box', async ({
    page,
    request,
  }) => {
    test.skip(isMobile(), 'desktop full-page flow');

    const dbNotes = await readNotes(request, ORDER_ID);

    await page.goto(`/o/${ORDER_ID}`);

    // Right rail (unique to this page).
    await expect(page.getByRole('heading', { name: 'Order summary' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('heading', { name: 'Customer' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Notes' }).first()).toBeVisible();

    // Main column sections.
    await expect(page.getByRole('heading', { name: 'Documents' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Timeline' }).first()).toBeVisible();

    // Editable notes box mirrors DB truth.
    const notesBox = page.getByPlaceholder('Add a note…');
    await expect(notesBox).toBeVisible();
    await expect(notesBox).toHaveValue(dbNotes);
  });

  test('condition grade is locked (not selectable) on a shipped order', async ({ page }) => {
    test.skip(isMobile(), 'desktop full-page flow');

    await page.goto(`/o/${ORDER_ID}`);

    // Fixture 2902 is delivered → the grade renders as a single locked badge,
    // never the interactive 7-pill radiogroup. (Assumes a shipped fixture.)
    await expect(
      page.getByRole('group', { name: /condition grade \(locked after shipping\)/i }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('radiogroup', { name: /condition grade/i })).toHaveCount(0);
  });

  test('an FBA order routes to the FBA workspace instead of 404', async ({ page }) => {
    test.skip(isMobile(), 'desktop full-page flow');
    test.skip(!FBA_ORDER_ID, 'set PW_FBA_ORDER_ID to a known FBA order id to run');

    await page.goto(`/o/${FBA_ORDER_ID}`);

    await expect(page.getByText('This is an Amazon FBA shipment')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Open FBA workspace' })).toBeVisible();
  });

  test('editing a note on the full page persists (save-on-blur)', async ({ page, request }) => {
    test.skip(isMobile(), 'desktop full-page flow');

    const original = await readNotes(request, ORDER_ID);
    const demo = `E2E-NOTE-${Date.now()}`;

    try {
      await page.goto(`/o/${ORDER_ID}`);

      const notesBox = page.getByPlaceholder('Add a note…');
      await notesBox.waitFor({ state: 'visible', timeout: 20_000 });
      await notesBox.fill(demo);
      await notesBox.blur(); // onBlur → handleSaveNotes → PATCH /api/orders/[id]

      // Authoritative: DB reflects the edit (saveNotes trims + stores).
      await expect
        .poll(() => readNotes(request, ORDER_ID), { timeout: 15_000 })
        .toBe(demo);
    } finally {
      // Safety net: restore the original note regardless of where we failed.
      await request
        .patch(`/api/orders/${ORDER_ID}`, { data: { notes: original || null } })
        .catch(() => {});
    }
  });
});
