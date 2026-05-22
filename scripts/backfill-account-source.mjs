/**
 * backfill-account-source.mjs
 * ────────────────────────────────────────────────────────────────────
 * Backfills `orders.account_source` for rows where it's NULL by
 * inferring the channel from the `order_id` pattern. Mirrors the JS
 * helper `getOrderPlatformLabel(orderId, null)` so future sheet-sync
 * INSERTs and this one-shot backfill produce the same values.
 *
 * Patterns:
 *   FBA in id           → 'FBA'
 *   \d{3}-\d+-\d+       → 'Amazon'       (e.g. 113-0178053-2920236)
 *   \d{2}-\d+-\d+       → 'ebay'         (e.g. 19-14647-59521)
 *   \d{15}              → 'Walmart'
 *   \d{4}               → 'ECWID'
 *   anything else       → leave NULL (manual review)
 *
 * Why this matters:
 *   The platform-scoped autopair (Phase 2a) joins
 *     LOWER(spi.platform) = LOWER(o.account_source)
 *   so orders without a source can't be auto-paired even when a
 *   matching marketplace SKU exists. This backfill unlocks ~310 of
 *   the 324 open orders that currently sit with NULL source.
 *
 * Usage:
 *   node scripts/backfill-account-source.mjs           # dry-run preview
 *   node scripts/backfill-account-source.mjs --apply   # commit
 *   node scripts/backfill-account-source.mjs --apply --include-shipped   # also backfill shipped orders
 */

import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const envText = readFileSync('/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env', 'utf8');
const url = (envText.match(/^DATABASE_URL_UNPOOLED=(.+)$/m) || envText.match(/^DATABASE_URL=(.+)$/m))[1].trim();
const sql = neon(url);

const APPLY = process.argv.includes('--apply');
const INCLUDE_SHIPPED = process.argv.includes('--include-shipped');
const DRY = !APPLY;

console.log(`Mode: ${DRY ? 'DRY-RUN' : 'APPLY'}`);
console.log(`Scope: ${INCLUDE_SHIPPED ? 'open + shipped' : 'open orders only'}\n`);

// Same CASE expression in both preview + UPDATE so they agree exactly.
const DERIVE_SQL = `
  CASE
    WHEN order_id ILIKE '%FBA%'             THEN 'FBA'
    WHEN order_id ~ '^\\d{3}-\\d+-\\d+$'   THEN 'Amazon'
    WHEN order_id ~ '^\\d{2}-\\d+-\\d+$'   THEN 'ebay'
    WHEN order_id ~ '^\\d{15}$'             THEN 'Walmart'
    WHEN order_id ~ '^\\d{4}$'              THEN 'ECWID'
    ELSE NULL
  END
`;

const scopeClause = INCLUDE_SHIPPED ? '' : `AND (status IS NULL OR status != 'shipped')`;

// 1. Preview the change.
const preview = await sql.query(`
  SELECT ${DERIVE_SQL} AS derived, COUNT(*)::int AS n
    FROM orders
   WHERE account_source IS NULL
     ${scopeClause}
   GROUP BY derived
   ORDER BY n DESC
`);
console.log('Preview — orders that will be updated:');
let updatable = 0;
for (const row of preview) {
  if (row.derived) updatable += row.n;
  console.log(`  ${(row.derived || '(no pattern, will stay NULL)').padEnd(28)} ${row.n}`);
}
console.log(`\n  ${updatable} row(s) will be updated, others stay NULL.`);

if (DRY) {
  console.log('\nRe-run with --apply to commit.');
  if (!INCLUDE_SHIPPED) {
    console.log('Run with --apply --include-shipped to backfill historical shipped orders too.');
  }
  process.exit(0);
}

// 2. Apply. Two collision risks to avoid:
//   (a) sibling row already holds the derived source → NOT EXISTS predicate
//   (b) multiple NULL-source rows for the same order_id derive to the same
//       value → ROW_NUMBER picks one
const DERIVED_O = DERIVE_SQL.replace(/order_id/g, 'o.order_id');
const result = await sql.query(`
  WITH targets AS (
    SELECT id, derived FROM (
      SELECT
        o.id,
        (${DERIVED_O}) AS derived,
        ROW_NUMBER() OVER (PARTITION BY o.order_id, (${DERIVED_O}) ORDER BY o.id) AS rn
        FROM orders o
       WHERE o.account_source IS NULL
         ${scopeClause.replace(/status/g, 'o.status')}
         AND (${DERIVED_O}) IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM orders sibling
            WHERE sibling.order_id = o.order_id
              AND sibling.account_source = (${DERIVED_O})
         )
    ) ranked
    WHERE rn = 1
  )
  UPDATE orders SET account_source = t.derived
    FROM targets t
   WHERE orders.id = t.id
  RETURNING orders.id
`);
console.log(`\nUpdated: ${result.length} rows.`);

// Report the skipped conflicts so they're visible.
const skipped = await sql.query(`
  SELECT o.id, o.order_id, (${DERIVE_SQL.replace(/order_id/g, 'o.order_id')}) AS would_be
    FROM orders o
   WHERE o.account_source IS NULL
     ${scopeClause.replace(/status/g, 'o.status')}
     AND (${DERIVE_SQL.replace(/order_id/g, 'o.order_id')}) IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM orders sibling
        WHERE sibling.order_id = o.order_id
          AND sibling.account_source = (${DERIVE_SQL.replace(/order_id/g, 'o.order_id')})
     )
   ORDER BY o.id
`);
if (skipped.length > 0) {
  console.log(`\nSkipped ${skipped.length} row(s) — sibling row already holds the derived source (data-quality follow-up):`);
  for (const r of skipped.slice(0, 15)) {
    console.log(`  order id=${r.id} order_id=${r.order_id} would_be=${r.would_be}`);
  }
  if (skipped.length > 15) console.log(`  ... and ${skipped.length - 15} more`);
}

// 3. Post-snapshot.
const after = await sql`
  SELECT account_source, COUNT(*)::int AS n
    FROM orders
   WHERE status IS NULL OR status != 'shipped'
   GROUP BY account_source
   ORDER BY n DESC
`;
console.log('\nPost-run open-order distribution:');
for (const r of after) console.log(`  ${(r.account_source || '(null)').padEnd(20)} ${r.n}`);
