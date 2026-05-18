#!/usr/bin/env node
/**
 * backfill-tech-serial-unit-id.mjs
 * ────────────────────────────────────────────────────────────────────
 * One-time migration: stamp tech_serial_numbers.serial_unit_id by linking
 * each TSN row to a serial_units master row.
 *
 * Strategy (per TSN row with serial_unit_id IS NULL):
 *   1. Normalize serial_number (BTRIM + UPPER).
 *   2. Skip rows with empty serials or serial_type='FNSKU' — those aren't
 *      physical-unit serials and shouldn't anchor a serial_units row.
 *   3. Find an existing serial_units row by normalized_serial. If hit,
 *      reuse its id. If miss, INSERT a new serial_units row with
 *      current_status='UNKNOWN' and origin_source='legacy_tsn_backfill'.
 *   4. UPDATE tech_serial_numbers.serial_unit_id = resolved id.
 *
 * Idempotent: re-running only touches rows that still have NULL FK.
 * Safe: never modifies an existing serial_units row's lifecycle state — only
 *       fills FKs on TSN rows.
 *
 * Usage:
 *   node scripts/backfill-tech-serial-unit-id.mjs [--dry-run] [--limit N] [--batch-size N]
 *
 * Flags:
 *   --dry-run        Print actions; no writes.
 *   --limit N        Process at most N rows (default: no limit).
 *   --batch-size N   Commit every N rows (default: 500).
 * ────────────────────────────────────────────────────────────────────
 */
import 'dotenv/config';
import pg from 'pg';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const limit = readNumberFlag('--limit');
const batchSize = readNumberFlag('--batch-size') ?? 500;

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function readNumberFlag(name) {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function normalize(serial) {
  return String(serial ?? '').trim().toUpperCase();
}

async function main() {
  console.log(dryRun ? '=== DRY RUN ===' : '=== LIVE RUN ===');
  console.log(`batch_size=${batchSize}${limit ? ` limit=${limit}` : ''}`);

  const countQ = await pool.query(`
    SELECT COUNT(*)::int AS n
    FROM tech_serial_numbers tsn
    WHERE tsn.serial_unit_id IS NULL
      AND tsn.serial_number IS NOT NULL
      AND BTRIM(tsn.serial_number) <> ''
      AND COALESCE(UPPER(tsn.serial_type), 'SERIAL') <> 'FNSKU'
  `);
  const totalCandidates = countQ.rows[0]?.n ?? 0;
  console.log(`Candidates with NULL serial_unit_id: ${totalCandidates}`);
  if (totalCandidates === 0) {
    console.log('Nothing to do.');
    await pool.end();
    return;
  }

  const targetLimit = limit ? Math.min(limit, totalCandidates) : totalCandidates;
  console.log(`Target this run: ${targetLimit}\n`);

  let processed = 0;
  let reused = 0;
  let created = 0;
  let skipped = 0;
  let offset = 0;

  while (processed < targetLimit) {
    const remaining = targetLimit - processed;
    const fetchSize = Math.min(batchSize, remaining);

    // tech_serial_numbers has no sku column — pull it from the legacy sku
    // table via source_sku_id when available so the serial_units upsert
    // can fill in sku for legacy rows.
    const rowsQ = await pool.query(
      `
      SELECT tsn.id, tsn.serial_number, s.static_sku AS sku, tsn.scan_ref, tsn.station_source
      FROM tech_serial_numbers tsn
      LEFT JOIN sku s ON s.id = tsn.source_sku_id
      WHERE tsn.serial_unit_id IS NULL
        AND tsn.serial_number IS NOT NULL
        AND BTRIM(tsn.serial_number) <> ''
        AND COALESCE(UPPER(tsn.serial_type), 'SERIAL') <> 'FNSKU'
      ORDER BY tsn.id ASC
      LIMIT $1 OFFSET $2
      `,
      [fetchSize, offset],
    );

    if (rowsQ.rows.length === 0) break;

    const client = await pool.connect();
    try {
      if (!dryRun) await client.query('BEGIN');

      for (const row of rowsQ.rows) {
        const normalized = normalize(row.serial_number);
        if (!normalized) {
          skipped += 1;
          continue;
        }

        // 1. Try existing serial_units row.
        const found = await client.query(
          'SELECT id FROM serial_units WHERE normalized_serial = $1 LIMIT 1',
          [normalized],
        );

        let serialUnitId;
        if (found.rows.length > 0) {
          serialUnitId = found.rows[0].id;
          reused += 1;
        } else {
          // 2. Insert. ON CONFLICT to handle race against another writer.
          const inserted = await client.query(
            `
            INSERT INTO serial_units (
              serial_number, normalized_serial, sku,
              current_status, origin_source, origin_tsn_id
            )
            VALUES ($1, $2, $3, 'UNKNOWN'::serial_status_enum, 'legacy_tsn_backfill', $4)
            ON CONFLICT (normalized_serial) DO UPDATE SET
              -- Fill-in only; never clobber lifecycle state another writer set.
              origin_tsn_id = COALESCE(serial_units.origin_tsn_id, EXCLUDED.origin_tsn_id),
              sku = COALESCE(serial_units.sku, EXCLUDED.sku)
            RETURNING id
            `,
            [row.serial_number, normalized, row.sku ?? null, row.id],
          );
          serialUnitId = inserted.rows[0].id;
          created += 1;
        }

        // 3. Stamp the TSN FK.
        if (!dryRun) {
          await client.query(
            'UPDATE tech_serial_numbers SET serial_unit_id = $1 WHERE id = $2 AND serial_unit_id IS NULL',
            [serialUnitId, row.id],
          );
        }

        processed += 1;
        if (processed % 100 === 0) {
          process.stdout.write(`  processed=${processed} reused=${reused} created=${created} skipped=${skipped}\r`);
        }
        if (processed >= targetLimit) break;
      }

      if (!dryRun) {
        await client.query('COMMIT');
      } else {
        await client.query('ROLLBACK');
      }
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch {}
      console.error('\nBatch failed:', err.message);
      throw err;
    } finally {
      client.release();
    }

    offset += rowsQ.rows.length;
    // If we processed fewer than fetchSize, the next page will be empty —
    // exit early.
    if (rowsQ.rows.length < fetchSize) break;
  }

  console.log('\n');
  console.log(`Done. processed=${processed} reused=${reused} created=${created} skipped=${skipped}`);
  if (dryRun) console.log('(dry-run — no writes committed)');

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
