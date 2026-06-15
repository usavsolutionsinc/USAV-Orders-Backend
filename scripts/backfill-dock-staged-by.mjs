#!/usr/bin/env node
/**
 * Backfill DOCK_STAGED activity logs for packed packages awaiting scan-out.
 *
 * Usage:
 *   node scripts/backfill-dock-staged-by.mjs --staff-name Mike --dry-run
 *   node scripts/backfill-dock-staged-by.mjs --staff-id 3
 */
import 'dotenv/config';
import pg from 'pg';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const staffIdArg = argv.indexOf('--staff-id');
const staffNameArg = argv.indexOf('--staff-name');
const staffIdFromArg = staffIdArg >= 0 ? Number(argv[staffIdArg + 1]) : NaN;
const staffName = staffNameArg >= 0 ? String(argv[staffNameArg + 1] || '').trim() : 'Mike';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const shippedByCarrierSql = `COALESCE(
  (SELECT true FROM shipping_tracking_numbers stn
     WHERE stn.shipment_id = o.shipment_id
       AND stn.latest_status_category IS NOT NULL
       AND stn.latest_status_category NOT IN ('LABEL_CREATED', 'UNKNOWN')
     LIMIT 1),
  false
)`;

async function resolveStaffId() {
  if (Number.isFinite(staffIdFromArg) && staffIdFromArg > 0) {
    const check = await pool.query(`SELECT id, name, organization_id FROM staff WHERE id = $1`, [staffIdFromArg]);
    if (check.rows[0]) return check.rows[0];
  }
  if (staffName) {
    const check = await pool.query(
      `SELECT id, name, organization_id
         FROM staff
        WHERE lower(trim(name)) = lower($1)
        ORDER BY id ASC
        LIMIT 1`,
      [staffName],
    );
    if (check.rows[0]) return check.rows[0];
  }
  return null;
}

async function main() {
  const staff = await resolveStaffId();
  if (!staff) {
    console.error('Staff not found — pass --staff-id or --staff-name');
    process.exit(1);
  }

  const orgId = staff.organization_id;
  console.log(`Target staff: ${staff.id} (${staff.name}) org=${orgId}`);

  const candidates = await pool.query(
    `SELECT DISTINCT o.shipment_id
       FROM orders o
      WHERE o.organization_id = $1
        AND o.shipment_id IS NOT NULL
        AND COALESCE(o.fulfillment_channel, '') <> 'AFN'
        AND NOT ${shippedByCarrierSql}
        AND EXISTS (
          SELECT 1 FROM station_activity_logs sal_pack
           WHERE sal_pack.shipment_id = o.shipment_id
             AND sal_pack.activity_type IN ('PACK_COMPLETED', 'PACK_SCAN')
        )
        AND NOT EXISTS (
          SELECT 1 FROM station_activity_logs sal_out
           WHERE sal_out.shipment_id = o.shipment_id
             AND sal_out.activity_type = 'SHIP_CONFIRM'
        )
        AND NOT EXISTS (
          SELECT 1 FROM station_activity_logs sal_stage
           WHERE sal_stage.shipment_id = o.shipment_id
             AND sal_stage.activity_type = 'DOCK_STAGED'
        )`,
    [orgId],
  );

  const shipmentIds = candidates.rows
    .map((row) => Number(row.shipment_id))
    .filter((id) => Number.isFinite(id) && id > 0);

  console.log(`Candidates without DOCK_STAGED: ${shipmentIds.length}`);

  if (shipmentIds.length === 0) {
    await pool.end();
    return;
  }

  if (dryRun) {
    console.log('Dry run — sample shipment ids:', shipmentIds.slice(0, 10).join(', '));
    await pool.end();
    return;
  }

  let inserted = 0;
  for (const shipmentId of shipmentIds) {
    await pool.query(
      `INSERT INTO station_activity_logs (
         organization_id, station, activity_type, staff_id, shipment_id, metadata, created_at
       ) VALUES ($1, 'OUTBOUND', 'DOCK_STAGED', $2, $3, $4::jsonb, NOW())`,
      [orgId, staff.id, shipmentId, JSON.stringify({ source: 'scripts.backfill-dock-staged-by' })],
    );
    inserted += 1;
  }

  console.log(`Inserted ${inserted} DOCK_STAGED rows.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
