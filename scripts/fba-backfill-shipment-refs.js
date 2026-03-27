/**
 * Normalize `fba_shipments.shipment_ref` to `FBA-MM/DD/YY` from `due_date`
 * (same logic as src/lib/fba/plan-ref.ts buildFbaPlanRefFromIsoDate).
 *
 * If multiple shipments share the same `due_date`, the lowest `id` keeps the
 * canonical ref; others get `FBA-MM/DD/YY#<id>` so names stay unique.
 *
 * Usage:
 *   node scripts/fba-backfill-shipment-refs.js
 *   node scripts/fba-backfill-shipment-refs.js --apply
 */

const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local'), quiet: true });

const APPLY = process.argv.includes('--apply');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || 'postgres://localhost:5432/postgres',
  ssl: process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED ? { rejectUnauthorized: false } : false,
  options: '-c timezone=America/Los_Angeles',
});

function buildFbaPlanRefFromIsoDate(isoYmd) {
  const raw = String(isoYmd || '').trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return 'FBA-00/00/00';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!year || !month || !day) return 'FBA-00/00/00';
  const yy = String(year % 100).padStart(2, '0');
  return `FBA-${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${yy}`;
}

async function main() {
  console.log(`\n=== fba-backfill-shipment-refs (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);

  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT id, shipment_ref, due_date::text AS d
      FROM fba_shipments
      WHERE due_date IS NOT NULL
      ORDER BY due_date ASC, id ASC
    `);

    const byDue = new Map();
    for (const row of res.rows) {
      const key = String(row.d).slice(0, 10);
      if (!byDue.has(key)) byDue.set(key, []);
      byDue.get(key).push(row);
    }

    const updates = [];
    for (const [, rows] of byDue) {
      const base = buildFbaPlanRefFromIsoDate(rows[0].d);
      rows.sort((a, b) => Number(a.id) - Number(b.id));
      rows.forEach((row, i) => {
        const nextRef = rows.length > 1 && i > 0 ? `${base}#${row.id}` : base;
        if (String(row.shipment_ref) !== nextRef) {
          updates.push({ id: row.id, from: row.shipment_ref, to: nextRef });
        }
      });
    }

    if (updates.length === 0) {
      console.log('All shipment_ref values already match due_date format (or nothing to update).');
      return;
    }

    console.table(updates.slice(0, 50));
    if (updates.length > 50) console.log(`… and ${updates.length - 50} more rows.\n`);

    if (!APPLY) {
      console.log(`\nDry run: ${updates.length} row(s) would update. Re-run with --apply.\n`);
      return;
    }

    await client.query('BEGIN');
    for (const u of updates) {
      await client.query(`UPDATE fba_shipments SET shipment_ref = $1, updated_at = NOW() WHERE id = $2`, [
        u.to,
        u.id,
      ]);
    }
    await client.query('COMMIT');
    console.log(`\nUpdated ${updates.length} shipment(s).\n`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
