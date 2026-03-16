/**
 * check-completed-by-packer-integrity.js
 *
 * Verifies the completed_by_packer_id column is consistent across
 * work_assignments, packer_logs, and orders.
 *
 * Also surfaces the "non-scannable gap": orders whose PACK WA is DONE
 * but have no packer_logs row — meaning the pending view's packer_logs
 * EXISTS filter would still show them as pending.
 *
 * Usage:
 *   node scripts/check-completed-by-packer-integrity.js
 *   node scripts/check-completed-by-packer-integrity.js --fix
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED });
const FIX_MODE = process.argv.includes('--fix');

let totalIssues = 0;
function issue(n) { totalIssues += n; return n; }

async function run() {
  console.log(`\n=== completed_by_packer_id integrity check (${FIX_MODE ? 'FIX' : 'READ-ONLY'}) ===\n`);

  // ─────────────────────────────────────────────────────────────────────────
  // Check 1: Column exists
  // ─────────────────────────────────────────────────────────────────────────
  const colCheck = await pool.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'work_assignments' AND column_name = 'completed_by_packer_id'
  `);
  if (colCheck.rows.length === 0) {
    console.error('[FATAL] completed_by_packer_id column is missing. Run the migration first.');
    process.exit(1);
  }
  console.log('[CHECK 1] Column exists:', JSON.stringify(colCheck.rows[0]));

  // ─────────────────────────────────────────────────────────────────────────
  // Check 2: PACK DONE rows missing completed_by_packer_id
  //          (can be backfilled from packer_logs where shipment_id matches)
  // ─────────────────────────────────────────────────────────────────────────
  const missingPacker = await pool.query(`
    SELECT wa.id, wa.entity_id, wa.assigned_packer_id, wa.completed_at,
           o.shipment_id,
           pl.packed_by AS packer_logs_packed_by
    FROM work_assignments wa
    LEFT JOIN orders o ON o.id = wa.entity_id AND wa.entity_type = 'ORDER'
    LEFT JOIN LATERAL (
      SELECT packed_by FROM packer_logs
      WHERE shipment_id IS NOT NULL AND shipment_id = o.shipment_id
      ORDER BY created_at DESC LIMIT 1
    ) pl ON true
    WHERE wa.work_type  = 'PACK'
      AND wa.status     = 'DONE'
      AND wa.completed_by_packer_id IS NULL
    ORDER BY wa.id DESC
    LIMIT 200
  `);
  console.log(`\n[CHECK 2] PACK/DONE rows missing completed_by_packer_id: ${missingPacker.rows.length}`);

  if (missingPacker.rows.length > 0) {
    issue(missingPacker.rows.length);

    // Partition: can vs cannot backfill
    const canBackfill   = missingPacker.rows.filter(r => r.packer_logs_packed_by ?? r.assigned_packer_id);
    const cannotBackfill = missingPacker.rows.filter(r => !(r.packer_logs_packed_by ?? r.assigned_packer_id));

    console.log(`  → Can backfill (packer_logs.packed_by OR assigned_packer_id present): ${canBackfill.length}`);
    console.log(`  → Cannot backfill (no source): ${cannotBackfill.length}`);

    if (FIX_MODE && canBackfill.length > 0) {
      // Prefer packer_logs.packed_by (physical scan actor); fall back to assigned_packer_id
      const ids = canBackfill.map(r => r.id);
      await pool.query(`
        UPDATE work_assignments wa
        SET completed_by_packer_id = COALESCE(
          (SELECT pl.packed_by FROM packer_logs pl
           JOIN orders o ON o.id = wa.entity_id AND wa.entity_type = 'ORDER'
           WHERE pl.shipment_id IS NOT NULL AND pl.shipment_id = o.shipment_id
           ORDER BY pl.created_at DESC LIMIT 1),
          wa.assigned_packer_id
        ),
        updated_at = NOW()
        WHERE id = ANY($1::int[])
          AND completed_by_packer_id IS NULL
      `, [ids]);
      console.log(`  [FIX] Backfilled completed_by_packer_id on ${canBackfill.length} rows.`);
    }
  } else {
    console.log('  ✓ All PACK/DONE rows have completed_by_packer_id.');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Check 3: Non-PACK rows with completed_by_packer_id set (shouldn't exist)
  // ─────────────────────────────────────────────────────────────────────────
  const wrongType = await pool.query(`
    SELECT id, entity_type, work_type, status, completed_by_packer_id
    FROM work_assignments
    WHERE work_type != 'PACK'
      AND completed_by_packer_id IS NOT NULL
    LIMIT 50
  `);
  console.log(`\n[CHECK 3] Non-PACK rows with completed_by_packer_id set: ${wrongType.rows.length}`);
  if (wrongType.rows.length > 0) {
    issue(wrongType.rows.length);
    console.table(wrongType.rows);
    if (FIX_MODE) {
      await pool.query(`
        UPDATE work_assignments SET completed_by_packer_id = NULL, updated_at = NOW()
        WHERE work_type != 'PACK' AND completed_by_packer_id IS NOT NULL
      `);
      console.log(`  [FIX] Cleared completed_by_packer_id on ${wrongType.rows.length} non-PACK rows.`);
    }
  } else {
    console.log('  ✓ No non-PACK rows have completed_by_packer_id.');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Check 4: completed_by_packer_id pointing to non-existent staff
  // ─────────────────────────────────────────────────────────────────────────
  const orphanStaff = await pool.query(`
    SELECT wa.id, wa.completed_by_packer_id
    FROM work_assignments wa
    WHERE wa.completed_by_packer_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.id = wa.completed_by_packer_id)
    LIMIT 50
  `);
  console.log(`\n[CHECK 4] completed_by_packer_id pointing to missing staff: ${orphanStaff.rows.length}`);
  if (orphanStaff.rows.length > 0) {
    issue(orphanStaff.rows.length);
    console.table(orphanStaff.rows);
    if (FIX_MODE) {
      await pool.query(`
        UPDATE work_assignments SET completed_by_packer_id = NULL, updated_at = NOW()
        WHERE completed_by_packer_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.id = work_assignments.completed_by_packer_id)
      `);
      console.log(`  [FIX] Nulled orphaned completed_by_packer_id on ${orphanStaff.rows.length} rows.`);
    }
  } else {
    console.log('  ✓ All completed_by_packer_id values reference valid staff rows.');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Check 5: THE NON-SCANNABLE GAP
  //
  //   Orders where PACK WA = DONE (correctly completed via management UI)
  //   but NO packer_logs row exists — so the current excludePacked filter
  //   in the pending view would still show them as "pending".
  //
  //   These are the non-scannable items that the SAL/WA approach fixes.
  // ─────────────────────────────────────────────────────────────────────────
  const nonScannableGap = await pool.query(`
    SELECT
      o.id            AS order_id,
      o.order_id      AS order_number,
      o.product_title,
      o.shipment_id,
      wa.id           AS wa_id,
      wa.status       AS wa_status,
      wa.completed_by_packer_id,
      wa.completed_at,
      s.name          AS completed_by_name
    FROM work_assignments wa
    JOIN orders o ON o.id = wa.entity_id AND wa.entity_type = 'ORDER'
    LEFT JOIN staff s ON s.id = wa.completed_by_packer_id
    WHERE wa.work_type = 'PACK'
      AND wa.status    = 'DONE'
      AND NOT EXISTS (
        SELECT 1 FROM packer_logs pl
        WHERE pl.shipment_id IS NOT NULL
          AND pl.shipment_id = o.shipment_id
      )
    ORDER BY wa.completed_at DESC
    LIMIT 50
  `);
  console.log(`\n[CHECK 5] Non-scannable gap — PACK/DONE with no packer_logs row: ${nonScannableGap.rows.length}`);
  if (nonScannableGap.rows.length > 0) {
    console.log('  These orders are marked DONE via the management UI but would still');
    console.log('  appear in the PENDING view because excludePacked uses packer_logs.');
    console.log('  Fix: change excludePacked/packedOnly in /api/orders to use WA status instead.\n');
    console.table(nonScannableGap.rows.map(r => ({
      order_id:         r.order_id,
      order_number:     r.order_number,
      product_title:    (r.product_title || '').slice(0, 40),
      completed_by:     r.completed_by_name ?? '(no packer set)',
      completed_at:     r.completed_at ? String(r.completed_at).slice(0, 19) : null,
    })));
  } else {
    console.log('  ✓ No gap found (or no management-UI completions yet without a scanner scan).');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n=== Summary: ${totalIssues} issue(s) found${FIX_MODE ? ', fix mode applied' : ''} ===\n`);
  await pool.end();
}

run().catch(e => { console.error(e); pool.end(); process.exit(1); });
