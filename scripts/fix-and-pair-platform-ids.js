#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Three-phase fix on sku_platform_ids:
 *   1. Normalize stale eBay/unknown rows so only account_name in
 *      ('Dragonh','MK','USAV') remains for eBay, and 'unknown' → 'amazon'.
 *      Preserve existing sku_catalog_id pairings by transferring to the
 *      matching CSV-imported row when possible.
 *
 *   2. Global pairing pass: link every row to sku_catalog where
 *      platform_sku = sku_catalog.sku. This covers eBay custom labels,
 *      Ecwid product SKUs, and Amazon seller SKUs that happen to match.
 *
 *   3. Amazon alternate-SKU pass: re-read Amazon.csv and try to pair
 *      any still-unpaired amazon row by matching ANY of the seller SKUs
 *      listed for its ASIN (rescues pairings for the 927 skipped variants
 *      by using their seller-sku info on the one imported row per ASIN).
 *
 * Usage: node scripts/fix-and-pair-platform-ids.js
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

// ---------- minimal RFC4180 CSV parser ----------
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];
  const header = rows.shift().map((h) => h.trim());
  return rows
    .filter((r) => r.some((v) => v && v.trim() !== ''))
    .map((r) => {
      const o = {};
      for (let i = 0; i < header.length; i++) o[header[i]] = (r[i] ?? '').trim();
      return o;
    });
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set in .env');

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    // =============================================================
    // PART 1: Normalize stale rows
    // =============================================================
    console.log('\n=== PART 1: Normalize stale eBay / unknown rows ===');
    await client.query('BEGIN');

    const stale = await client.query(`
      SELECT id, platform, account_name, platform_sku, platform_item_id, sku_catalog_id
        FROM sku_platform_ids
       WHERE (platform = 'ebay' AND (account_name NOT IN ('Dragonh','MK','USAV') OR account_name IS NULL))
          OR platform = 'unknown'
       ORDER BY platform, platform_item_id
    `);

    let transferred = 0;
    let deletedDupe = 0;
    let renamed = 0;
    let reclassified = 0;
    const flagged = [];

    const renameMap = { DRAGON: 'Dragonh', MEKONG: 'MK' };

    for (const row of stale.rows) {
      const targetPlatform = row.platform === 'unknown' ? 'amazon' : 'ebay';

      // Look for a CSV-imported counterpart on the canonical platform/account
      const csvQ =
        targetPlatform === 'amazon'
          ? `SELECT id, sku_catalog_id FROM sku_platform_ids
              WHERE platform = 'amazon' AND platform_item_id = $1 AND id <> $2
              LIMIT 1`
          : `SELECT id, sku_catalog_id FROM sku_platform_ids
              WHERE platform = 'ebay' AND platform_item_id = $1
                AND account_name IN ('Dragonh','MK','USAV') AND id <> $2
              LIMIT 1`;
      const csv = await client.query(csvQ, [row.platform_item_id, row.id]);

      if (csv.rows.length > 0) {
        const target = csv.rows[0];
        // Transfer the pairing if target is unpaired
        if (target.sku_catalog_id == null && row.sku_catalog_id != null) {
          await client.query(
            `UPDATE sku_platform_ids SET sku_catalog_id = $1 WHERE id = $2`,
            [row.sku_catalog_id, target.id],
          );
          transferred++;
        }
        // Reclassify unknown → amazon counts this path too (same outcome: merge into amazon)
        if (row.platform === 'unknown') reclassified++;
        await client.query(`DELETE FROM sku_platform_ids WHERE id = $1`, [row.id]);
        deletedDupe++;
        continue;
      }

      // No CSV counterpart — try to rename / reclassify in place
      if (row.platform === 'unknown') {
        // Reclassify to amazon if no conflict
        const conflict = await client.query(
          `SELECT id FROM sku_platform_ids
            WHERE platform = 'amazon' AND platform_item_id = $1 AND id <> $2`,
          [row.platform_item_id, row.id],
        );
        if (conflict.rows.length === 0) {
          await client.query(`UPDATE sku_platform_ids SET platform = 'amazon' WHERE id = $1`, [row.id]);
          reclassified++;
        } else {
          flagged.push(row);
        }
        continue;
      }

      // eBay: rename DRAGON → Dragonh, MEKONG → MK if no unique-index conflict
      const newAcct = renameMap[row.account_name];
      if (newAcct) {
        const conflict = await client.query(
          `SELECT id, sku_catalog_id FROM sku_platform_ids
            WHERE platform = 'ebay' AND platform_item_id = $1
              AND account_name = $2 AND id <> $3`,
          [row.platform_item_id, newAcct, row.id],
        );
        if (conflict.rows.length === 0) {
          await client.query(`UPDATE sku_platform_ids SET account_name = $1 WHERE id = $2`, [newAcct, row.id]);
          renamed++;
        } else {
          // Duplicate — merge sku_catalog_id onto the canonical row if it's unpaired, then drop stale
          const t = conflict.rows[0];
          if (t.sku_catalog_id == null && row.sku_catalog_id != null) {
            await client.query(`UPDATE sku_platform_ids SET sku_catalog_id = $1 WHERE id = $2`, [row.sku_catalog_id, t.id]);
            transferred++;
          }
          await client.query(`DELETE FROM sku_platform_ids WHERE id = $1`, [row.id]);
          deletedDupe++;
        }
        continue;
      }

      // Ambiguous (null / 'eBay') — cannot confidently assign an account
      flagged.push(row);
    }

    await client.query('COMMIT');
    console.log(`transferred=${transferred} deleted=${deletedDupe} renamed=${renamed} reclassified=${reclassified} flagged=${flagged.length}`);
    if (flagged.length) {
      console.log('\nFlagged rows (left untouched — ambiguous account or conflicting rename):');
      console.table(flagged.map(({ id, platform, account_name, platform_item_id, sku_catalog_id }) => ({ id, platform, account_name, platform_item_id, sku_catalog_id })));
    }

    // =============================================================
    // PART 2: Global platform_sku → sku_catalog.sku pairing
    // =============================================================
    console.log('\n=== PART 2: Global platform_sku → sku_catalog.sku pairing ===');
    const globalPair = await client.query(`
      UPDATE sku_platform_ids p
         SET sku_catalog_id = sc.id
        FROM sku_catalog sc
       WHERE p.platform_sku IS NOT NULL
         AND TRIM(p.platform_sku) = TRIM(sc.sku)
         AND p.sku_catalog_id IS NULL
      RETURNING p.platform
    `);
    const globalByPlatform = globalPair.rows.reduce((acc, r) => {
      acc[r.platform] = (acc[r.platform] || 0) + 1;
      return acc;
    }, {});
    console.log(`paired=${globalPair.rowCount}`);
    console.table(globalByPlatform);

    // =============================================================
    // PART 3: Amazon alternate seller-sku pass
    // =============================================================
    console.log('\n=== PART 3: Amazon alternate seller-sku pass ===');
    const amazonCsvPath = path.resolve(process.cwd(), 'public/platform to id/Amazon.csv');
    const amazonRows = parseCsv(fs.readFileSync(amazonCsvPath, 'utf8'));
    console.log(`Amazon.csv rows: ${amazonRows.length}`);

    // Build ASIN → list of alt seller-SKUs map
    const asinToSkus = new Map();
    for (const r of amazonRows) {
      const asin = (r['asin1'] || '').trim();
      const sku = (r['seller-sku'] || '').trim();
      if (!asin || !sku) continue;
      if (!asinToSkus.has(asin)) asinToSkus.set(asin, []);
      asinToSkus.get(asin).push(sku);
    }

    // Pre-load all sku_catalog SKUs into a Set for fast lookup
    const catalogSkus = await client.query(`SELECT id, sku FROM sku_catalog WHERE sku IS NOT NULL`);
    const skuToCatalogId = new Map();
    for (const r of catalogSkus.rows) skuToCatalogId.set(r.sku.trim(), r.id);

    // Find unpaired Amazon rows
    const unpaired = await client.query(`
      SELECT id, platform_item_id, platform_sku
        FROM sku_platform_ids
       WHERE platform = 'amazon' AND sku_catalog_id IS NULL AND platform_item_id IS NOT NULL
    `);
    console.log(`Unpaired amazon rows: ${unpaired.rowCount}`);

    let amazonPaired = 0;
    for (const row of unpaired.rows) {
      const asin = row.platform_item_id;
      const altSkus = asinToSkus.get(asin) || [];
      for (const sku of altSkus) {
        const catId = skuToCatalogId.get(sku);
        if (catId) {
          await client.query(
            `UPDATE sku_platform_ids SET sku_catalog_id = $1 WHERE id = $2`,
            [catId, row.id],
          );
          amazonPaired++;
          break;
        }
      }
    }
    console.log(`Amazon rows paired via alternate seller-sku: ${amazonPaired}`);

    // =============================================================
    // FINAL REPORT
    // =============================================================
    const stats = await client.query(`
      SELECT platform,
             COUNT(*) FILTER (WHERE sku_catalog_id IS NOT NULL)::int AS paired,
             COUNT(*) FILTER (WHERE sku_catalog_id IS NULL)::int AS unpaired,
             COUNT(*)::int AS total
        FROM sku_platform_ids
       GROUP BY platform
       ORDER BY platform
    `);
    console.log('\n=== FINAL sku_platform_ids PAIRING STATS ===');
    console.table(stats.rows);

    const accts = await client.query(`
      SELECT platform, account_name, COUNT(*)::int AS count
        FROM sku_platform_ids
       GROUP BY 1, 2
       ORDER BY 1, 2
    `);
    console.log('\n=== FINAL sku_platform_ids ACCOUNT BREAKDOWN ===');
    console.table(accts.rows);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
