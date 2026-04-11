#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * One-pass backfill populating the serial_units master from historical
 * tech_serial_numbers and sku rows, then stamping the FK back on every
 * source row.
 *
 * Relaxed mode: never throws on a bad row. Swallows the error, counts
 * it, moves on. Safe to re-run — every write uses ON CONFLICT DO UPDATE
 * keyed on normalized_serial and every FK stamp is idempotent (updates
 * only WHERE serial_unit_id IS NULL).
 *
 * Usage:
 *   node scripts/backfill-serial-units.js              # all passes, from scratch
 *   node scripts/backfill-serial-units.js --dry-run    # count without writes
 *   node scripts/backfill-serial-units.js --resume     # continue from state file
 *   node scripts/backfill-serial-units.js --pass=1     # single pass (1|2|3)
 *
 * Passes:
 *   1. receiving-origin TSN rows (station_source='RECEIVING')
 *   2. ship/test-origin TSN rows (everything else)
 *   3. sku table rows (serial_number IS NOT NULL)
 *
 * Report: logs/backfill-serial-units-YYYY-MM-DD.json
 * Checkpoint: .backfill-serial-units.state.json (gitignored)
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

const BATCH_SIZE = Number(process.env.BACKFILL_BATCH_SIZE || 1000);
const STATE_FILE = path.resolve(
  process.cwd(),
  '.backfill-serial-units.state.json',
);
const LOG_DIR = path.resolve(process.cwd(), 'logs');

// ─── CLI + state ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { dryRun: false, resume: false, pass: null };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--resume') args.resume = true;
    else if (a.startsWith('--pass=')) args.pass = Number(a.slice(7));
  }
  return args;
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { pass1_last_id: 0, pass2_last_id: 0, pass3_last_id: 0 };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function normalizeSerial(raw) {
  return String(raw || '').trim().toUpperCase();
}

// ─── Core upsert (mirrors upsertSerialUnit relaxed rules, SQL-native) ───────

/**
 * Idempotent upsert into serial_units. Returns { id, is_new }.
 * On conflict: COALESCE-fills nulls on the existing row and only advances
 * status if the row was still UNKNOWN.
 */
async function upsertSerialUnit(client, row) {
  const normalized = normalizeSerial(row.serial_number);
  if (!normalized) return null;

  const result = await client.query(
    `INSERT INTO serial_units (
       serial_number, normalized_serial, sku, sku_catalog_id, zoho_item_id,
       current_status, origin_source,
       origin_receiving_line_id, origin_tsn_id, origin_sku_id,
       received_at, received_by, metadata
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6::serial_status_enum, $7,
       $8, $9, $10,
       $11, $12, $13::jsonb
     )
     ON CONFLICT (normalized_serial) DO UPDATE SET
       sku = COALESCE(serial_units.sku, EXCLUDED.sku),
       sku_catalog_id = COALESCE(serial_units.sku_catalog_id, EXCLUDED.sku_catalog_id),
       zoho_item_id = COALESCE(serial_units.zoho_item_id, EXCLUDED.zoho_item_id),
       current_status = CASE
         WHEN serial_units.current_status = 'UNKNOWN'
           THEN EXCLUDED.current_status
         ELSE serial_units.current_status
       END,
       origin_source = COALESCE(serial_units.origin_source, EXCLUDED.origin_source),
       origin_receiving_line_id = COALESCE(serial_units.origin_receiving_line_id, EXCLUDED.origin_receiving_line_id),
       origin_tsn_id = COALESCE(serial_units.origin_tsn_id, EXCLUDED.origin_tsn_id),
       origin_sku_id = COALESCE(serial_units.origin_sku_id, EXCLUDED.origin_sku_id),
       received_at = COALESCE(serial_units.received_at, EXCLUDED.received_at),
       received_by = COALESCE(serial_units.received_by, EXCLUDED.received_by),
       metadata = serial_units.metadata || EXCLUDED.metadata,
       updated_at = NOW()
     RETURNING id, (xmax = 0) AS is_new`,
    [
      row.serial_number,
      normalized,
      row.sku ?? null,
      row.sku_catalog_id ?? null,
      row.zoho_item_id ?? null,
      row.target_status,
      row.origin_source,
      row.origin_receiving_line_id ?? null,
      row.origin_tsn_id ?? null,
      row.origin_sku_id ?? null,
      row.received_at ?? null,
      row.received_by ?? null,
      JSON.stringify({
        backfilled: true,
        via: row.pass_label,
        at: new Date().toISOString(),
      }),
    ],
  );
  return result.rows[0];
}

// ─── Pass 1: receiving-origin TSN rows ──────────────────────────────────────

async function runPass1Receiving(client, state, opts) {
  console.log('\n── Pass 1: receiving-origin TSN rows ──');
  const counts = { scanned: 0, upserted: 0, new: 0, stamped: 0, skipped: 0, failed: 0 };
  let lastId = opts.resume ? state.pass1_last_id || 0 : 0;

  while (true) {
    const batch = await client.query(
      `SELECT tsn.id              AS tsn_id,
              tsn.serial_number,
              tsn.tested_by,
              tsn.receiving_line_id,
              tsn.created_at,
              rl.sku,
              rl.zoho_item_id,
              sc.id               AS sku_catalog_id
       FROM tech_serial_numbers tsn
       LEFT JOIN receiving_lines rl ON rl.id = tsn.receiving_line_id
       LEFT JOIN sku_catalog sc ON sc.sku = rl.sku
       WHERE tsn.station_source = 'RECEIVING'
         AND tsn.serial_unit_id IS NULL
         AND tsn.id > $1
       ORDER BY tsn.id
       LIMIT $2`,
      [lastId, BATCH_SIZE],
    );
    if (batch.rows.length === 0) break;

    for (const row of batch.rows) {
      counts.scanned++;
      try {
        if (opts.dryRun) {
          counts.upserted++;
          continue;
        }

        const upsert = await upsertSerialUnit(client, {
          serial_number: row.serial_number,
          sku: row.sku,
          sku_catalog_id: row.sku_catalog_id,
          zoho_item_id: row.zoho_item_id,
          target_status: 'RECEIVED',
          origin_source: 'receiving',
          origin_receiving_line_id: row.receiving_line_id,
          origin_tsn_id: row.tsn_id,
          received_at: row.created_at,
          received_by: row.tested_by,
          pass_label: 'pass1_receiving',
        });
        if (!upsert) {
          counts.skipped++;
          continue;
        }
        counts.upserted++;
        if (upsert.is_new) counts.new++;

        const stamp = await client.query(
          `UPDATE tech_serial_numbers
           SET serial_unit_id = $1
           WHERE id = $2 AND serial_unit_id IS NULL`,
          [upsert.id, row.tsn_id],
        );
        if ((stamp.rowCount || 0) > 0) counts.stamped++;
      } catch (err) {
        counts.failed++;
        console.warn(`  ! pass1 tsn_id=${row.tsn_id}: ${err.message}`);
      }
    }

    lastId = batch.rows[batch.rows.length - 1].tsn_id;
    state.pass1_last_id = lastId;
    if (!opts.dryRun) saveState(state);
    console.log(
      `  pass1 last_id=${lastId}  scanned=${counts.scanned}  upserted=${counts.upserted}  stamped=${counts.stamped}`,
    );
  }

  console.log(`  pass1 done → ${JSON.stringify(counts)}`);
  return counts;
}

// ─── Pass 2: ship/test-origin TSN rows ──────────────────────────────────────

async function runPass2TsnShip(client, state, opts) {
  console.log('\n── Pass 2: ship/test-origin TSN rows ──');
  const counts = { scanned: 0, upserted: 0, new: 0, stamped: 0, skipped: 0, failed: 0 };
  let lastId = opts.resume ? state.pass2_last_id || 0 : 0;

  while (true) {
    const batch = await client.query(
      `SELECT tsn.id           AS tsn_id,
              tsn.serial_number,
              tsn.tested_by,
              tsn.shipment_id,
              tsn.fba_shipment_id,
              tsn.orders_exception_id,
              tsn.created_at
       FROM tech_serial_numbers tsn
       WHERE (tsn.station_source IS NULL OR tsn.station_source != 'RECEIVING')
         AND tsn.serial_unit_id IS NULL
         AND tsn.id > $1
       ORDER BY tsn.id
       LIMIT $2`,
      [lastId, BATCH_SIZE],
    );
    if (batch.rows.length === 0) break;

    for (const row of batch.rows) {
      counts.scanned++;
      try {
        if (opts.dryRun) {
          counts.upserted++;
          continue;
        }

        const isShipped =
          row.shipment_id != null || row.fba_shipment_id != null;
        const targetStatus = isShipped ? 'SHIPPED' : 'TESTED';

        const upsert = await upsertSerialUnit(client, {
          serial_number: row.serial_number,
          target_status: targetStatus,
          origin_source: 'tsn',
          origin_tsn_id: row.tsn_id,
          received_by: row.tested_by,
          pass_label: 'pass2_tsn_ship',
        });
        if (!upsert) {
          counts.skipped++;
          continue;
        }
        counts.upserted++;
        if (upsert.is_new) counts.new++;

        const stamp = await client.query(
          `UPDATE tech_serial_numbers
           SET serial_unit_id = $1
           WHERE id = $2 AND serial_unit_id IS NULL`,
          [upsert.id, row.tsn_id],
        );
        if ((stamp.rowCount || 0) > 0) counts.stamped++;
      } catch (err) {
        counts.failed++;
        console.warn(`  ! pass2 tsn_id=${row.tsn_id}: ${err.message}`);
      }
    }

    lastId = batch.rows[batch.rows.length - 1].tsn_id;
    state.pass2_last_id = lastId;
    if (!opts.dryRun) saveState(state);
    console.log(
      `  pass2 last_id=${lastId}  scanned=${counts.scanned}  upserted=${counts.upserted}  stamped=${counts.stamped}`,
    );
  }

  console.log(`  pass2 done → ${JSON.stringify(counts)}`);
  return counts;
}

// ─── Pass 3: sku table rows ─────────────────────────────────────────────────

async function runPass3Sku(client, state, opts) {
  console.log('\n── Pass 3: sku table rows ──');
  const counts = { scanned: 0, upserted: 0, new: 0, stamped: 0, skipped: 0, failed: 0 };
  let lastId = opts.resume ? state.pass3_last_id || 0 : 0;

  while (true) {
    const batch = await client.query(
      `SELECT s.id,
              s.static_sku,
              s.serial_number,
              s.location,
              s.date_time,
              sc.id AS sku_catalog_id
       FROM sku s
       LEFT JOIN sku_catalog sc ON sc.sku = s.static_sku
       WHERE s.serial_unit_id IS NULL
         AND s.serial_number IS NOT NULL
         AND TRIM(s.serial_number) != ''
         AND s.id > $1
       ORDER BY s.id
       LIMIT $2`,
      [lastId, BATCH_SIZE],
    );
    if (batch.rows.length === 0) break;

    for (const row of batch.rows) {
      counts.scanned++;
      try {
        if (opts.dryRun) {
          counts.upserted++;
          continue;
        }

        const upsert = await upsertSerialUnit(client, {
          serial_number: row.serial_number,
          sku: row.static_sku,
          sku_catalog_id: row.sku_catalog_id,
          target_status: row.location ? 'STOCKED' : 'UNKNOWN',
          origin_source: 'sku',
          origin_sku_id: row.id,
          pass_label: 'pass3_sku',
        });
        if (!upsert) {
          counts.skipped++;
          continue;
        }
        counts.upserted++;
        if (upsert.is_new) counts.new++;

        const stamp = await client.query(
          `UPDATE sku
           SET serial_unit_id = $1
           WHERE id = $2 AND serial_unit_id IS NULL`,
          [upsert.id, row.id],
        );
        if ((stamp.rowCount || 0) > 0) counts.stamped++;
      } catch (err) {
        counts.failed++;
        console.warn(`  ! pass3 sku_id=${row.id}: ${err.message}`);
      }
    }

    lastId = batch.rows[batch.rows.length - 1].id;
    state.pass3_last_id = lastId;
    if (!opts.dryRun) saveState(state);
    console.log(
      `  pass3 last_id=${lastId}  scanned=${counts.scanned}  upserted=${counts.upserted}  stamped=${counts.stamped}`,
    );
  }

  console.log(`  pass3 done → ${JSON.stringify(counts)}`);
  return counts;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);
  const state = opts.resume ? loadState() : {};

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required (set it in .env)');
    process.exit(1);
  }

  console.log('serial_units backfill');
  console.log(`  mode: ${opts.dryRun ? 'DRY RUN' : 'WRITE'}`);
  console.log(`  resume: ${opts.resume ? 'yes' : 'no'}`);
  console.log(`  pass: ${opts.pass || 'all'}`);
  console.log(`  batch size: ${BATCH_SIZE}`);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const report = {
    started_at: new Date().toISOString(),
    dry_run: opts.dryRun,
    resume: opts.resume,
    pass_filter: opts.pass,
    batch_size: BATCH_SIZE,
    passes: {},
  };

  try {
    if (!opts.pass || opts.pass === 1) {
      report.passes.pass1 = await runPass1Receiving(client, state, opts);
    }
    if (!opts.pass || opts.pass === 2) {
      report.passes.pass2 = await runPass2TsnShip(client, state, opts);
    }
    if (!opts.pass || opts.pass === 3) {
      report.passes.pass3 = await runPass3Sku(client, state, opts);
    }
  } catch (err) {
    report.fatal_error = err instanceof Error ? err.message : String(err);
    console.error('\nFATAL:', err);
  } finally {
    await client.end();
  }

  report.ended_at = new Date().toISOString();

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const dateKey = new Date().toISOString().slice(0, 10);
  const logPath = path.join(LOG_DIR, `backfill-serial-units-${dateKey}.json`);
  const existing = fs.existsSync(logPath)
    ? JSON.parse(fs.readFileSync(logPath, 'utf8'))
    : { runs: [] };
  if (!Array.isArray(existing.runs)) existing.runs = [];
  existing.runs.push(report);
  fs.writeFileSync(logPath, JSON.stringify(existing, null, 2));

  console.log(`\nReport appended to: ${logPath}`);
  if (report.fatal_error) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
