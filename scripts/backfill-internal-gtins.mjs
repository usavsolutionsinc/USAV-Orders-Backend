#!/usr/bin/env node
/**
 * backfill-internal-gtins.mjs
 * ────────────────────────────────────────────────────────────────────
 * One-time migration: stamp an internal pseudo-GTIN-14 on every
 * sku_catalog row that doesn't already have one.
 *
 * Format (mirrors src/lib/inventory/internal-gtin.ts):
 *   "02" + 11-digit zero-padded sku_catalog.id + GS1 mod-10 check digit
 *
 * Idempotent: re-running only processes rows where gtin IS NULL or ''.
 * Concurrency-safe vs the live route (/api/units/next-id), which uses
 * the same COALESCE-on-conflict pattern.
 *
 * Usage:
 *   node scripts/backfill-internal-gtins.mjs              # apply
 *   node scripts/backfill-internal-gtins.mjs --dry-run    # preview
 *   node scripts/backfill-internal-gtins.mjs --limit 100  # cap
 * ────────────────────────────────────────────────────────────────────
 */
import 'dotenv/config';
import pg from 'pg';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const limitArg = argv.indexOf('--limit');
const limit = limitArg >= 0 ? Math.max(1, Number(argv[limitArg + 1]) || 0) : null;

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const INTERNAL_GTIN_PREFIX = '02';

function gs1CheckDigit(body13) {
  if (body13.length !== 13 || !/^\d{13}$/.test(body13)) {
    throw new Error(`gs1CheckDigit: body must be 13 digits, got "${body13}"`);
  }
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    const digit = Number(body13[12 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return String((10 - (sum % 10)) % 10);
}

function generateInternalGtin(skuCatalogId) {
  const idPart = String(skuCatalogId).padStart(11, '0');
  const body = INTERNAL_GTIN_PREFIX + idPart;
  return body + gs1CheckDigit(body);
}

async function main() {
  console.log(dryRun ? '=== DRY RUN ===' : '=== LIVE RUN ===');

  // 1. Count candidates.
  const candidatesQ = await pool.query(
    `SELECT COUNT(*)::int AS n FROM sku_catalog WHERE gtin IS NULL OR BTRIM(gtin) = ''`,
  );
  const candidateCount = candidatesQ.rows[0]?.n ?? 0;
  console.log(`Candidates (sku_catalog rows without gtin): ${candidateCount}`);
  if (candidateCount === 0) {
    console.log('Nothing to do.');
    await pool.end();
    return;
  }

  const target = limit ? Math.min(limit, candidateCount) : candidateCount;
  console.log(`Target this run: ${target}\n`);

  // 2. Fetch the ids to stamp. We do this in one shot since sku_catalog
  //    is small (thousands of rows max) and we want a stable batch even
  //    if /api/units/next-id is concurrently writing.
  const idsQ = await pool.query(
    `SELECT id, sku FROM sku_catalog
       WHERE gtin IS NULL OR BTRIM(gtin) = ''
       ORDER BY id ASC
       LIMIT $1`,
    [target],
  );

  let stamped = 0;
  let conflicts = 0; // /api/units/next-id beat us to it — expected, not an error
  let failed = 0;

  for (const row of idsQ.rows) {
    const candidate = generateInternalGtin(row.id);
    if (dryRun) {
      console.log(`  · #${row.id} (${row.sku || '?'})  →  ${candidate}  (dry-run)`);
      stamped += 1;
      continue;
    }
    try {
      const result = await pool.query(
        `UPDATE sku_catalog
            SET gtin = COALESCE(NULLIF(gtin, ''), $1),
                updated_at = NOW()
          WHERE id = $2
          RETURNING gtin`,
        [candidate, row.id],
      );
      const finalGtin = result.rows[0]?.gtin;
      if (finalGtin === candidate) {
        stamped += 1;
      } else {
        conflicts += 1;
      }
      if ((stamped + conflicts) % 100 === 0) {
        process.stdout.write(`  stamped=${stamped} conflicts=${conflicts}\r`);
      }
    } catch (err) {
      failed += 1;
      console.error(`  ✗ #${row.id} (${row.sku || '?'})  ${err.message}`);
    }
  }

  console.log('\n');
  console.log(`Done. stamped=${stamped} conflicts=${conflicts} failed=${failed}`);

  // 3. Quick verify: how many remain unstamped?
  if (!dryRun) {
    const remaining = await pool.query(
      `SELECT COUNT(*)::int AS n FROM sku_catalog WHERE gtin IS NULL OR BTRIM(gtin) = ''`,
    );
    console.log(`Remaining without gtin: ${remaining.rows[0]?.n ?? '?'}`);
  } else {
    console.log('(dry-run — no writes committed)');
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
