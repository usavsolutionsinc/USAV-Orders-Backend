// Scan out THIS WEEK's "In Staging" packages (packed, no SHIP_CONFIRM, not in
// carrier custody) EXCEPT the 5 newest — so the Shipped "In Staging" tile drops
// to 5 for testing the dock scan-out flow. Mirrors POST /api/shipped/scan-out:
// inserts an idempotent SHIP_CONFIRM (station OUTBOUND) per shipment.
//
// Reversible:  DELETE FROM station_activity_logs
//              WHERE activity_type='SHIP_CONFIRM' AND metadata->>'source'='staging-backfill';
//
// Pass --go to actually write; without it, prints the plan only.
import 'dotenv/config';
import pg from 'pg';

const GO = process.argv.includes('--go');
const KEEP = 5;
const CUSTODY = `('ACCEPTED','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','RETURNED')`;

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

// One row per staged shipment in the CURRENT week (Mon-based, matches the
// dashboard's week tile). Newest pack first so KEEP takes the 5 most recent.
const stagedSql = `
  SELECT DISTINCT ON (sal.shipment_id)
         sal.shipment_id,
         sal.organization_id,
         sal.staff_id,
         COALESCE(stn.tracking_number_raw, sal.scan_ref) AS tracking,
         sal.created_at AS packed_at
  FROM station_activity_logs sal
  LEFT JOIN shipping_tracking_numbers stn ON stn.id = sal.shipment_id
  WHERE sal.station = 'PACK'
    AND sal.shipment_id IS NOT NULL
    AND date_trunc('week', sal.created_at) = date_trunc('week', NOW())
    AND NOT EXISTS (
      SELECT 1 FROM station_activity_logs so
      WHERE so.activity_type = 'SHIP_CONFIRM' AND so.shipment_id = sal.shipment_id
    )
    AND (stn.latest_status_category IS NULL
         OR UPPER(stn.latest_status_category) NOT IN ${CUSTODY})
    AND COALESCE(stn.has_exception, false) = false
  ORDER BY sal.shipment_id, sal.created_at DESC
`;

const { rows: staged } = await client.query(`
  SELECT * FROM (${stagedSql}) s ORDER BY packed_at DESC, shipment_id DESC
`);
console.log(`this-week staged: ${staged.length}`);

const keep = staged.slice(0, KEEP);
const toScan = staged.slice(KEEP);
console.log(`keeping ${keep.length} staged for testing, scanning out ${toScan.length}\n`);

console.log('KEEP (test these in Shipped → Scan-Out):');
console.table(keep.map((r) => ({ shipment_id: r.shipment_id, tracking: r.tracking, staff_id: r.staff_id })));

if (!GO) {
  console.log('\n[dry run] pass --go to write the SHIP_CONFIRM events.');
  await client.end();
  process.exit(0);
}

const ids = toScan.map((r) => Number(r.shipment_id));
await client.query('BEGIN');
const ins = await client.query(
  `INSERT INTO station_activity_logs
     (organization_id, station, activity_type, staff_id, shipment_id, scan_ref, notes, metadata, created_at)
   SELECT DISTINCT ON (sal.shipment_id)
          sal.organization_id, 'OUTBOUND', 'SHIP_CONFIRM', sal.staff_id, sal.shipment_id,
          COALESCE(stn.tracking_number_raw, sal.scan_ref),
          'Scanned out (staging backfill — confirmed left warehouse)',
          '{"source":"staging-backfill"}'::jsonb, NOW()
   FROM station_activity_logs sal
   LEFT JOIN shipping_tracking_numbers stn ON stn.id = sal.shipment_id
   WHERE sal.station = 'PACK' AND sal.shipment_id = ANY($1::bigint[])
   ORDER BY sal.shipment_id, sal.created_at DESC
   RETURNING shipment_id`,
  [ids],
);
await client.query('COMMIT');
console.log(`\nInserted ${ins.rowCount} SHIP_CONFIRM events.`);

const after = await client.query(`SELECT COUNT(*)::int n FROM (${stagedSql}) s`);
console.log(`this-week staged now: ${after.rows[0].n}`);

await client.end();
