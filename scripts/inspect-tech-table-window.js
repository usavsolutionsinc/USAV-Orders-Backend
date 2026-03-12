const path = require('path');
require('dotenv').config({ path: path.resolve('.env'), quiet: true });
const { Client } = require('pg');

async function main() {
  const techId = Number(process.argv[2] || 3);
  const weekStart = String(process.argv[3] || '2026-03-09');
  const weekEnd = String(process.argv[4] || '2026-03-13');

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const sql = `
    WITH serial_rows AS (
      SELECT
        'tech_serial'::text AS source_kind,
        tsn.id,
        tsn.created_at,
        COALESCE(stn.tracking_number_raw, tsn.scan_ref) AS shipping_tracking_number,
        tsn.serial_number,
        tsn.tested_by
      FROM tech_serial_numbers tsn
      LEFT JOIN shipping_tracking_numbers stn ON stn.id = tsn.shipment_id
      WHERE tsn.tested_by = $1
        AND tsn.created_at IS NOT NULL
        AND tsn.serial_number IS NOT NULL
        AND BTRIM(tsn.serial_number) <> ''
        AND tsn.created_at >= ($2::date - interval '1 day')
        AND tsn.created_at <  ($3::date + interval '2 days')
    ),
    pending_fba_scan_rows AS (
      SELECT
        'fba_scan'::text AS source_kind,
        l.id,
        l.created_at,
        l.fnsku AS shipping_tracking_number,
        ''::text AS serial_number,
        l.staff_id AS tested_by
      FROM fba_fnsku_logs l
      WHERE l.staff_id = $1
        AND l.source_stage = 'TECH'
        AND l.event_type = 'SCANNED'
        AND l.created_at >= ($2::date - interval '1 day')
        AND l.created_at <  ($3::date + interval '2 days')
        AND NOT EXISTS (
          SELECT 1
          FROM tech_serial_numbers tsn
          WHERE tsn.fnsku_log_id = l.id
            AND tsn.serial_number IS NOT NULL
            AND BTRIM(tsn.serial_number) <> ''
        )
    )
    SELECT source_kind, id, created_at, shipping_tracking_number, serial_number, tested_by
    FROM (
      SELECT * FROM serial_rows
      UNION ALL
      SELECT * FROM pending_fba_scan_rows
    ) rows
    ORDER BY created_at DESC
    LIMIT 200
  `;

  const result = await client.query(sql, [techId, weekStart, weekEnd]);
  console.log(JSON.stringify({
    techId,
    weekStart,
    weekEnd,
    rowCount: result.rowCount,
    rows: result.rows,
  }, null, 2));

  await client.end();
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
