import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { Pool } from '@neondatabase/serverless';

/**
 * Multi-product order grouping in the dashboard Unshipped queue.
 *
 * When one order number carries DIFFERENT products (a real multi-line order),
 * the queue keeps them as separate rows folded under a single expandable header
 * (CollapsibleGroupRow) with a "×N" product-count chip — the same disclosure the
 * receiving + FBA tables use. When the rows are the SAME product (an accidental
 * import dupe), `dedupeByOrderProduct` collapses them to a single plain row.
 *
 * Seeds throwaway `orders` rows directly (there is no order-insert API), drives
 * the real /dashboard view, and deletes the rows afterward. Auth comes from
 * tests/.auth/admin.json (global-setup). Desktop-only — the queue grouping is a
 * desktop layout (ChipColumns); the mobile project is skipped.
 */

const DB = process.env.DATABASE_URL;
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
// Goodwill-style, definitively non-FBA order number (account_source reinforces it).
const makeOrderNo = () => `90-9${Math.floor(Math.random() * 9000 + 1000)}-${Math.floor(Math.random() * 90000 + 10000)}`;

test.describe('Multi-product order grouping (unshipped queue)', () => {
  test.skip(({ browserName }) => browserName === 'webkit', 'queue grouping is a desktop layout');
  test.skip(!DB, 'requires DATABASE_URL to seed orders');

  let pool: Pool;
  let org: string;
  const createdIds: number[] = [];

  test.beforeAll(async () => {
    pool = new Pool({ connectionString: DB, max: 1, connectionTimeoutMillis: 20_000 });
    // Use a real org from the table so the seeded rows match the signed-in
    // admin's tenant (the orders route scopes by organization_id).
    const r = await pool.query(`SELECT organization_id FROM orders WHERE organization_id IS NOT NULL LIMIT 1`);
    org = r.rows[0].organization_id;
  });

  test.afterAll(async () => {
    if (createdIds.length > 0) {
      await pool.query(`DELETE FROM orders WHERE id = ANY($1::int[])`, [createdIds]);
    }
    await pool?.end();
  });

  /**
   * Seed one `orders` row per line, all sharing `orderId`. Fresh rows (no
   * shipment, no station scan) land in the Unshipped "awaiting" scope.
   *
   * Each line gets a DISTINCT account_source because the table has a unique
   * index on (order_id, account_source) — exactly how real multi-line orders
   * and accidental dupes occur in this DB (one row carries a platform label,
   * the sibling import leaves it NULL, which the index treats as distinct).
   */
  async function seedOrder(orderId: string, lines: { title: string; source: string | null }[]): Promise<number[]> {
    const ids: number[] = [];
    for (const { title, source } of lines) {
      const res = await pool.query(
        `INSERT INTO orders
           (organization_id, order_id, product_title, sku, condition, quantity, status, account_source, created_at)
         VALUES ($1, $2, $3, '', 'USED', '1', 'unassigned', $4, NOW())
         RETURNING id`,
        [org, orderId, title, source],
      );
      const id = Number(res.rows[0].id);
      ids.push(id);
      createdIds.push(id);
    }
    return ids;
  }

  test('different products under one order → one expandable group with a ×2 chip', async ({ page }) => {
    const orderNo = makeOrderNo();
    const tag = uniq();
    const titleA = `E2E Multi A ${tag}`;
    const titleB = `E2E Multi B ${tag}`;
    // Distinct sources (one labeled, one NULL) — how a real multi-product order
    // is stored under the (order_id, account_source) unique index.
    await seedOrder(orderNo, [
      { title: titleA, source: 'Goodwill' },
      { title: titleB, source: null },
    ]);

    // Sanity: the orders route (same scope the table fetches) returns BOTH lines.
    const probe = await page.request.get(`/api/orders?q=${encodeURIComponent(orderNo)}&excludePacked=true`);
    expect(probe.ok()).toBeTruthy();
    const probeBody = await probe.json();
    const probeRows = (probeBody.orders || []).filter((o: { order_id?: string }) => o.order_id === orderNo);
    expect(probeRows.length).toBe(2);

    await page.goto(`/dashboard?unshipped&search=${encodeURIComponent(orderNo)}`);

    // Collapsed group header carries the shared order identity + the ×2 product
    // count, and the per-product rows are NOT in the DOM until expanded.
    const groupTitle = page.getByText(`Order ${orderNo}`, { exact: false });
    await expect(groupTitle).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('×2')).toBeVisible();
    await expect(page.getByText(titleA)).toHaveCount(0);
    await expect(page.getByText(titleB)).toHaveCount(0);

    // Expand → both distinct product lines reveal.
    await groupTitle.click();
    await expect(page.getByText(titleA)).toBeVisible();
    await expect(page.getByText(titleB)).toBeVisible();
  });

  test('identical products under one order → collapsed to a single plain row (no group)', async ({ page }) => {
    const orderNo = makeOrderNo();
    const tag = uniq();
    const dupTitle = `E2E Dupe ${tag}`;
    // Same product (same title) imported twice under one order# with a NULL-source
    // sibling — the accidental-dupe shape. dedupeByOrderProduct must collapse it.
    await seedOrder(orderNo, [
      { title: dupTitle, source: 'Goodwill' },
      { title: dupTitle, source: null },
    ]);

    await page.goto(`/dashboard?unshipped&search=${encodeURIComponent(orderNo)}`);

    // Exactly one row (the accidental dupe collapsed) and no ×N group chip.
    await expect(page.getByText(dupTitle)).toHaveCount(1, { timeout: 20_000 });
    await expect(page.getByText('×2')).toHaveCount(0);
  });
});
