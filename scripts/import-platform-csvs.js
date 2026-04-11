#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Bulk import marketplace CSVs into sku_platform_ids.
 *
 * All rows are inserted unpaired (sku_catalog_id = NULL). Pairing is done
 * later via the existing UI/upsertSkuPlatformId claim-row flow.
 *
 * Idempotent: relies on the existing partial unique indexes
 *   - ux_sku_platform_ids_platform_sku   (platform, platform_sku, account_name)
 *   - ux_sku_platform_ids_platform_item  (platform, platform_item_id, account_name)
 * with ON CONFLICT DO NOTHING.
 *
 * Usage: node scripts/import-platform-csvs.js
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

// ---------- tiny RFC4180 CSV parser (handles quotes, CRLF, BOM) ----------
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
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
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  // flush last field/row
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];
  const header = rows.shift().map((h) => h.trim());
  return rows
    .filter((r) => r.some((v) => v && v.trim() !== ''))
    .map((r) => {
      const obj = {};
      for (let i = 0; i < header.length; i++) obj[header[i]] = (r[i] ?? '').trim();
      return obj;
    });
}

const norm = (v) => {
  const s = (v ?? '').toString().trim();
  return s.length > 0 ? s : null;
};

// ---------- file → row mapping ----------
const FILES = [
  {
    path: 'public/platform to id/Amazon.csv',
    label: 'Amazon',
    map: (r) => ({
      platform: 'amazon',
      account_name: null, // single seller
      platform_sku: norm(r['seller-sku']),
      platform_item_id: norm(r['asin1']),
      display_name: norm(r['item-name']),
      image_url: null,
    }),
  },
  {
    path: 'public/platform to id/eBay-Dragonh.csv',
    label: 'eBay-Dragonh',
    map: (r) => ({
      platform: 'ebay',
      account_name: 'Dragonh',
      platform_sku: norm(r['Custom label (SKU)']),
      platform_item_id: norm(r['Item number']),
      display_name: norm(r['Title']),
      image_url: null,
    }),
  },
  {
    path: 'public/platform to id/eBay-MK.csv',
    label: 'eBay-MK',
    map: (r) => ({
      platform: 'ebay',
      account_name: 'MK',
      platform_sku: norm(r['Custom label (SKU)']),
      platform_item_id: norm(r['Item number']),
      display_name: norm(r['Title']),
      image_url: null,
    }),
  },
  {
    path: 'public/platform to id/eBay-USAV.csv',
    label: 'eBay-USAV',
    map: (r) => ({
      platform: 'ebay',
      account_name: 'USAV',
      platform_sku: null, // file has no Custom label column
      platform_item_id: norm(r['Item number']),
      display_name: norm(r['Title']),
      image_url: null,
    }),
  },
  {
    path: 'public/platform to id/Ecwid.csv',
    label: 'Ecwid',
    map: (r) => ({
      platform: 'ecwid',
      account_name: null,
      platform_sku: norm(r['product_sku']),
      platform_item_id: norm(r['product_internal_id']),
      display_name: norm(r['product_name']),
      image_url: norm(r['product_media_main_image_url']),
    }),
  },
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set in .env');

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const summary = [];
  try {
    for (const file of FILES) {
      const abs = path.resolve(process.cwd(), file.path);
      if (!fs.existsSync(abs)) {
        console.warn(`[skip] missing file: ${file.path}`);
        summary.push({ file: file.label, read: 0, inserted: 0, skipped: 0, noKey: 0, missing: true });
        continue;
      }

      const text = fs.readFileSync(abs, 'utf8');
      const rows = parseCsv(text);
      let inserted = 0;
      let skipped = 0; // conflict / duplicate
      let noKey = 0;   // no usable identifier

      for (const raw of rows) {
        const row = file.map(raw);
        if (!row.platform_sku && !row.platform_item_id) { noKey++; continue; }

        const res = await client.query(
          `INSERT INTO sku_platform_ids
             (sku_catalog_id, platform, platform_sku, platform_item_id, account_name, display_name, image_url, is_active)
           VALUES (NULL, $1, $2, $3, $4, $5, $6, true)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [row.platform, row.platform_sku, row.platform_item_id, row.account_name, row.display_name, row.image_url],
        );
        if (res.rowCount > 0) inserted++;
        else skipped++;
      }

      console.log(
        `[${file.label}] read=${rows.length} inserted=${inserted} skipped(dup)=${skipped} noKey=${noKey}`,
      );
      summary.push({ file: file.label, read: rows.length, inserted, skipped, noKey, missing: false });
    }

    console.log('\n=== SUMMARY ===');
    console.table(summary);

    const finalCounts = await client.query(
      `SELECT platform, account_name, COUNT(*)::int AS count
         FROM sku_platform_ids
        GROUP BY 1, 2
        ORDER BY 1, 2`,
    );
    console.log('\n=== sku_platform_ids CURRENT COUNTS ===');
    console.table(finalCounts.rows);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
