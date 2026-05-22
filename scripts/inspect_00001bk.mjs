import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
const url = readFileSync('/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env','utf8').match(/^DATABASE_URL_UNPOOLED=(.+)$/m)[1].trim();
const sql = neon(url);

console.log('=== sku_catalog row for 00001-BK ===');
const cat = await sql`SELECT id, sku, product_title, category, upc, ean, gtin, is_active, created_at FROM sku_catalog WHERE sku = '00001-BK'`;
for (const r of cat) console.log(`  ${JSON.stringify(r)}`);

const catId = cat[0]?.id;
if (!catId) { console.log('Not found'); process.exit(0); }

console.log(`\n=== sku_platform_ids rows that map TO sku_catalog_id=${catId} ===`);
const platforms = await sql`
  SELECT id, platform, platform_sku, platform_item_id, account_name, display_name, is_active, created_at
    FROM sku_platform_ids
   WHERE sku_catalog_id = ${catId}
   ORDER BY platform, id
`;
console.log(`Count: ${platforms.length}`);
for (const r of platforms) {
  console.log(`  [${r.platform}] platform_sku='${r.platform_sku ?? '(null)'}'  item_id='${r.platform_item_id ?? '(null)'}'  display='${(r.display_name ?? '').slice(0,40)}'  active=${r.is_active}`);
}

console.log(`\n=== Open orders that reference this canonical SKU ===`);
const orders = await sql`
  SELECT o.id, o.order_id, o.account_source, o.sku AS platform_sku, o.status
    FROM orders o
   WHERE o.sku_catalog_id = ${catId}
     AND (o.status IS NULL OR o.status != 'shipped')
   ORDER BY o.id
`;
console.log(`Count: ${orders.length}`);
for (const r of orders) console.log(`  #${r.id}  ${r.order_id || '-'}  src=${r.account_source || '(null)'}  platform_sku='${r.platform_sku ?? '(null)'}'`);
