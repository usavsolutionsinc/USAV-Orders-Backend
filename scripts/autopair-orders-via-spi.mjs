/**
 * autopair-orders-via-spi.mjs
 * ────────────────────────────────────────────────────────────────────
 * Backfills `orders.sku_catalog_id` for unpaired open orders by joining
 * `orders.sku → sku_platform_ids.platform_sku`, scoped by platform (so
 * Amazon SKUs only pair Amazon catalog mappings, eBay only eBay, etc.).
 *
 * Why platform-scoped:
 *   sku_platform_ids holds a separate row per marketplace. The same
 *   platform_sku string can theoretically appear under multiple
 *   platforms pointing at different catalog rows. Today there are 0
 *   collisions in the data, but the scope guard future-proofs against
 *   the day someone adds a new ecwid row that happens to collide with
 *   an existing amazon row.
 *
 * Why case-insensitive:
 *   orders.account_source uses mixed case ('Amazon', 'eBay') while
 *   sku_platform_ids.platform is always lowercase ('amazon', 'ebay').
 *
 * What gets skipped:
 *   - Orders already paired (sku_catalog_id IS NOT NULL).
 *   - Orders with NULL account_source — can't determine platform scope
 *     safely; leave for a human to pair via /api/sku-catalog/pair.
 *   - Orders with internal account_source ('MEKONG', 'USAV', 'DRAGON',
 *     'Manual', 'Other') — no marketplace mapping exists.
 *   - Orders whose platform_sku has no candidate in sku_platform_ids.
 *
 * Usage:
 *   node scripts/autopair-orders-via-spi.mjs              # dry-run preview
 *   node scripts/autopair-orders-via-spi.mjs --apply      # commit
 *
 * Read-side counterpart to the user-facing /api/sku-catalog/pair flow,
 * but applied in bulk to existing unpaired orders rather than one at a
 * time on new marketplace ingest.
 */

import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const envText = readFileSync('/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env', 'utf8');
const url = (envText.match(/^DATABASE_URL_UNPOOLED=(.+)$/m) || envText.match(/^DATABASE_URL=(.+)$/m))[1].trim();
const sql = neon(url);

const APPLY = process.argv.includes('--apply');
const DRY = !APPLY;

console.log(`Mode: ${DRY ? 'DRY-RUN' : 'APPLY'}\n`);

// ── 1. Find candidates: unpaired open orders w/ a platform-scoped spi match.
const candidates = await sql`
  SELECT DISTINCT
         o.id              AS order_id,
         o.order_id        AS order_label,
         o.sku             AS order_sku,
         o.account_source  AS source,
         spi.sku_catalog_id AS new_catalog_id,
         sc.sku             AS canonical_sku
    FROM orders o
    JOIN sku_platform_ids spi
      ON LOWER(spi.platform) = LOWER(o.account_source)
     AND spi.platform_sku = o.sku
     AND spi.sku_catalog_id IS NOT NULL
    JOIN sku_catalog sc ON sc.id = spi.sku_catalog_id
   WHERE (o.status IS NULL OR o.status != 'shipped')
     AND o.sku_catalog_id IS NULL
     AND o.sku IS NOT NULL AND TRIM(o.sku) != ''
   ORDER BY o.id ASC
`;

console.log(`Candidates: ${candidates.length} unpaired open orders with platform-scoped spi match\n`);
if (candidates.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

// ── 2. Sanity check — make sure no candidate maps to multiple catalog rows
//    (shouldn't happen due to scope + uniqueness, but worth verifying).
const dupes = new Map();
for (const c of candidates) {
  if (!dupes.has(c.order_id)) dupes.set(c.order_id, new Set());
  dupes.get(c.order_id).add(c.new_catalog_id);
}
const ambiguous = [...dupes.entries()].filter(([, set]) => set.size > 1);
if (ambiguous.length > 0) {
  console.error(`ERROR: ${ambiguous.length} order(s) match multiple catalog rows — aborting.`);
  for (const [oid, set] of ambiguous.slice(0, 5)) console.error(`  order #${oid} → ${[...set].join(', ')}`);
  process.exit(1);
}

// ── 3. Show the preview.
console.log('Preview (first 25):');
for (const c of candidates.slice(0, 25)) {
  console.log(
    `  order #${String(c.order_id).padEnd(6)}  ${(c.order_label || '').padEnd(12)}  ` +
    `source='${(c.source || '').padEnd(8)}'  sku='${(c.order_sku || '').padEnd(14)}' → ` +
    `catalog_id=${c.new_catalog_id}  canonical_sku='${c.canonical_sku}'`,
  );
}
if (candidates.length > 25) console.log(`  ... and ${candidates.length - 25} more`);

if (DRY) {
  console.log(`\nRe-run with --apply to commit.`);
  process.exit(0);
}

// ── 4. Apply per-order with a guarded UPDATE (each row updates only if
//    still NULL — protects against a concurrent /api/sku-catalog/pair
//    write that may have landed since we built the candidate list).
let updated = 0;
let skipped = 0;
let failed = 0;
const errors = [];
for (const c of candidates) {
  try {
    const r = await sql`
      UPDATE orders
         SET sku_catalog_id = ${c.new_catalog_id}
       WHERE id = ${c.order_id}
         AND sku_catalog_id IS NULL
       RETURNING id
    `;
    if (r.length > 0) updated++; else skipped++;
    if (updated % 10 === 0 && updated > 0) console.log(`  paired ${updated}/${candidates.length}...`);
  } catch (err) {
    failed++;
    errors.push({ id: c.order_id, error: err instanceof Error ? err.message : String(err) });
  }
}

console.log(`\nDone.`);
console.log(`  paired:        ${updated}`);
console.log(`  skipped (race): ${skipped}`);
console.log(`  failed:        ${failed}`);
if (errors.length) {
  console.log(`\nFirst 5 errors:`);
  for (const e of errors.slice(0, 5)) console.log(`  order #${e.id}: ${e.error}`);
}

// ── 5. Post-run snapshot.
const after = await sql`
  SELECT
    COUNT(*) FILTER (WHERE sku_catalog_id IS NOT NULL)::int AS paired,
    COUNT(*) FILTER (WHERE sku_catalog_id IS NULL)::int     AS unpaired,
    COUNT(*)::int                                            AS total
  FROM orders
  WHERE status IS NULL OR status != 'shipped'
`;
console.log(`\nPost-run open-order pairing:`);
console.log(`  paired:   ${after[0].paired}/${after[0].total}`);
console.log(`  unpaired: ${after[0].unpaired}/${after[0].total}`);
