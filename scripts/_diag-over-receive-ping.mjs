import 'dotenv/config';
import pg from 'pg';
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});
const checks = [
  ['ping', `SELECT 1 AS ok, NOW() AS server_time`],
  ['over_receive_residue', `
    SELECT COUNT(*)::int AS bad
    FROM receiving_lines
    WHERE quantity_expected IS NOT NULL
      AND quantity_received > quantity_expected`],
  ['clamped_sample', `
    SELECT id, receiving_id, sku, quantity_received, quantity_expected
    FROM receiving_lines
    WHERE id IN (2056, 2059, 2083, 2146)
    ORDER BY id`],
  ['detached_serials', `
    SELECT id, serial_number, origin_receiving_line_id
    FROM serial_units
    WHERE id IN (728, 1066)
    ORDER BY id`],
];
for (const [name, sql] of checks) {
  const r = await pool.query(sql);
  console.log(`\n${name}:`);
  console.log(r.rows);
}
await pool.end();
