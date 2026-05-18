import 'dotenv/config';
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(`SELECT id, staff_id, shift_id, punched_in_at, punched_out_at, source FROM time_punches WHERE staff_id = 1 ORDER BY punched_in_at DESC LIMIT 3`);
console.table(r.rows);
await c.end();
