import 'dotenv/config';
import pg from 'pg';

const url = process.env.DATABASE_URL;
console.log('Host:', new URL(url).host);

const pool = new pg.Pool({
  connectionString: url,
  connectionTimeoutMillis: 15000,
  max: 1,
  ssl: { rejectUnauthorized: false },
});

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
await time('locations FULL', () => pool.query(`SELECT id, name, room FROM locations WHERE is_active = true ORDER BY room, sort_order, name`).then(r => ({ rows: r.rows.length })));
await time('orders COUNT', () => pool.query('SELECT count(*)::int as n FROM orders').then(r => r.rows));

// Parallel test — mimics dev server hitting 3 endpoints at once
const tParallel = Date.now();
const results = await Promise.allSettled([
  pool.query('SELECT count(*)::int as n FROM orders'),
  pool.query('SELECT id, name FROM locations WHERE is_active = true'),
  pool.query('SELECT count(*)::int as n FROM staff'),
]);
console.log(`Parallel 3 queries: ${Date.now() - tParallel}ms  results=${results.map(r => r.status).join(',')}`);

await pool.end();
