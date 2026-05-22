import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
const url = readFileSync('/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env','utf8').match(/^DATABASE_URL_UNPOOLED=(.+)$/m)[1].trim();
const sql = neon(url);

// Mirror the JS helper logic in SQL to preview what backfill would do.
const r = await sql`
  SELECT
    CASE
      WHEN order_id ~ '^\\d{3}-\\d+-\\d+$'   THEN 'Amazon'
      WHEN order_id ~ '^\\d{2}-\\d+-\\d+$'   THEN 'eBay'
      WHEN order_id ~ '^\\d{15}$'             THEN 'Walmart'
      WHEN order_id ~ '^\\d{4}$'              THEN 'Ecwid'
      WHEN order_id ILIKE '%FBA%'             THEN 'FBA'
      ELSE NULL
    END AS derived_source,
    COUNT(*)::int AS n
   FROM orders
   WHERE account_source IS NULL
     AND (status IS NULL OR status != 'shipped')
   GROUP BY derived_source
   ORDER BY n DESC
`;
console.log('Preview: open orders w/ NULL account_source, by derived source from order_id pattern:');
for (const row of r) console.log(`  ${(row.derived_source || '(no pattern match)').padEnd(20)} ${row.n}`);

const totals = await sql`SELECT COUNT(*)::int AS n FROM orders WHERE (status IS NULL OR status != 'shipped')`;
console.log(`\nTotal open orders: ${totals[0].n}`);

const all = await sql`
  SELECT
    CASE
      WHEN order_id ~ '^\\d{3}-\\d+-\\d+$'   THEN 'Amazon'
      WHEN order_id ~ '^\\d{2}-\\d+-\\d+$'   THEN 'eBay'
      WHEN order_id ~ '^\\d{15}$'             THEN 'Walmart'
      WHEN order_id ~ '^\\d{4}$'              THEN 'Ecwid'
      WHEN order_id ILIKE '%FBA%'             THEN 'FBA'
      ELSE NULL
    END AS derived_source,
    COUNT(*)::int AS n
   FROM orders
   WHERE account_source IS NULL
   GROUP BY derived_source
   ORDER BY n DESC
`;
console.log('\nALL-TIME (shipped + open) NULL-source orders, by derived:');
for (const row of all) console.log(`  ${(row.derived_source || '(no pattern match)').padEnd(20)} ${row.n}`);
