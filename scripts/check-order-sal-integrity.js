/**
 * Order SAL integrity checker
 *
 * Verifies packed_by and tested_by should come from SAL (station_activity_logs),
 * not from work_assignments. For orders with no scan, packed_by/tested_by should be null.
 *
 * Usage:
 *   node scripts/check-order-sal-integrity.js <TRACKING_NUMBER>
 *
 * Example:
 *   node scripts/check-order-sal-integrity.js 1ZJ22B104211374371
 */

require('dotenv').config({ path: '.env', quiet: true });

const { Client } = require('pg');

const tracking = process.argv[2];
if (!tracking) {
  console.error('Usage: node scripts/check-order-sal-integrity.js <TRACKING_NUMBER>');
  process.exit(1);
}

const key18 = String(tracking || '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, '');
const key18Norm = key18.length > 18 ? key18.slice(-18) : key18;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  options: '-c timezone=America/Los_Angeles',
});

async function main() {
  await client.connect();

  console.log('\n════════════════════════════════════════════════════════');
  console.log('  Order SAL Integrity Check');
  console.log('════════════════════════════════════════════════════════');
  console.log(`  Tracking: ${tracking}`);
  console.log(`  Key18:    ${key18Norm}`);
  console.log('────────────────────────────────────────────────────────\n');

  // Find order by tracking
  const { rows: orderRows } = await client.query(
    `SELECT o.id, o.order_id, o.shipment_id, o.product_title,
            stn.tracking_number_raw
     FROM orders o
     LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
     WHERE o.shipment_id IS NOT NULL
       AND (
         stn.tracking_number_raw ILIKE $1
         OR RIGHT(regexp_replace(UPPER(COALESCE(stn.tracking_number_raw, '')), '[^A-Z0-9]', '', 'g'), 18) = $2
       )
     LIMIT 5`,
    [tracking, key18Norm]
  );

  if (orderRows.length === 0) {
    console.log('  ✗ No order found for this tracking number.\n');
    await client.end();
    return;
  }

  for (const ord of orderRows) {
    console.log(`\n── Order id=${ord.id} order_id=${ord.order_id} shipment_id=${ord.shipment_id} ──`);
    console.log(`   Product: ${ord.product_title || 'N/A'}`);
    console.log(`   Tracking: ${ord.tracking_number_raw || 'N/A'}`);

    // Work assignments (wa)
    const { rows: waRows } = await client.query(
      `SELECT id, work_type, status, assigned_tech_id, assigned_packer_id, created_at
       FROM work_assignments
       WHERE entity_type = 'ORDER' AND entity_id = $1
       ORDER BY work_type, id DESC`,
      [ord.id]
    );
    console.log('\n  work_assignments (wa):');
    if (waRows.length === 0) {
      console.log('    (none)');
    } else {
      waRows.forEach((r) => {
        const tech = r.assigned_tech_id ? `tech=${r.assigned_tech_id}` : 'tech=null';
        const pack = r.assigned_packer_id ? `packer=${r.assigned_packer_id}` : 'packer=null';
        console.log(`    id=${r.id} ${r.work_type} ${r.status} ${tech} ${pack}`);
      });
    }

    // Station activity logs (SAL) for this shipment
    const { rows: salRows } = await client.query(
      `SELECT id, station, activity_type, staff_id, created_at
       FROM station_activity_logs
       WHERE shipment_id = $1
       ORDER BY created_at ASC`,
      [ord.shipment_id]
    );
    console.log('\n  station_activity_logs (SAL):');
    if (salRows.length === 0) {
      console.log('    (none) — no one has scanned this order yet');
    } else {
      salRows.forEach((r) => {
        console.log(`    id=${r.id} ${r.station} ${r.activity_type} staff_id=${r.staff_id} ${r.created_at}`);
      });
    }

    // Packer logs
    const { rows: plRows } = await client.query(
      `SELECT id, packed_by, created_at
       FROM packer_logs
       WHERE shipment_id = $1
       ORDER BY created_at DESC`,
      [ord.shipment_id]
    );
    console.log('\n  packer_logs:');
    if (plRows.length === 0) {
      console.log('    (none) — packer has not scanned yet');
    } else {
      plRows.forEach((r) => {
        console.log(`    id=${r.id} packed_by=${r.packed_by} ${r.created_at}`);
      });
    }

    // Expected packed_by and tested_by (from SAL only)
    const packFromSal = salRows.find((r) => r.station === 'PACK');
    const testFromSal = salRows.find((r) => r.station === 'TECH' && r.activity_type === 'TRACKING_SCANNED');
    const packFromPl = plRows[0]?.packed_by;

    const expectedPackedBy = packFromSal?.staff_id ?? packFromPl ?? null;
    const expectedTestedBy = testFromSal?.staff_id ?? null;

    console.log('\n  Expected (SAL/scan only):');
    console.log(`    packed_by: ${expectedPackedBy ?? 'null'} ${expectedPackedBy ? '(from SAL PACK or packer_logs)' : '(no scan yet)'}`);
    console.log(`    tested_by: ${expectedTestedBy ?? 'null'} ${expectedTestedBy ? '(from SAL TECH TRACKING_SCANNED)' : '(no scan yet)'}`);

    const waTech = waRows.find((r) => r.work_type === 'TEST')?.assigned_tech_id;
    const waPack = waRows.find((r) => r.work_type === 'PACK')?.assigned_packer_id;
    console.log('\n  work_assignments (should NOT be used for display):');
    console.log(`    tester_id (wa):  ${waTech ?? 'null'}`);
    console.log(`    packer_id (wa): ${waPack ?? 'null'}`);

    if (salRows.length === 0 && (waTech || waPack)) {
      console.log('\n  ⚠ INTEGRITY: No SAL scans — display should show "—" or "Not scanned"');
      console.log('    NOT the work_assignment names. Fix: client must not fall back to tester_id/packer_id.');
    } else if (salRows.length > 0) {
      console.log('\n  ✓ SAL scans exist — packed_by/tested_by should come from SAL.');
    }
  }

  console.log('\n════════════════════════════════════════════════════════\n');
  await client.end();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
