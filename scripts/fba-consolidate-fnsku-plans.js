/**
 * Merge duplicate FNSKU lines across **PLANNED** shipments (`fba_shipments.status = PLANNED`)
 * into the shipment with the **latest `due_date`**, summing `expected_qty` and `actual_qty`,
 * and promoting `status` to the most advanced lifecycle value among merged rows.
 *
 * Inspects real schema at runtime (`--inspect`). Default item filter: **PLANNED** line items
 * only (safe). Use `--include-active-items` to also merge duplicates where some rows are
 * PACKING / READY_TO_GO / etc. (non-SHIPPED) — use with care.
 *
 * Usage:
 *   node scripts/fba-consolidate-fnsku-plans.js --inspect   # ping DB, columns, dup preview
 *   node scripts/fba-consolidate-fnsku-plans.js             # dry run merge (PLANNED items)
 *   node scripts/fba-consolidate-fnsku-plans.js --apply     # execute
 *   node scripts/fba-consolidate-fnsku-plans.js --include-active-items [--apply]  # loose filter
 */

const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local'), quiet: true });

const APPLY = process.argv.includes('--apply');
const INSPECT = process.argv.includes('--inspect');
/** When true, merge any non-SHIPPED item rows; default is PLANNED line items only. */
const INCLUDE_ACTIVE = process.argv.includes('--include-active-items');

const ITEM_FILTER_SQL = INCLUDE_ACTIVE
  ? `fsi.status <> 'SHIPPED'::fba_shipment_status_enum`
  : `fsi.status = 'PLANNED'::fba_shipment_status_enum`;

/** Aligns with pg `fba_shipment_status_enum` enumsortorder — higher = later in pipeline */
const STATUS_RANK = {
  PLANNED: 1,
  OUT_OF_STOCK: 1.25,
  PACKING: 1.5,
  READY_TO_GO: 2,
  LABEL_ASSIGNED: 3,
  SHIPPED: 4,
};

function maxStatus(statuses) {
  let best = statuses[0];
  let bestR = STATUS_RANK[best] ?? 0;
  for (const s of statuses) {
    const r = STATUS_RANK[s] ?? 0;
    if (r > bestR) {
      best = s;
      bestR = r;
    }
  }
  return best;
}

function formatDue(d) {
  if (d == null) return '';
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  const s = String(d);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || 'postgres://localhost:5432/postgres',
  ssl: process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED ? { rejectUnauthorized: false } : false,
  options: '-c timezone=America/Los_Angeles',
});

function maskUrl(u) {
  try {
    const x = new URL(u);
    if (x.password) x.password = '***';
    return x.toString();
  } catch {
    return '(invalid URL)';
  }
}

async function inspectDb(client) {
  console.log('--- Connection ---');
  console.log('DATABASE_URL:', maskUrl(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || ''));
  const v = await client.query('SELECT current_database() AS db, current_user AS usr, version() AS v');
  console.table([{ db: v.rows[0].db, user: v.rows[0].usr, pg: String(v.rows[0].v).split('\n')[0] }]);

  const cols = await client.query(`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('fba_shipments', 'fba_shipment_items')
    ORDER BY table_name, ordinal_position
  `);
  console.log('\n--- information_schema (fba_shipments, fba_shipment_items) ---');
  console.table(cols.rows);

  const counts = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM fba_shipments) AS fba_shipments,
      (SELECT COUNT(*)::int FROM fba_shipment_items) AS fba_shipment_items
  `);
  console.log('\n--- row counts ---');
  console.table(counts.rows);

  const dupStrict = await client.query(`
    SELECT fsi.fnsku, COUNT(DISTINCT fsi.shipment_id)::int AS ship_count
    FROM fba_shipment_items fsi
    JOIN fba_shipments fs ON fs.id = fsi.shipment_id
    WHERE fs.status = 'PLANNED' AND fsi.status = 'PLANNED'
    GROUP BY fsi.fnsku
    HAVING COUNT(DISTINCT fsi.shipment_id) > 1
    ORDER BY fsi.fnsku
  `);

  const dupLoose = await client.query(`
    SELECT fsi.fnsku, COUNT(DISTINCT fsi.shipment_id)::int AS ship_count,
           array_agg(DISTINCT fsi.status::text ORDER BY fsi.status::text) AS item_statuses
    FROM fba_shipment_items fsi
    JOIN fba_shipments fs ON fs.id = fsi.shipment_id
    WHERE fs.status = 'PLANNED' AND fsi.status <> 'SHIPPED'::fba_shipment_status_enum
    GROUP BY fsi.fnsku
    HAVING COUNT(DISTINCT fsi.shipment_id) > 1
    ORDER BY fsi.fnsku
  `);

  console.log('\n--- duplicate FNSKU (PLANNED shipment + item status = PLANNED only) ---');
  console.table(dupStrict.rows);
  console.log(
    `--- duplicate FNSKU (PLANNED shipment + item not SHIPPED) [merge with --include-active-items] ---`
  );
  console.table(dupLoose.rows);

  const sample = await client.query(`
    SELECT fsi.id, fsi.shipment_id, fsi.fnsku, fsi.expected_qty, fsi.actual_qty, fsi.status::text AS item_status,
           fs.shipment_ref, fs.due_date::text, fs.status::text AS ship_status
    FROM fba_shipment_items fsi
    JOIN fba_shipments fs ON fs.id = fsi.shipment_id
    WHERE fs.status = 'PLANNED'
    ORDER BY fsi.fnsku, fs.due_date DESC NULLS LAST
    LIMIT 15
  `);
  console.log('\n--- sample lines (PLANNED shipments only, 15 rows) ---');
  console.table(sample.rows);
}

async function main() {
  const client = await pool.connect();

  try {
    if (INSPECT) {
      console.log(`\n=== fba-consolidate-fnsku-plans (INSPECT) ===\n`);
      await inspectDb(client);
      console.log('\nDone. Run without --inspect for merge dry run / --apply.\n');
      return;
    }

    console.log(`\n=== fba-consolidate-fnsku-plans (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);
    console.log(
      INCLUDE_ACTIVE
        ? 'Item filter: non-SHIPPED rows on PLANNED shipments (--include-active-items).\n'
        : 'Item filter: PLANNED line items only (pass --include-active-items for PACKING/READY/… duplicates).\n'
    );

    const dupes = await client.query(`
      SELECT fsi.fnsku
      FROM fba_shipment_items fsi
      JOIN fba_shipments fs ON fs.id = fsi.shipment_id
      WHERE fs.status = 'PLANNED' AND ${ITEM_FILTER_SQL}
      GROUP BY fsi.fnsku
      HAVING COUNT(DISTINCT fsi.shipment_id) > 1
      ORDER BY fsi.fnsku
    `);

    if (dupes.rows.length === 0) {
      console.log('No FNSKUs split across multiple PLANNED shipments for this filter. Nothing to do.');
      console.log('Tip: node scripts/fba-consolidate-fnsku-plans.js --inspect\n');
      return;
    }

    const actions = [];

    for (const { fnsku } of dupes.rows) {
      const targetRes = await client.query(
        `
        SELECT fs.id AS shipment_id, fsi.id AS item_id,
               fsi.expected_qty::int AS expected_qty,
               fsi.actual_qty::int AS actual_qty,
               fsi.status::text AS item_status,
               fs.shipment_ref, fs.created_at, fs.due_date
        FROM fba_shipments fs
        JOIN fba_shipment_items fsi ON fsi.shipment_id = fs.id AND fsi.fnsku = $1
        WHERE fs.status = 'PLANNED' AND ${ITEM_FILTER_SQL}
        ORDER BY fs.due_date DESC NULLS LAST, fs.created_at DESC NULLS LAST, fs.id DESC
        LIMIT 1
        `,
        [fnsku]
      );
      if (targetRes.rows.length === 0) continue;

      const target = targetRes.rows[0];
      const targetSid = Number(target.shipment_id);
      const targetItemId = Number(target.item_id);

      const othersRes = await client.query(
        `
        SELECT fsi.id, fsi.expected_qty::int AS expected_qty, fsi.actual_qty::int AS actual_qty,
               fsi.status::text AS item_status,
               fs.shipment_ref, fs.id AS shipment_id, fs.due_date::text AS due_date
        FROM fba_shipment_items fsi
        JOIN fba_shipments fs ON fs.id = fsi.shipment_id
        WHERE fsi.fnsku = $1 AND fsi.shipment_id <> $2
          AND fs.status = 'PLANNED'
          AND ${ITEM_FILTER_SQL}
        ORDER BY fsi.id
        `,
        [fnsku, targetSid]
      );

      if (othersRes.rows.length === 0) continue;

      const allExpected =
        Math.max(0, Number(target.expected_qty) || 0) +
        othersRes.rows.reduce((s, r) => s + Math.max(0, Number(r.expected_qty) || 0), 0);
      const allActual =
        Math.max(0, Number(target.actual_qty) || 0) +
        othersRes.rows.reduce((s, r) => s + Math.max(0, Number(r.actual_qty) || 0), 0);
      const statuses = [
        String(target.item_status),
        ...othersRes.rows.map((r) => String(r.item_status)),
      ];
      const mergedStatus = maxStatus(statuses);
      const otherIds = othersRes.rows.map((r) => Number(r.id));

      actions.push({
        fnsku,
        keepShipRef: target.shipment_ref,
        keepDueDate: target.due_date,
        keepShipmentId: targetSid,
        keepItemId: targetItemId,
        targetQtyBefore: Number(target.expected_qty) || 0,
        newExpectedQty: allExpected,
        newActualQty: allActual,
        mergedStatus,
        removeItemIds: otherIds,
        removeRefs: othersRes.rows.map((r) => r.shipment_ref),
      });
    }

    if (actions.length === 0) {
      console.log('No merge actions computed.');
      return;
    }

    console.table(
      actions.map((a) => ({
        fnsku: a.fnsku,
        keep_due_date: formatDue(a.keepDueDate),
        keep_plan: a.keepShipRef,
        merge_exp_in: a.newExpectedQty - a.targetQtyBefore,
        new_expected_qty: a.newExpectedQty,
        new_actual_qty: a.newActualQty,
        status: a.mergedStatus,
        remove_rows: a.removeItemIds.length,
      }))
    );

    if (!APPLY) {
      console.log('\nDry run only — no changes. Re-run with --apply to execute.\n');
      return;
    }

    await client.query('BEGIN');

    let removed = 0;
    for (const a of actions) {
      if (a.removeItemIds.length === 0) continue;
      await client.query(
        `DELETE FROM work_assignments
         WHERE entity_type = 'FBA_SHIPMENT' AND entity_id = ANY($1::int[])`,
        [a.removeItemIds]
      );
      const del = await client.query(
        `DELETE FROM fba_shipment_items WHERE id = ANY($1::int[]) RETURNING id`,
        [a.removeItemIds]
      );
      removed += del.rowCount ?? 0;

      await client.query(
        `UPDATE fba_shipment_items
         SET expected_qty = $1::int,
             actual_qty = $2::int,
             status = $3::fba_shipment_status_enum,
             updated_at = NOW()
         WHERE id = $4`,
        [a.newExpectedQty, a.newActualQty, a.mergedStatus, a.keepItemId]
      );
      await client.query(`UPDATE fba_shipments SET updated_at = NOW() WHERE id = $1`, [a.keepShipmentId]);
    }

    await client.query('COMMIT');
    console.log(`\nApplied: merged ${actions.length} FNSKU group(s), deleted ${removed} duplicate item row(s).\n`);
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
