/**
 * backfill-orders-sku-catalog-id.mjs
 * ────────────────────────────────────────────────────────────────────
 * Relinks orphaned `orders.sku_catalog_id` rows.
 *
 * Some orders sit with `sku_catalog_id IS NULL` even though an ACTIVE,
 * already-mapped `sku_platform_ids` row says exactly which canonical SKU
 * their Amazon ASIN / eBay-Walmart item id / platform SKU belongs to
 * (e.g. ASIN B00005T3NH → sku_catalog_id 3, but 12 Amazon order rows were
 * never updated). The platform mapping exists; the orders just never got
 * backfilled, so they show as "unpaired" and never enter any canonical view.
 *
 * This relinks an order ONLY when the match is unambiguous — i.e. the
 * identifier maps to exactly ONE sku_catalog_id across all mapped
 * sku_platform_ids rows. item_number (→ platform_item_id) wins over
 * sku (→ platform_sku) when both resolve.
 *
 * It does NOT invent mappings: ASINs whose platform-id row is unmapped
 * (sku_catalog_id IS NULL, e.g. B01AWLPUAG) are left untouched — those
 * need a real pairing decision first, not a backfill.
 *
 * Usage:
 *   node scripts/backfill-orders-sku-catalog-id.mjs           # dry-run preview
 *   node scripts/backfill-orders-sku-catalog-id.mjs --apply   # commit
 */

import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error('Missing DATABASE_URL (or DATABASE_URL_UNPOOLED) in env.');
  process.exit(1);
}
const sql = neon(url);

const APPLY = process.argv.includes('--apply');
console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

// Unambiguous identifier → canonical SKU map, drawn only from already-mapped
// platform-id rows. Reused verbatim by preview + update so they agree exactly.
const RESOLVED_CTE = `
  WITH map AS (
    SELECT upper(platform_item_id) AS k, sku_catalog_id
      FROM sku_platform_ids
     WHERE sku_catalog_id IS NOT NULL AND COALESCE(platform_item_id, '') <> ''
    UNION
    SELECT upper(platform_sku) AS k, sku_catalog_id
      FROM sku_platform_ids
     WHERE sku_catalog_id IS NOT NULL AND COALESCE(platform_sku, '') <> ''
  ),
  unambig AS (
    SELECT k, MIN(sku_catalog_id) AS sku_catalog_id
      FROM map
     GROUP BY k
    HAVING COUNT(DISTINCT sku_catalog_id) = 1
  ),
  resolved AS (
    SELECT o.id AS order_row_id,
           COALESCE(ti.sku_catalog_id, ts.sku_catalog_id) AS sku_catalog_id
      FROM orders o
      LEFT JOIN unambig ti ON ti.k = upper(o.item_number)
      LEFT JOIN unambig ts ON ts.k = upper(o.sku)
     WHERE o.sku_catalog_id IS NULL
       AND (ti.sku_catalog_id IS NOT NULL OR ts.sku_catalog_id IS NOT NULL)
  )`;

// Preview: how many orders, and the top canonical targets they'll land on.
const summary = await sql.query(`${RESOLVED_CTE}
  SELECT COUNT(*)::int AS orders_to_relink,
         COUNT(DISTINCT sku_catalog_id)::int AS distinct_targets
  FROM resolved`);
console.log('Orphan orders that will be relinked:', summary[0].orders_to_relink);
console.log('Distinct canonical SKU targets:     ', summary[0].distinct_targets, '\n');

const breakdown = await sql.query(`${RESOLVED_CTE}
  SELECT r.sku_catalog_id, sc.sku, LEFT(sc.product_title, 44) AS title,
         sc.is_active, COUNT(*)::int AS n
  FROM resolved r
  JOIN sku_catalog sc ON sc.id = r.sku_catalog_id
  GROUP BY r.sku_catalog_id, sc.sku, sc.product_title, sc.is_active
  ORDER BY n DESC
  LIMIT 25`);
console.log('Top targets:');
console.table(breakdown);

if (!APPLY) {
  console.log('\nDRY-RUN — no rows changed. Re-run with --apply to commit.');
  process.exit(0);
}

const updated = await sql.query(`${RESOLVED_CTE}
  UPDATE orders o
     SET sku_catalog_id = r.sku_catalog_id
    FROM resolved r
   WHERE r.order_row_id = o.id
  RETURNING o.id`);
console.log(`\n✅ Relinked ${updated.length} order rows.`);
process.exit(0);
