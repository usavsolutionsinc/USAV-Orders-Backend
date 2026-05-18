import 'dotenv/config';
import pg from 'pg';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const upd = await client.query(`UPDATE shift_templates SET effective_from = '2024-01-01' WHERE effective_from > '2024-01-01'`);
console.log('templates backdated:', upd.rowCount);
// Re-materialize this week + next week for all active staff
const seed = await client.query(`
  WITH targets AS (SELECT id FROM staff WHERE COALESCE(active,true)=true)
  SELECT id, materialize_shifts(id, '2026-05-11'::date, '2026-05-22'::date) AS created
  FROM targets ORDER BY id
`);
console.log('materialized 5/11..5/22 per staff:', seed.rows);
const tot = await client.query(`SELECT COUNT(*)::int AS n FROM shifts WHERE starts_at >= '2026-05-11' AND starts_at < '2026-05-23'`);
console.log('total shifts in 5/11..5/22:', tot.rows[0].n);
await client.end();
