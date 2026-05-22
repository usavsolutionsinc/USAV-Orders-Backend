import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
const url = readFileSync('/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env','utf8').match(/^DATABASE_URL_UNPOOLED=(.+)$/m)[1].trim();
const sql = neon(url);

console.log('=== Amazon open orders — SKU distribution ===');
const skus = await sql`
  SELECT
    CASE WHEN sku IS NULL THEN '(null)' WHEN TRIM(sku) = '' THEN '(empty)' ELSE 'has-value' END AS bucket,
    COUNT(*)::int AS n
   FROM orders
   WHERE LOWER(account_source) = 'amazon'
     AND (status IS NULL OR status != 'shipped')
   GROUP BY bucket
`;
for (const r of skus) console.log(`  ${r.bucket.padEnd(15)} ${r.n}`);

console.log('\n=== Sample of Amazon orders with non-empty SKU — does the SKU match an Amazon spi row? ===');
const sample = await sql`
  SELECT o.id, o.order_id, o.sku, o.sku_catalog_id,
         (SELECT COUNT(*)::int FROM sku_platform_ids spi
           WHERE spi.platform = 'amazon' AND spi.platform_sku = o.sku) AS amazon_spi_match,
         (SELECT COUNT(*)::int FROM sku_platform_ids spi
           WHERE spi.platform = 'ecwid'  AND spi.platform_sku = o.sku) AS ecwid_spi_match
    FROM orders o
   WHERE LOWER(o.account_source) = 'amazon'
     AND (o.status IS NULL OR o.status != 'shipped')
     AND o.sku IS NOT NULL AND TRIM(o.sku) != ''
   ORDER BY o.id DESC LIMIT 15
`;
for (const r of sample) console.log(`  #${r.id} order=${r.order_id} sku='${r.sku}' catalog_id=${r.sku_catalog_id || '-'} matches[amazon=${r.amazon_spi_match}, ecwid=${r.ecwid_spi_match}]`);

console.log('\n=== Amazon SKU format patterns ===');
const patterns = await sql`
  SELECT
    CASE
      WHEN sku ~ '^[A-Z]{2}-[A-Z0-9]{4}-[A-Z0-9]{4}$' THEN 'Amazon-MSKU-format'
      WHEN sku ~ '^0?\d{4,5}(-[A-Z0-9]+)?$' THEN 'internal-numeric'
      WHEN sku ILIKE 'B0%' THEN 'ASIN-like'
      ELSE 'other'
    END AS pattern,
    COUNT(*)::int AS n
    FROM orders
   WHERE LOWER(account_source) = 'amazon'
     AND (status IS NULL OR status != 'shipped')
     AND sku IS NOT NULL AND TRIM(sku) != ''
   GROUP BY pattern
   ORDER BY n DESC
`;
for (const r of patterns) console.log(`  ${r.pattern.padEnd(22)} ${r.n}`);
