#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * One-shot Ecwid→sku_catalog bridging pipeline.
 *
 *   Tier 1: exact platform_sku = sku_catalog.sku
 *   Tier 2: pg_trgm similarity(product_title, display_name) >= AUTO_THRESHOLD
 *
 * Usage:
 *   node scripts/bridge-ecwid-to-catalog.js --dry-run   # preview only
 *   node scripts/bridge-ecwid-to-catalog.js             # commit
 *
 * Requires: pg_trgm extension + idx_sku_catalog_product_title_trgm.
 */
const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

// Trigram similarity is blind to model numbers (e.g. "Lifestyle V10" vs "V30"
// score 0.875 but are different products). Only auto-pair on exact title
// matches. Sub-1.0 candidates surface in the pairing UI as suggestions.
const AUTO_THRESHOLD = 1.0;
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set in .env');

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    console.log(`\n=== Ecwid → sku_catalog bridging ${DRY_RUN ? '(DRY-RUN)' : '(COMMIT)'} ===`);
    console.log(`Auto-pair threshold: similarity >= ${AUTO_THRESHOLD}\n`);

    // Safety: verify the trigram index exists
    const idx = await client.query(`
      SELECT indexname FROM pg_indexes
       WHERE tablename='sku_catalog' AND indexname='idx_sku_catalog_product_title_trgm'
    `);
    if (idx.rowCount === 0) {
      throw new Error('idx_sku_catalog_product_title_trgm missing — run the trigram index migration first.');
    }

    // Snapshot before
    const before = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE sku_catalog_id IS NOT NULL)::int AS paired,
        COUNT(*) FILTER (WHERE sku_catalog_id IS NULL)::int AS unpaired,
        COUNT(*)::int AS total
      FROM sku_platform_ids WHERE platform='ecwid'
    `);
    console.log('Ecwid rows BEFORE:');
    console.table(before.rows);

    await client.query('BEGIN');

    // ---------------- Tier 1: exact SKU match ----------------
    console.log('--- Tier 1: exact platform_sku = sku_catalog.sku ---');
    const tier1 = await client.query(`
      UPDATE sku_platform_ids p
         SET sku_catalog_id = sc.id
        FROM sku_catalog sc
       WHERE p.platform = 'ecwid'
         AND p.sku_catalog_id IS NULL
         AND p.platform_sku IS NOT NULL
         AND TRIM(p.platform_sku) = TRIM(sc.sku)
      RETURNING p.id, p.platform_sku
    `);
    console.log(`Tier 1 paired: ${tier1.rowCount}`);
    if (tier1.rowCount > 0) {
      console.log('Sample Tier 1 matches:');
      console.table(tier1.rows.slice(0, 5));
    }

    // ---------------- Tier 2: trigram ranking ----------------
    console.log('\n--- Tier 2: trigram similarity ranking ---');

    // Build best-candidate-per-ecwid-row using LATERAL with GIN-indexed % prefilter
    // similarity(a,b) requires pg_trgm — already verified index exists, so extension is present.
    const candidates = await client.query(`
      SELECT p.id AS spi_id,
             p.display_name,
             sc.id AS catalog_id,
             sc.sku AS catalog_sku,
             sc.product_title,
             similarity(sc.product_title, p.display_name) AS sim
        FROM sku_platform_ids p
        CROSS JOIN LATERAL (
          SELECT id, sku, product_title
            FROM sku_catalog
           WHERE product_title % p.display_name
           ORDER BY similarity(product_title, p.display_name) DESC
           LIMIT 1
        ) sc
       WHERE p.platform = 'ecwid'
         AND p.sku_catalog_id IS NULL
         AND p.display_name IS NOT NULL
         AND length(p.display_name) > 3
    `);

    console.log(`Ecwid rows with at least one trigram candidate: ${candidates.rowCount}`);

    // Histogram of best-candidate similarity scores
    const buckets = { '< 0.50': 0, '0.50–0.60': 0, '0.60–0.70': 0, '0.70–0.80': 0, '0.80–0.85': 0, '>= 0.85': 0 };
    for (const row of candidates.rows) {
      const s = Number(row.sim);
      if (s < 0.5) buckets['< 0.50']++;
      else if (s < 0.6) buckets['0.50–0.60']++;
      else if (s < 0.7) buckets['0.60–0.70']++;
      else if (s < 0.8) buckets['0.70–0.80']++;
      else if (s < 0.85) buckets['0.80–0.85']++;
      else buckets['>= 0.85']++;
    }
    console.log('Similarity histogram (best candidate per row):');
    console.table(buckets);

    // Apply auto-pair for >= threshold
    const autoPair = candidates.rows.filter((r) => Number(r.sim) >= AUTO_THRESHOLD);
    console.log(`\nEligible for auto-pair (>= ${AUTO_THRESHOLD}): ${autoPair.length}`);

    if (autoPair.length > 0) {
      // Spot-check: print 15 random pairs
      const sample = [...autoPair]
        .sort(() => Math.random() - 0.5)
        .slice(0, 15)
        .map((r) => ({
          ecwid_id: r.spi_id,
          ecwid_title: (r.display_name || '').slice(0, 55),
          zoho_sku: r.catalog_sku,
          zoho_title: (r.product_title || '').slice(0, 55),
          sim: Number(r.sim).toFixed(3),
        }));
      console.log('\nSpot check (15 random auto-pair candidates):');
      console.table(sample);

      if (!DRY_RUN) {
        // Apply updates in a single statement via unnest
        const spiIds = autoPair.map((r) => r.spi_id);
        const catIds = autoPair.map((r) => r.catalog_id);
        const result = await client.query(
          `UPDATE sku_platform_ids p
              SET sku_catalog_id = u.catalog_id
             FROM unnest($1::int[], $2::int[]) AS u(spi_id, catalog_id)
            WHERE p.id = u.spi_id AND p.sku_catalog_id IS NULL`,
          [spiIds, catIds],
        );
        console.log(`\nTier 2 applied: ${result.rowCount} rows paired.`);
      } else {
        console.log('\n(dry-run) Tier 2 pairings not applied.');
      }
    }

    // Sample of middle-confidence rows for the operator's future manual work
    const mid = candidates.rows.filter((r) => Number(r.sim) >= 0.6 && Number(r.sim) < AUTO_THRESHOLD);
    if (mid.length > 0) {
      const midSample = [...mid]
        .sort((a, b) => Number(b.sim) - Number(a.sim))
        .slice(0, 10)
        .map((r) => ({
          ecwid_id: r.spi_id,
          ecwid_title: (r.display_name || '').slice(0, 55),
          zoho_sku: r.catalog_sku,
          zoho_title: (r.product_title || '').slice(0, 55),
          sim: Number(r.sim).toFixed(3),
        }));
      console.log(`\nMid-confidence (0.60 – ${AUTO_THRESHOLD}): ${mid.length} rows. Top 10:`);
      console.table(midSample);
      console.log('These will surface via /api/sku-catalog/pair-suggestions in the UI.');
    }

    if (DRY_RUN) {
      await client.query('ROLLBACK');
      console.log('\n=== DRY-RUN ROLLED BACK — no changes persisted ===');
    } else {
      await client.query('COMMIT');
      console.log('\n=== COMMIT ===');
    }

    // Snapshot after
    const after = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE sku_catalog_id IS NOT NULL)::int AS paired,
        COUNT(*) FILTER (WHERE sku_catalog_id IS NULL)::int AS unpaired,
        COUNT(*)::int AS total
      FROM sku_platform_ids WHERE platform='ecwid'
    `);
    console.log('\nEcwid rows AFTER:');
    console.table(after.rows);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
