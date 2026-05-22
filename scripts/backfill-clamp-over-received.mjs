/**
 * One-shot: clamp receiving_lines rows where quantity_received > quantity_expected,
 * and detach the extra serial_units that originated from those over-received lines
 * (origin_receiving_line_id → NULL). Prints affected rows, asks for confirmation
 * before writing.
 *
 * Usage:
 *   node scripts/backfill-clamp-over-received.mjs           # dry-run (prints, no writes)
 *   node scripts/backfill-clamp-over-received.mjs --apply   # actually update + detach
 *
 * Why this exists: before the FOR UPDATE race fix in receiveLineUnits, two
 * concurrent scans on the same line could both pass the OverReceive guard
 * and end up at e.g. 2/1. New scans can't reach that state anymore; this
 * script cleans up the residue. Safe to re-run.
 */

import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing in env');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: url,
  connectionTimeoutMillis: 15000,
  max: 1,
  ssl: { rejectUnauthorized: false },
});

function fmt(rows) {
  if (rows.length === 0) return '  (none)';
  return rows
    .map(
      (r) =>
        `  line ${String(r.id).padStart(7)}  rcv ${String(r.receiving_id ?? '-').padStart(6)}  ` +
        `rcv=${r.quantity_received}  exp=${r.quantity_expected}  sku=${r.sku ?? '-'}  ` +
        `“${(r.item_name ?? '').slice(0, 40)}”`,
    )
    .join('\n');
}

const client = await pool.connect();
try {
  // 1. Find every over-received line.
  const lines = await client.query(`
    SELECT id, receiving_id, sku, item_name, quantity_received, quantity_expected
    FROM receiving_lines
    WHERE quantity_expected IS NOT NULL
      AND quantity_received > quantity_expected
    ORDER BY receiving_id NULLS LAST, id ASC
  `);

  console.log(`\nOver-received receiving_lines: ${lines.rowCount}`);
  console.log(fmt(lines.rows));

  if (lines.rowCount === 0) {
    console.log('\nNothing to clamp. Exiting.');
    process.exit(0);
  }

  // 2. For each over-received line, identify the surplus serial_units. Keep the
  //    EARLIEST `quantity_expected` rows; detach the rest (origin_receiving_line_id
  //    → NULL). They aren't deleted — the serial still exists in inventory,
  //    just no longer counts toward this receiving line.
  let totalDetach = 0;
  const detachPerLine = [];
  for (const line of lines.rows) {
    const keep = line.quantity_expected;
    const surplus = await client.query(
      `SELECT id, serial_number, created_at
         FROM serial_units
        WHERE origin_receiving_line_id = $1
        ORDER BY created_at ASC, id ASC
        OFFSET $2`,
      [line.id, keep],
    );
    if (surplus.rowCount > 0) {
      detachPerLine.push({ line_id: line.id, ids: surplus.rows.map((r) => r.id) });
      totalDetach += surplus.rowCount;
    }
  }
  console.log(
    `\nSurplus serial_units to detach (origin_receiving_line_id → NULL): ${totalDetach}`,
  );
  for (const entry of detachPerLine) {
    console.log(`  line ${entry.line_id}: ${entry.ids.join(', ')}`);
  }

  if (!APPLY) {
    console.log('\nDRY RUN — re-run with --apply to write changes.');
    process.exit(0);
  }

  console.log('\nApplying changes…');
  await client.query('BEGIN');

  // Clamp the qty.
  const clamp = await client.query(
    `UPDATE receiving_lines
        SET quantity_received = quantity_expected,
            updated_at = NOW()
      WHERE quantity_expected IS NOT NULL
        AND quantity_received > quantity_expected
      RETURNING id, quantity_received, quantity_expected`,
  );
  console.log(`  clamped ${clamp.rowCount} receiving_lines rows`);

  // Detach surplus serials. Single big array param so we issue one query.
  const allIds = detachPerLine.flatMap((e) => e.ids);
  if (allIds.length > 0) {
    const detach = await client.query(
      `UPDATE serial_units
          SET origin_receiving_line_id = NULL,
              updated_at = NOW()
        WHERE id = ANY($1::int[])`,
      [allIds],
    );
    console.log(`  detached ${detach.rowCount} serial_units`);
  }

  await client.query('COMMIT');
  console.log('\nDone.');
} catch (err) {
  try {
    await client.query('ROLLBACK');
  } catch {
    /* ignore */
  }
  console.error('Backfill failed:', err);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
