import { test, expect } from '@playwright/test';

/**
 * Phase 2 — Unshipped pagination + counts.
 *
 * Mocks BOTH the list (`/api/orders`) and the lightweight counts
 * (`/api/orders/queue-counts`) endpoints with a tenant of TOTAL synthetic PENDING
 * orders. Verifies the board caps the initial fetch at 200 and surfaces a global
 * "Load more" driven by the counts total (dedup-independent) that grows the page
 * and then disappears once the whole set is loaded. Desktop-only.
 */

const TOTAL = 450;

function makeRows(n: number) {
  const baseDay = Date.UTC(2026, 0, 5, 18, 0, 0);
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const at = new Date(baseDay - (i % 3) * 86_400_000).toISOString();
    rows.push({
      id: 800_000 + i,
      order_id: `E2E-PAGE-${800_000 + i}`,
      product_title: `E2E Page Row ${i}`,
      sku: `EPG-${i}`,
      condition: 'USED',
      quantity: '1',
      account_source: 'Goodwill',
      created_at: at,
      deadline_at: at,
      shipment_id: 600_000 + i,
      has_tech_scan: false,
      out_of_stock: '',
      latest_status_category: 'UNKNOWN',
    });
  }
  return rows;
}

test.describe('Unshipped pagination + counts (Phase 2)', () => {
  test.skip(({ browserName }) => browserName === 'webkit', 'board is a desktop layout');

  test('caps at 200, "Load more" grows the page from the counts total', async ({ page }) => {
    // Counts endpoint → total drives the load-more affordance.
    await page.route(
      (url) => url.pathname === '/api/orders/queue-counts',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'x-cache': 'MISS' },
          body: JSON.stringify({
            total: TOTAL,
            byStage: { all: TOTAL, pending: TOTAL, tested: 0 },
            combos: [{ hasTechScan: false, blocked: false, count: TOTAL }],
          }),
        });
      },
    );

    // List endpoint → honor the `limit` param so "Load more" visibly grows the set.
    await page.route(
      (url) => url.pathname === '/api/orders',
      async (route, request) => {
        const limit = Number(new URL(request.url()).searchParams.get('limit')) || TOTAL;
        const rows = makeRows(Math.min(limit, TOTAL));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'x-cache': 'BYPASS' },
          body: JSON.stringify({ orders: rows, count: rows.length, truncated: limit < TOTAL, nextCursor: null }),
        });
      },
    );

    await page.goto('/dashboard?unshipped', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-order-row-id]').first().waitFor({ state: 'visible', timeout: 45_000 });

    // Load-more footer visible, showing the first 200 of the counts total.
    const loadMore = page.getByRole('button', { name: 'Load more' });
    await expect(loadMore).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(`Showing 200 of ${TOTAL}`)).toBeVisible();

    // Bump → the page grows to 400.
    await loadMore.click();
    await expect(page.getByText(`Showing 400 of ${TOTAL}`)).toBeVisible({ timeout: 20_000 });

    // Bump again → whole set loaded (rowLimit 600 ≥ 450) → the footer disappears.
    await loadMore.click();
    await expect(loadMore).toHaveCount(0, { timeout: 20_000 });
  });
});
