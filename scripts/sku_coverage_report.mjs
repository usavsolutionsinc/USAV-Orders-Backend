/**
 * sku_coverage_report.mjs — final coverage breakdown.
 *
 * Bottom line: of the open orders, how many can resolve to a sku_catalog
 * row through the existing mapping chain (direct match → sku_platform_ids
 * mapping → fuzzy normalization)?
 *
 * Combined with the STOCKED-unit join, this tells us the real Phase-2
 * gating size: "if we flip allocation today, how many orders would actually
 * find inventory?"
 */

import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const envText = readFileSync('/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env', 'utf8');
const url = (envText.match(/^DATABASE_URL_UNPOOLED=(.+)$/m) || envText.match(/^DATABASE_URL=(.+)$/m))[1].trim();
const sql = neon(url);

console.log('=== Open-order SKU resolution coverage ===');

// Tier 0 — total open orders
const total = await sql`SELECT COUNT(*)::int AS n FROM orders WHERE status IS NULL OR status != 'shipped'`;
console.log(`Total open orders:                              ${total[0].n}`);

// Tier 1 — has a usable SKU at all
const usable = await sql`
  SELECT COUNT(*)::int AS n FROM orders
   WHERE (status IS NULL OR status != 'shipped')
     AND sku IS NOT NULL AND TRIM(sku) != ''
     AND LOWER(TRIM(sku)) != 'no data'
`;
console.log(`  with usable SKU value:                        ${usable[0].n}`);

// Tier 2a — direct sku_catalog match (verbatim)
const directCat = await sql`
  SELECT COUNT(*)::int AS n FROM orders o
   WHERE (o.status IS NULL OR o.status != 'shipped')
     AND o.sku IS NOT NULL AND TRIM(o.sku) != ''
     AND EXISTS (SELECT 1 FROM sku_catalog sc WHERE sc.sku = o.sku)
`;
console.log(`    → resolves directly to sku_catalog:         ${directCat[0].n}`);

// Tier 2b — resolves through sku_platform_ids
const viaMap = await sql`
  SELECT COUNT(*)::int AS n FROM orders o
   WHERE (o.status IS NULL OR o.status != 'shipped')
     AND o.sku IS NOT NULL AND TRIM(o.sku) != ''
     AND NOT EXISTS (SELECT 1 FROM sku_catalog sc WHERE sc.sku = o.sku)
     AND EXISTS (
       SELECT 1 FROM sku_platform_ids spi
        WHERE spi.platform_sku = o.sku
          AND spi.sku_catalog_id IS NOT NULL
     )
`;
console.log(`    → resolves only via sku_platform_ids map:   ${viaMap[0].n}`);

// Tier 2c — has SKU but resolves NOWHERE
const unresolved = await sql`
  SELECT COUNT(*)::int AS n FROM orders o
   WHERE (o.status IS NULL OR o.status != 'shipped')
     AND o.sku IS NOT NULL AND TRIM(o.sku) != ''
     AND NOT EXISTS (SELECT 1 FROM sku_catalog sc WHERE sc.sku = o.sku)
     AND NOT EXISTS (
       SELECT 1 FROM sku_platform_ids spi
        WHERE spi.platform_sku = o.sku
          AND spi.sku_catalog_id IS NOT NULL
     )
`;
console.log(`    → has SKU but resolves nowhere:             ${unresolved[0].n}`);

// Tier 3 — orders whose catalog row has at least one STOCKED unit
const allocatable = await sql`
  SELECT COUNT(*)::int AS n FROM orders o
   WHERE (o.status IS NULL OR o.status != 'shipped')
     AND o.sku IS NOT NULL AND TRIM(o.sku) != ''
     AND EXISTS (
       SELECT 1 FROM sku_catalog sc
        JOIN serial_units su ON su.sku = sc.sku
        WHERE su.current_status = 'STOCKED'
          AND (sc.sku = o.sku
               OR EXISTS (SELECT 1 FROM sku_platform_ids spi
                           WHERE spi.platform_sku = o.sku
                             AND spi.sku_catalog_id = sc.id))
     )
`;
console.log(`  with at least one STOCKED unit available:     ${allocatable[0].n}`);

// Tier 4 — what SKUs from open orders DO have stock somewhere (sku_stock)?
const inStockShelf = await sql`
  SELECT COUNT(*)::int AS n FROM orders o
   WHERE (o.status IS NULL OR o.status != 'shipped')
     AND o.sku IS NOT NULL AND TRIM(o.sku) != ''
     AND EXISTS (
       SELECT 1 FROM sku_stock ss
        WHERE ss.stock > 0
          AND (ss.sku = o.sku
               OR ss.sku IN (SELECT sc.sku FROM sku_catalog sc
                              JOIN sku_platform_ids spi ON spi.sku_catalog_id = sc.id
                             WHERE spi.platform_sku = o.sku))
     )
`;
console.log(`  with stock available per sku_stock counter:   ${inStockShelf[0].n}`);

console.log('\n=== Does the order ingest already use sku_platform_ids? ===');
console.log('  Run: grep -rn "sku_platform_ids" src --include="*.ts" | head');
