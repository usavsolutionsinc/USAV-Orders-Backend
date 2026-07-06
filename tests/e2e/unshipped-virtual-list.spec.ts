import { test, expect } from '@playwright/test';

/**
 * Phase 0 — Unshipped board virtualization smoke.
 *
 * The Unshipped lane bodies window their rows via `VirtualQueueSections` (behind
 * `NEXT_PUBLIC_UNSHIPPED_VIRTUAL_LIST`, default on), mirroring the Shipped board.
 * This mocks `/api/orders` with 500 synthetic PENDING rows so the assertion is
 * DB-independent, forces the capped 2-up layout (where windowing is active — the
 * 1-up stacked default grows to content and delegates scroll to the ancestor,
 * same as `ShippedLaneTable`), then verifies only a windowed slice is in the DOM
 * (`data-index` nodes from the virtualizer), not all 500.
 *
 * Auth comes from tests/.auth/admin.json (global-setup). Desktop-only — the board
 * is a desktop layout; the mobile (webkit) project is skipped.
 */

const ROW_COUNT = 500;

/** 500 non-FBA, PENDING (no tech scan, in-stock), unshipped-scope rows, spread
 *  across 3 day bands so the day-header pin is exercised too. Each carries a
 *  unique order_id + sku so `dedupeByOrderProduct` keeps them all as singleton
 *  rows. Fixed dates (no Date.now) keep banding deterministic. */
function makeRows(n: number) {
  const baseDay = Date.UTC(2026, 0, 5, 18, 0, 0); // arbitrary fixed noon-ish PST day
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const dayOffset = i % 3;
    const at = new Date(baseDay - dayOffset * 86_400_000).toISOString();
    rows.push({
      id: 900_000 + i,
      order_id: `E2E-VLIST-${900_000 + i}`,
      product_title: `E2E Virtual Row ${i}`,
      sku: `EVL-${i}`,
      condition: 'USED',
      quantity: '1',
      account_source: 'Goodwill', // definitively non-FBA → survives isNonFbaRecord
      created_at: at,
      deadline_at: at,
      shipment_id: 700_000 + i, // fulfillment-scope shape
      has_tech_scan: false, // → PENDING lane
      out_of_stock: '',
      latest_status_category: 'UNKNOWN', // not shipped → stays in the queue
    });
  }
  return rows;
}

test.describe('Unshipped board virtualization (Phase 0)', () => {
  test.skip(({ browserName }) => browserName === 'webkit', 'board is a desktop layout');

  test('500 mocked rows render windowed (DOM ≪ dataset)', async ({ page }) => {
    const rows = makeRows(ROW_COUNT);

    // Fulfil every /api/orders LIST call (table + sidebar count + warm-up) with the
    // synthetic payload. Exact-pathname match so /api/orders/lookup/[id] (details)
    // is untouched.
    await page.route(
      (url) => url.pathname === '/api/orders',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'x-cache': 'BYPASS' },
          body: JSON.stringify({ orders: rows, count: rows.length }),
        });
      },
    );

    await page.goto('/dashboard?unshipped', { waitUntil: 'domcontentloaded' });

    // Force the capped 2-up layout so a lane body is a real scroll container
    // (the windowed path; the 1-up stacked default grows to content). The board
    // columns toggle is a role="button" inside the "Board columns" group; clicking
    // an already-pressed "2 columns" is a harmless no-op.
    const twoCol = page.getByRole('button', { name: '2 columns' });
    await twoCol.waitFor({ state: 'visible', timeout: 45_000 });
    await twoCol.click();

    // The virtualizer emits data-index nodes; wait for the first, then settle.
    await page.locator('[data-index]').first().waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(600);

    const domRows = await page.locator('[data-order-row-id]').count();
    const dataIndexNodes = await page.locator('[data-index]').count();

    // eslint-disable-next-line no-console
    console.log(`[unshipped-vlist] before-scroll: dataIndex=${dataIndexNodes} · domRows=${domRows} of ${ROW_COUNT}`);

    // Something rendered, and it's a windowed slice — NOT the full 500. This is the
    // environment-independent guard that catches an un-windowing regression.
    expect(dataIndexNodes).toBeGreaterThan(0);
    expect(domRows).toBeGreaterThan(0);
    expect(domRows).toBeLessThan(150);

    // Scroll the populated lane body and confirm the DOM stays windowed (rows
    // recycle rather than accumulate).
    const laneBody = page
      .locator('[data-testid="column-table-body"]')
      .filter({ has: page.locator('[data-index]') })
      .first();
    await laneBody.evaluate((el) => el.scrollTo({ top: 6000 }));
    await page.waitForTimeout(600);

    const domRowsAfter = await page.locator('[data-order-row-id]').count();
    // eslint-disable-next-line no-console
    console.log(`[unshipped-vlist] after-scroll: domRows=${domRowsAfter} of ${ROW_COUNT}`);
    expect(domRowsAfter).toBeGreaterThan(0);
    expect(domRowsAfter).toBeLessThan(150);
  });
});
