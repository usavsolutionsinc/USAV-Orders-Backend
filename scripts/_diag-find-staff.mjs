import 'dotenv/config';
import pg from 'pg';

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(`SELECT id, name, role, status, active FROM staff WHERE LOWER(name) LIKE '%michael%' OR LOWER(name) LIKE '%mike%' ORDER BY id`);
console.table(r.rows);
await c.end();
