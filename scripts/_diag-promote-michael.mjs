import 'dotenv/config';
import pg from 'pg';

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(
  `UPDATE staff SET role = 'admin', status = COALESCE(NULLIF(status, ''), 'active') WHERE id = 1 RETURNING id, name, role, status`,
);
console.table(r.rows);
await c.end();
