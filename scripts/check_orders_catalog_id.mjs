import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
const url = readFileSync('/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env','utf8').match(/^DATABASE_URL_UNPOOLED=(.+)$/m)[1].trim();
const sql = neon(url);

const r = await sql`
  SELECT
    COUNT(*) FILTER (WHERE sku_catalog_id IS NOT NULL)::int AS has_id,
    COUNT(*) FILTER (WHERE sku_catalog_id IS NULL)::int     AS no_id,
    COUNT(*)::int AS total
  FROM orders
  WHERE status IS NULL OR status != 'shipped'
`;
console.log('Open orders by sku_catalog_id:', r[0]);

// Of orders WITH sku_catalog_id, how many have STOCKED inventory available via that canonical sku?
const stockable = await sql`
  SELECT COUNT(*)::int AS n
  FROM orders o
  JOIN sku_catalog sc ON sc.id = o.sku_catalog_id
  WHERE (o.status IS NULL OR o.status != 'shipped')
    AND o.sku_catalog_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM serial_units su WHERE su.sku = sc.sku AND su.current_status = 'STOCKED')
`;
console.log(`Open orders w/ sku_catalog_id whose canonical SKU has STOCKED units: ${stockable[0].n}`);

// And — does the canonical sku from sku_catalog match orders.sku verbatim, or are they different?
const drift = await sql`
  SELECT o.id, o.sku AS order_sku, sc.sku AS canonical_sku
    FROM orders o
    JOIN sku_catalog sc ON sc.id = o.sku_catalog_id
   WHERE (o.status IS NULL OR o.status != 'shipped')
     AND o.sku IS NOT NULL
     AND o.sku != sc.sku
   LIMIT 10
`;
console.log(`\nSample where order.sku != canonical sku (drift indicator):`);
for (const r of drift) console.log(`  order #${r.id}: '${r.order_sku}' → '${r.canonical_sku}'`);
