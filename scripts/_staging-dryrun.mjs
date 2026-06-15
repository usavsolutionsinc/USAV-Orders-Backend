// READ-ONLY dry run: identify the "In Staging" outbound set (packed, no
// SHIP_CONFIRM, not in carrier custody) the way the Shipped dashboard derives
// it, so we can confirm before scanning any out. No writes.
import 'dotenv/config';
import pg from 'pg';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

// Which optional status columns exist on shipping_tracking_numbers?
const cols = await client.query(
  `SELECT column_name FROM information_schema.columns
   WHERE table_name = 'shipping_tracking_numbers'
     AND column_name IN ('latest_status_category','has_exception','is_terminal')`,
);
const have = new Set(cols.rows.map((r) => r.column_name));
console.log('stn status columns present:', [...have]);

const custody = `('ACCEPTED','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','RETURNED')`;
const notCustody = have.has('latest_status_category')
  ? `(stn.latest_status_category IS NULL OR UPPER(stn.latest_status_category) NOT IN ${custody})`
  : `TRUE`;
const notException = have.has('has_exception') ? `COALESCE(stn.has_exception, false) = false` : `TRUE`;

const STAGED = `
  WITH staged AS (
    SELECT DISTINCT ON (sal.shipment_id)
           sal.shipment_id,
           sal.organization_id,
           sal.staff_id,
           sal.scan_ref,
           sal.created_at AS packed_at,
           stn.tracking_number_raw
           ${have.has('latest_status_category') ? ', stn.latest_status_category' : ''}
    FROM station_activity_logs sal
    LEFT JOIN shipping_tracking_numbers stn ON stn.id = sal.shipment_id
    WHERE sal.station = 'PACK'
      AND sal.shipment_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM station_activity_logs so
        WHERE so.activity_type = 'SHIP_CONFIRM' AND so.shipment_id = sal.shipment_id
      )
      AND ${notCustody}
      AND ${notException}
    ORDER BY sal.shipment_id, sal.created_at DESC
  )
  SELECT * FROM staged
`;

const total = await client.query(`SELECT COUNT(*)::int n FROM (${STAGED}) s`);
console.log('\nTOTAL staged (all-time):', total.rows[0].n);

const recency = await client.query(`
  SELECT COUNT(*) FILTER (WHERE packed_at >= NOW() - interval '7 days')::int  AS last7,
         COUNT(*) FILTER (WHERE packed_at >= NOW() - interval '14 days')::int AS last14,
         COUNT(*) FILTER (WHERE packed_at >= NOW() - interval '31 days')::int AS last31,
         to_char(MIN(packed_at),'YYYY-MM-DD') AS oldest,
         to_char(MAX(packed_at),'YYYY-MM-DD') AS newest
  FROM (${STAGED}) s
`);
console.log('recency:', recency.rows[0]);

const orgs = await client.query(`SELECT organization_id, COUNT(*)::int n FROM (${STAGED}) s GROUP BY 1 ORDER BY 2 DESC`);
console.log('\nby org:');
console.table(orgs.rows);

const byWeek = await client.query(`
  SELECT to_char(date_trunc('week', packed_at), 'YYYY-MM-DD') AS wk, COUNT(*)::int n
  FROM (${STAGED}) s GROUP BY 1 ORDER BY 1 DESC LIMIT 8
`);
console.log('staged by pack-week (recent first):');
console.table(byWeek.rows);

const samples = await client.query(`
  SELECT shipment_id, staff_id, tracking_number_raw,
         ${have.has('latest_status_category') ? 'latest_status_category,' : ''}
         to_char(packed_at,'YYYY-MM-DD') AS packed
  FROM (${STAGED}) s ORDER BY packed_at DESC LIMIT 12
`);
console.log('\n12 most-recent staged samples:');
console.table(samples.rows);

await client.end();
console.log('\n(no writes performed)');
