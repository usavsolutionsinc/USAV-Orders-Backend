/**
 * Collapse pending FBA rows by FNSKU using existing tables only.
 *
 * No new tables are created. For each FNSKU that exists in multiple non-shipped
 * shipments, this script:
 * 1) Picks one canonical pending row (most actionable + most recent).
 * 2) Sums expected_qty + actual_qty into canonical row.
 * 3) Normalizes status to READY_TO_GO > PACKING > PLANNED.
 * 4) Re-points fba_fnsku_logs.fba_shipment_item_id to canonical item id.
 * 5) Deletes duplicate fba_shipment_items rows.
 * 6) Recomputes shipment counters/status on affected shipments.
 *
 * Usage:
 *   node scripts/fba-collapse-pending-by-fnsku.js          # dry run
 *   node scripts/fba-collapse-pending-by-fnsku.js --apply  # execute
 */

const path = require('path');
const { Pool } = require('pg');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local'), quiet: true });

const APPLY = process.argv.includes('--apply');

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || 'postgres://localhost:5432/postgres',
  ssl: process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED ? { rejectUnauthorized: false } : false,
});

const STATUS_ORDER = ['READY_TO_GO', 'PACKING', 'PLANNED'];
const STATUS_RANK = {
  READY_TO_GO: 0,
  LABEL_ASSIGNED: 0,
  PACKING: 1,
  PLANNED: 2,
  OUT_OF_STOCK: 2,
};

function normalizeMergedStatus(statuses) {
  let best = 'PLANNED';
  let bestRank = STATUS_RANK[best];
  for (const raw of statuses) {
    const s = String(raw || '').toUpperCase();
    const rank = STATUS_RANK[s] ?? 9;
    if (rank < bestRank) {
      best = STATUS_ORDER.includes(s) ? s : s === 'LABEL_ASSIGNED' ? 'READY_TO_GO' : 'PLANNED';
      bestRank = rank;
    }
  }
  return best;
}

async function recomputeShipments(client, shipmentIds) {
  if (!shipmentIds.length) return;
  await client.query(
    `UPDATE fba_shipments fs
     SET ready_item_count   = counts.ready_item_count,
         packed_item_count  = counts.packed_item_count,
         shipped_item_count = counts.shipped_item_count,
         status             = CASE
                                WHEN counts.total_item_count = 0
                                  THEN 'PLANNED'::fba_shipment_status_enum
                                WHEN counts.shipped_item_count = counts.total_item_count
                                  THEN 'SHIPPED'::fba_shipment_status_enum
                                WHEN counts.planned_item_count = 0
                                  AND counts.ready_to_go_item_count = 0
                                  AND counts.labeled_item_count > 0
                                  THEN 'LABEL_ASSIGNED'::fba_shipment_status_enum
                                WHEN counts.planned_item_count = 0
                                  THEN 'READY_TO_GO'::fba_shipment_status_enum
                                ELSE 'PLANNED'::fba_shipment_status_enum
                              END,
         updated_at         = NOW()
     FROM (
       SELECT
         shipment_id,
         COUNT(*)::int AS total_item_count,
         COUNT(*) FILTER (WHERE status IN ('READY_TO_GO', 'LABEL_ASSIGNED', 'SHIPPED'))::int AS ready_item_count,
         COUNT(*) FILTER (WHERE status IN ('LABEL_ASSIGNED', 'SHIPPED'))::int AS packed_item_count,
         COUNT(*) FILTER (WHERE status = 'SHIPPED')::int AS shipped_item_count,
         COUNT(*) FILTER (WHERE status = 'PLANNED')::int AS planned_item_count,
         COUNT(*) FILTER (WHERE status = 'READY_TO_GO')::int AS ready_to_go_item_count,
         COUNT(*) FILTER (WHERE status = 'LABEL_ASSIGNED')::int AS labeled_item_count
       FROM fba_shipment_items
       WHERE shipment_id = ANY($1::int[])
       GROUP BY shipment_id
     ) counts
     WHERE fs.id = counts.shipment_id`,
    [shipmentIds]
  );
}

async function main() {
  const client = await pool.connect();
  try {
    const duplicatesRes = await client.query(
      `WITH dup AS (
         SELECT
           UPPER(TRIM(i.fnsku)) AS fnsku_key,
           COUNT(*)::int AS row_count,
           COUNT(DISTINCT i.shipment_id)::int AS shipment_count
         FROM fba_shipment_items i
         JOIN fba_shipments s ON s.id = i.shipment_id
         WHERE i.status != 'SHIPPED'
           AND s.status != 'SHIPPED'
         GROUP BY UPPER(TRIM(i.fnsku))
         HAVING COUNT(DISTINCT i.shipment_id) > 1
       )
       SELECT fnsku_key
       FROM dup
       ORDER BY fnsku_key`
    );

    if (duplicatesRes.rows.length === 0) {
      console.log('No duplicate pending FNSKUs across shipments. Nothing to collapse.');
      return;
    }

    const plans = [];

    for (const row of duplicatesRes.rows) {
      const fnsku = String(row.fnsku_key || '');
      const rowsRes = await client.query(
        `SELECT
           i.id AS item_id,
           i.shipment_id,
           i.fnsku,
           i.expected_qty::int AS expected_qty,
           i.actual_qty::int AS actual_qty,
           i.status::text AS item_status,
           i.updated_at AS item_updated_at,
           s.due_date,
           s.updated_at AS shipment_updated_at
         FROM fba_shipment_items i
         JOIN fba_shipments s ON s.id = i.shipment_id
         WHERE UPPER(TRIM(i.fnsku)) = $1
           AND i.status != 'SHIPPED'
           AND s.status != 'SHIPPED'
         ORDER BY
           CASE i.status
             WHEN 'READY_TO_GO' THEN 0
             WHEN 'LABEL_ASSIGNED' THEN 0
             WHEN 'PACKING' THEN 1
             WHEN 'PLANNED' THEN 2
             WHEN 'OUT_OF_STOCK' THEN 2
             ELSE 9
           END ASC,
           COALESCE(i.updated_at, s.updated_at) DESC NULLS LAST,
           s.due_date DESC NULLS LAST,
           s.id DESC,
           i.id DESC`,
        [fnsku]
      );
      if (rowsRes.rows.length <= 1) continue;

      const canonical = rowsRes.rows[0];
      const others = rowsRes.rows.slice(1);
      const mergedExpected = rowsRes.rows.reduce((sum, r) => sum + Math.max(0, Number(r.expected_qty) || 0), 0);
      const mergedActual = rowsRes.rows.reduce((sum, r) => sum + Math.max(0, Number(r.actual_qty) || 0), 0);
      const mergedStatus = normalizeMergedStatus(rowsRes.rows.map((r) => String(r.item_status || 'PLANNED')));

      plans.push({
        fnsku,
        canonicalItemId: Number(canonical.item_id),
        canonicalShipmentId: Number(canonical.shipment_id),
        mergedExpected,
        mergedActual,
        mergedStatus,
        removeItemIds: others.map((r) => Number(r.item_id)),
        affectedShipmentIds: Array.from(new Set(rowsRes.rows.map((r) => Number(r.shipment_id)))),
      });
    }

    if (plans.length === 0) {
      console.log('No merge actions computed after row inspection.');
      return;
    }

    console.table(
      plans.map((p) => ({
        fnsku: p.fnsku,
        canonical_item_id: p.canonicalItemId,
        canonical_shipment_id: p.canonicalShipmentId,
        merged_expected: p.mergedExpected,
        merged_actual: p.mergedActual,
        merged_status: p.mergedStatus,
        removed_rows: p.removeItemIds.length,
      }))
    );

    if (!APPLY) {
      console.log('Dry run only. Re-run with --apply to execute.');
      return;
    }

    await client.query('BEGIN');
    const allAffectedShipments = new Set();
    let removedRows = 0;
    let repointedLogs = 0;

    for (const p of plans) {
      await client.query(
        `UPDATE fba_shipment_items
         SET expected_qty = $1,
             actual_qty = $2,
             status = $3::fba_shipment_status_enum,
             updated_at = NOW()
         WHERE id = $4`,
        [p.mergedExpected, p.mergedActual, p.mergedStatus, p.canonicalItemId]
      );

      if (p.removeItemIds.length > 0) {
        const logsRes = await client.query(
          `UPDATE fba_fnsku_logs
           SET fba_shipment_item_id = $1,
               fba_shipment_id = $2
           WHERE fba_shipment_item_id = ANY($3::int[])`,
          [p.canonicalItemId, p.canonicalShipmentId, p.removeItemIds]
        );
        repointedLogs += Number(logsRes.rowCount || 0);

        const delRes = await client.query(
          `DELETE FROM fba_shipment_items
           WHERE id = ANY($1::int[])`,
          [p.removeItemIds]
        );
        removedRows += Number(delRes.rowCount || 0);
      }

      for (const sid of p.affectedShipmentIds) allAffectedShipments.add(sid);
    }

    await recomputeShipments(client, Array.from(allAffectedShipments));
    await client.query('COMMIT');

    console.log(
      `Applied collapse: fnsku_groups=${plans.length}, removed_rows=${removedRows}, repointed_logs=${repointedLogsSafe(
        repointedLogs
      )}, affected_shipments=${allAffectedShipments.size}`
    );
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    console.error(error?.message || error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

function repointedLogsSafe(value) {
  return Number.isFinite(value) ? value : 0;
}

main();
