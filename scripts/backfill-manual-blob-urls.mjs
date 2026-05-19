#!/usr/bin/env node
/**
 * Backfill product_manuals rows for the PDFs uploaded to Vercel Blob under
 * the `manuals/` prefix (see scripts/convert-and-upload-manuals.mjs).
 *
 * For each Blob object we insert a product_manuals row with:
 *   - source_url     = the Blob public URL
 *   - relative_path  = path under `manuals/` (e.g. "Controller/Bose ... SA-4.pdf")
 *   - folder_path    = dirname of relative_path
 *   - file_name      = basename of relative_path
 *   - display_name   = derived from the deepest folder + filename
 *   - product_title  = derived from the last 2 folders
 *   - item_number    = first 5-digit number extracted from the path (if any),
 *                       kept as a hint for the operator only — not used to auto-link
 *   - sku_catalog_id = NULL (operators link via the existing manuals admin UI)
 *   - type           = 'manual'
 *   - status         = 'unassigned' (always — see note below)
 *   - is_active      = true
 *
 * We deliberately do NOT auto-assign sku_catalog_id from a 5-digit number in
 * the folder path. The folder codes are a mix of legitimate USAV SKUs and Bose
 * model numbers that happen to collide with unrelated SKUs (e.g. folder code
 * 00004 references a Bose Wave system, but USAV SKU 00004 is a wall bracket).
 * Operators must confirm the mapping manually.
 *
 * Idempotent: relies on the partial unique index
 *   ux_product_manuals_active_relative_path (relative_path) WHERE is_active = true
 * so re-running upserts existing rows instead of duplicating.
 *
 * Usage:
 *   node scripts/backfill-manual-blob-urls.mjs [--dry] [--limit=N]
 */

import { config as loadEnv } from 'dotenv';
import { list } from '@vercel/blob';
import pg from 'pg';
import { basename, dirname } from 'node:path';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

const BLOB_PREFIX = 'manuals/';
const ITEM_NUMBER_RE = /\b(\d{5})\b/g;

function parseArgs(argv) {
  const out = { dryRun: false, limit: Infinity };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry') out.dryRun = true;
    else if (arg.startsWith('--limit=')) out.limit = Math.max(1, Number(arg.slice('--limit='.length)) || Infinity);
  }
  return out;
}

function normalizeItemNumber(raw) {
  return (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function deriveDisplayName(relativePath) {
  const parts = relativePath.split('/').map((p) => p.trim()).filter(Boolean);
  const fileNameWithExt = parts.pop() ?? '';
  const stem = fileNameWithExt.replace(/\.pdf$/i, '').replace(/\s+/g, ' ').trim();
  const lastFolder = parts.length ? parts[parts.length - 1].replace(/\s+/g, ' ').trim() : '';
  if (!lastFolder) return stem;
  // Skip the prefix if the filename already mentions the folder verbatim.
  if (stem.toLowerCase().includes(lastFolder.toLowerCase())) return stem;
  return `${lastFolder} — ${stem}`;
}

function deriveProductTitle(relativePath) {
  const folders = relativePath.split('/').slice(0, -1).map((p) => p.trim()).filter(Boolean);
  if (folders.length === 0) return null;
  if (folders.length === 1) return folders[0];
  return folders.slice(-2).join(' / ');
}

function extractItemNumber(relativePath) {
  // Walk folders deepest → shallowest, return the first 5-digit number found.
  // Skips the filename portion to avoid false hits on titles like "AV35".
  const folders = relativePath.split('/').slice(0, -1);
  for (let i = folders.length - 1; i >= 0; i--) {
    const matches = folders[i].match(ITEM_NUMBER_RE);
    if (matches && matches.length) return matches[0];
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('BLOB_READ_WRITE_TOKEN is not set. Add it to .env.local or .env.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  console.log('Listing Blob objects under manuals/ ...');
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix: BLOB_PREFIX, limit: 1000, cursor });
    blobs.push(...page.blobs);
    cursor = page.cursor;
  } while (cursor);
  console.log(`Found ${blobs.length} Blob objects`);

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 4,
  });

  let inserted = 0;
  let updated = 0;
  let processed = 0;

  for (const blob of blobs) {
    if (processed >= args.limit) break;
    const relativePath = blob.pathname.startsWith(BLOB_PREFIX)
      ? blob.pathname.slice(BLOB_PREFIX.length)
      : blob.pathname;
    if (!relativePath || !/\.pdf$/i.test(relativePath)) continue;

    const sourceUrl = blob.url;
    const folderPath = dirname(relativePath);
    const fileName = basename(relativePath);
    const displayName = deriveDisplayName(relativePath);
    const productTitle = deriveProductTitle(relativePath);
    const itemNumber = extractItemNumber(relativePath);

    if (args.dryRun) {
      processed++;
      if (processed <= 10) {
        console.log(`[dry] item=${(itemNumber || '-').padEnd(5)} title="${productTitle ?? ''}" :: ${displayName}`);
      }
      continue;
    }

    const result = await pool.query(
      `INSERT INTO product_manuals
         (sku, item_number, sku_catalog_id, source_url, relative_path, folder_path, file_name,
          product_title, display_name, type, status, is_active, updated_at, created_at)
       VALUES
         (NULL, $1, NULL, $2, $3, $4, $5, $6, $7, 'manual', 'unassigned', TRUE, NOW(), NOW())
       ON CONFLICT (relative_path) WHERE is_active = TRUE AND relative_path IS NOT NULL
       DO UPDATE SET
         source_url     = EXCLUDED.source_url,
         folder_path    = EXCLUDED.folder_path,
         file_name      = EXCLUDED.file_name,
         product_title  = COALESCE(product_manuals.product_title, EXCLUDED.product_title),
         display_name   = COALESCE(NULLIF(BTRIM(product_manuals.display_name), ''), EXCLUDED.display_name),
         item_number    = COALESCE(NULLIF(BTRIM(product_manuals.item_number), ''), EXCLUDED.item_number),
         updated_at     = NOW()
       RETURNING (xmax = 0) AS is_insert`,
      [itemNumber, sourceUrl, relativePath, folderPath, fileName, productTitle, displayName],
    );

    if (result.rows[0]?.is_insert) inserted++;
    else updated++;
    processed++;

    if (processed % 50 === 0) {
      process.stdout.write(`\r  processed ${processed}/${blobs.length}`.padEnd(50));
    }
  }

  await pool.end();

  console.log('');
  console.log(`\nProcessed: ${processed}`);
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Updated:  ${updated}`);
  console.log('  All rows status=unassigned — link to SKUs via the manuals admin UI.');
  if (args.dryRun) console.log('\n(dry run — no rows written)');
}

main().catch((err) => {
  console.error('\nBackfill failed:', err?.stack ?? err);
  process.exit(1);
});
