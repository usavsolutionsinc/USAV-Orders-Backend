/**
 * Mirrors the resolve endpoint's SQL chain so we can verify each path
 * against real data without spinning up a Next.js dev server / session.
 */
import pool from '../src/lib/db';

async function resolve(sku: string, platform: string | null) {
  // Step 1: direct sku_catalog match
  let row = (await pool.query<{ id: number; sku: string; product_title: string | null }>(
    `SELECT id, sku, product_title FROM sku_catalog WHERE sku = $1 LIMIT 1`,
    [sku],
  )).rows[0];
  let how = 'direct';

  // Step 2: scoped platform_sku
  if (!row && platform) {
    const r = await pool.query<{ id: number; sku: string; product_title: string | null }>(
      `SELECT sc.id, sc.sku, sc.product_title
         FROM sku_platform_ids spi
         JOIN sku_catalog sc ON sc.id = spi.sku_catalog_id
        WHERE spi.platform_sku = $1
          AND LOWER(spi.platform) = LOWER($2)
          AND spi.sku_catalog_id IS NOT NULL
        LIMIT 2`,
      [sku, platform],
    );
    if (r.rows.length === 1) { row = r.rows[0]; how = 'scoped'; }
  }

  // Step 3: unscoped, only if unambiguous
  if (!row) {
    const r = await pool.query<{ id: number; sku: string; product_title: string | null }>(
      `SELECT sc.id, sc.sku, sc.product_title
         FROM sku_platform_ids spi
         JOIN sku_catalog sc ON sc.id = spi.sku_catalog_id
        WHERE spi.platform_sku = $1
          AND spi.sku_catalog_id IS NOT NULL
        LIMIT 2`,
      [sku],
    );
    if (r.rows.length === 1) { row = r.rows[0]; how = 'unscoped'; }
  }

  if (!row) {
    console.log(`  sku='${sku}' platform='${platform || ''}' → UNRESOLVED`);
    return;
  }

  const platforms = (await pool.query(
    `SELECT platform, platform_sku, platform_item_id
       FROM sku_platform_ids
      WHERE sku_catalog_id = $1
        AND is_active = true
        AND (platform_sku IS NOT NULL OR platform_item_id IS NOT NULL)
      ORDER BY platform ASC`,
    [row.id],
  )).rows;

  console.log(`  sku='${sku}' platform='${platform || ''}' → ${row.sku} (${how})`);
  console.log(`    title: ${row.product_title}`);
  for (const p of platforms) console.log(`    [${p.platform}] ${p.platform_sku || '(no sku)'}  ${p.platform_item_id || ''}`);
}

async function main() {
  console.log('Test 1 — Direct match (input IS the canonical):');
  await resolve('00001-BK', null);

  console.log('\nTest 2 — Scoped match (ecwid platform_sku):');
  await resolve('01279-B', 'ecwid');

  console.log('\nTest 3 — Mixed case (eBay vs ebay):');
  await resolve('01279-B', 'Ecwid');

  console.log('\nTest 4 — Amazon MSKU:');
  await resolve('ZB-AFHB-Y58D', 'Amazon');

  console.log('\nTest 5 — Unscoped fallback (platform=null):');
  await resolve('01279-B', null);

  console.log('\nTest 6 — Unresolvable sku:');
  await resolve('ZZZ-NOT-A-SKU', null);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
