/**
 * sku_platform_scope_audit.mjs
 * ────────────────────────────────────────────────────────────────────
 * Two questions before writing the autopair backfill:
 *
 *   1. What `platform` values exist in sku_platform_ids, and do they
 *      align (modulo case) with `orders.account_source`?
 *
 *   2. Of the autopair candidates (open orders w/ a platform_sku
 *      match), how many platform_skus exist under MULTIPLE platforms?
 *      That's the cross-contamination risk — if 'KP-FDKW-S6LI' maps
 *      to catalog row #100 for Amazon and #200 for eBay, a non-scoped
 *      join could mis-pair the order.
 */

import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
const url = readFileSync('/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env','utf8').match(/^DATABASE_URL_UNPOOLED=(.+)$/m)[1].trim();
const sql = neon(url);

console.log('=== sku_platform_ids distinct platforms ===');
const platforms = await sql`
  SELECT platform, COUNT(*)::int AS n,
         COUNT(*) FILTER (WHERE sku_catalog_id IS NOT NULL)::int AS paired,
         COUNT(*) FILTER (WHERE platform_sku IS NOT NULL)::int   AS has_sku
    FROM sku_platform_ids
   GROUP BY platform
   ORDER BY n DESC
`;
for (const r of platforms) console.log(`  ${r.platform.padEnd(20)} total=${r.n}  paired=${r.paired}  has_platform_sku=${r.has_sku}`);

console.log('\n=== orders.account_source distinct (open orders) ===');
const sources = await sql`
  SELECT account_source, COUNT(*)::int AS n
    FROM orders
   WHERE status IS NULL OR status != 'shipped'
   GROUP BY account_source
   ORDER BY n DESC
`;
for (const r of sources) console.log(`  ${(r.account_source || '(null)').padEnd(20)} ${r.n}`);

console.log('\n=== Case-insensitive match between sources and platforms ===');
const aligned = await sql`
  SELECT LOWER(o.account_source) AS source_lower,
         LOWER(spi.platform) AS platform_lower,
         COUNT(DISTINCT o.id)::int AS open_orders_with_matching_platform_sku
    FROM orders o
    JOIN sku_platform_ids spi ON LOWER(spi.platform) = LOWER(o.account_source)
                              AND spi.platform_sku = o.sku
                              AND spi.sku_catalog_id IS NOT NULL
   WHERE (o.status IS NULL OR o.status != 'shipped')
     AND o.sku_catalog_id IS NULL
     AND o.sku IS NOT NULL AND o.sku != ''
   GROUP BY LOWER(o.account_source), LOWER(spi.platform)
   ORDER BY open_orders_with_matching_platform_sku DESC
`;
for (const r of aligned) console.log(`  source='${r.source_lower}' → platform='${r.platform_lower}': ${r.open_orders_with_matching_platform_sku} orders`);

console.log('\n=== Cross-platform collisions: how many platform_skus map to >1 distinct catalog row? ===');
const collisions = await sql`
  SELECT platform_sku, COUNT(DISTINCT sku_catalog_id)::int AS distinct_catalogs,
         STRING_AGG(DISTINCT platform, ',' ORDER BY platform) AS platforms
    FROM sku_platform_ids
   WHERE platform_sku IS NOT NULL
     AND sku_catalog_id IS NOT NULL
   GROUP BY platform_sku
  HAVING COUNT(DISTINCT sku_catalog_id) > 1
   ORDER BY distinct_catalogs DESC
   LIMIT 20
`;
console.log(`Found ${collisions.length} platform_sku values that resolve to multiple catalog rows:`);
for (const r of collisions) console.log(`  '${r.platform_sku}' → ${r.distinct_catalogs} catalog rows, platforms=${r.platforms}`);

console.log('\n=== Coverage projection: how many open orders would the platform-scoped autopair fix? ===');
const projection = await sql`
  SELECT COUNT(DISTINCT o.id)::int AS pairable
    FROM orders o
    JOIN sku_platform_ids spi
      ON LOWER(spi.platform) = LOWER(o.account_source)
     AND spi.platform_sku = o.sku
     AND spi.sku_catalog_id IS NOT NULL
   WHERE (o.status IS NULL OR o.status != 'shipped')
     AND o.sku_catalog_id IS NULL
     AND o.sku IS NOT NULL AND o.sku != ''
`;
console.log(`  Pairable open orders (platform-scoped): ${projection[0].pairable}`);

const lax = await sql`
  SELECT COUNT(DISTINCT o.id)::int AS pairable
    FROM orders o
    JOIN sku_platform_ids spi
      ON spi.platform_sku = o.sku
     AND spi.sku_catalog_id IS NOT NULL
   WHERE (o.status IS NULL OR o.status != 'shipped')
     AND o.sku_catalog_id IS NULL
     AND o.sku IS NOT NULL AND o.sku != ''
`;
console.log(`  Pairable open orders (lax, ignoring platform): ${lax[0].pairable}`);

console.log('\n=== Open orders that have a matching platform_sku but account_source is NULL ===');
const orphans = await sql`
  SELECT COUNT(DISTINCT o.id)::int AS n
    FROM orders o
    JOIN sku_platform_ids spi
      ON spi.platform_sku = o.sku
     AND spi.sku_catalog_id IS NOT NULL
   WHERE (o.status IS NULL OR o.status != 'shipped')
     AND o.sku_catalog_id IS NULL
     AND o.account_source IS NULL
     AND o.sku IS NOT NULL AND o.sku != ''
`;
console.log(`  ${orphans[0].n} open orders have a candidate match but NULL account_source — would be skipped by platform-scoped pairing`);
