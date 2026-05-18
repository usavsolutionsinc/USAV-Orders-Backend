import 'dotenv/config';
import { Pool } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) { console.error('NO DATABASE_URL'); process.exit(1); }
console.log('Host:', new URL(url).host);

const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 15000, max: 1 });

async function time(label, fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    console.log(`${label}: ${Date.now() - t0}ms  ${JSON.stringify(r).slice(0, 120)}`);
  } catch (e) {
    console.log(`${label}: ${Date.now() - t0}ms  ERROR ${e.message}`);
  }
}

await time('SELECT 1', () => pool.query('SELECT 1 as v').then(r => r.rows));
await time('SELECT NOW()', () => pool.query('SELECT NOW() as t').then(r => r.rows));
await time('locations COUNT', () => pool.query('SELECT count(*)::int as n FROM locations WHERE is_active = true').then(r => r.rows));
await time('locations FULL', () => pool.query(`SELECT id, name, room, description, barcode, is_active, sort_order, row_label, col_label, bin_type, capacity, parent_id FROM locations WHERE is_active = true ORDER BY room, sort_order, row_label, col_label, name`).then(r => ({ rows: r.rows.length })));
await time('orders COUNT', () => pool.query('SELECT count(*)::int as n FROM orders').then(r => r.rows));
await time('staff COUNT', () => pool.query('SELECT count(*)::int as n FROM staff WHERE is_active = true').then(r => r.rows));

await pool.end();
