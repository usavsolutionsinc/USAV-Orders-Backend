/**
 * sku_normalization_audit.mjs
 * ────────────────────────────────────────────────────────────────────
 * Deep audit of the SKU mismatch between marketplace order SKUs and
 * internal STOCKED-unit SKUs. The goal: understand whether this is
 *   (a) a leading-zero / formatting normalization fix (1 line)
 *   (b) a marketplace-to-internal mapping table need (multi-day)
 *   (c) genuine missing data that humans must enter
 * before scoping Phase 2.
 *
 * Read-only — no writes.
 */

import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const envText = readFileSync('/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env', 'utf8');
const url = (envText.match(/^DATABASE_URL_UNPOOLED=(.+)$/m) || envText.match(/^DATABASE_URL=(.+)$/m))[1].trim();
const sql = neon(url);

function rule(t) { console.log(`\n=== ${t} ===`); }

// ── 1. What tables/columns exist that could carry a SKU mapping? ─────────
rule('1. Look for any SKU alias / mapping tables');
const skuTables = await sql`
  SELECT table_name
    FROM information_schema.tables
   WHERE table_schema = 'public'
     AND (table_name ILIKE '%sku%' OR table_name ILIKE '%alias%' OR table_name ILIKE '%mapping%' OR table_name ILIKE '%marketplace%')
   ORDER BY table_name
`;
console.log('Candidates:', skuTables.map(r => r.table_name).join(', ') || '(none)');

// ── 2. SKU catalog shape ─────────────────────────────────────────────────
rule('2. sku_catalog row count + column list');
const catCols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='sku_catalog' AND table_schema='public' ORDER BY ordinal_position`;
console.log('Columns:', catCols.map(c => c.column_name).join(', '));
const catCount = await sql`SELECT COUNT(*)::int AS n FROM sku_catalog`;
console.log(`Rows: ${catCount[0].n}`);
const catSample = await sql`SELECT sku, product_title FROM sku_catalog ORDER BY sku LIMIT 10`;
console.log('Sample:'); for (const r of catSample) console.log(`  ${r.sku}  ${r.product_title?.slice(0, 50) || ''}`);

// ── 3. SKU format distribution in open orders ─────────────────────────────
rule('3. Open-order SKU format distribution (regex buckets)');
const openOrders = await sql`
  SELECT sku, COUNT(*)::int AS n
    FROM orders
   WHERE status IS NULL OR status != 'shipped'
   GROUP BY sku
   ORDER BY n DESC
`;
const buckets = { null: 0, empty: 0, no_data: 0, digits_only: 0, leading_zero: 0, hyphenated: 0, alphanumeric_other: 0, total_orders: 0 };
for (const r of openOrders) {
  const s = r.sku;
  buckets.total_orders += r.n;
  if (s === null) buckets.null += r.n;
  else if (s === '' || s.trim() === '') buckets.empty += r.n;
  else if (s.trim().toLowerCase() === 'no data') buckets.no_data += r.n;
  else if (/^0+\d+/.test(s.trim())) buckets.leading_zero += r.n;
  else if (/^\d+$/.test(s.trim())) buckets.digits_only += r.n;
  else if (/^[\d\w]+-[\w\d]+/.test(s.trim())) buckets.hyphenated += r.n;
  else buckets.alphanumeric_other += r.n;
}
for (const [k, n] of Object.entries(buckets)) console.log(`  ${k.padEnd(20)} ${n}`);

// ── 4. Direct overlap check (verbatim and normalized) ────────────────────
rule('4. Overlap: open-order SKUs ↔ STOCKED serial_units SKUs');
const verbatim = await sql`
  SELECT COUNT(*)::int AS n
    FROM (SELECT DISTINCT sku FROM orders WHERE (status IS NULL OR status != 'shipped') AND sku IS NOT NULL AND sku != '') o
   INNER JOIN (SELECT DISTINCT sku FROM serial_units WHERE current_status='STOCKED') su
      ON o.sku = su.sku
`;
console.log(`  verbatim match:                ${verbatim[0].n} SKUs`);

const stripZeros = await sql`
  SELECT COUNT(*)::int AS n
    FROM (SELECT DISTINCT LTRIM(sku, '0') AS sku FROM orders WHERE (status IS NULL OR status != 'shipped') AND sku IS NOT NULL AND sku != '') o
   INNER JOIN (SELECT DISTINCT LTRIM(sku, '0') AS sku FROM serial_units WHERE current_status='STOCKED') su
      ON o.sku = su.sku
`;
console.log(`  strip-leading-zeros match:     ${stripZeros[0].n} SKUs`);

const padZeros = await sql`
  SELECT COUNT(*)::int AS n
    FROM (SELECT DISTINCT LPAD(LTRIM(sku, '0'), 5, '0') AS sku FROM orders WHERE (status IS NULL OR status != 'shipped') AND sku IS NOT NULL AND sku != '' AND sku ~ '^[0-9]+$') o
   INNER JOIN (SELECT DISTINCT sku FROM serial_units WHERE current_status='STOCKED' AND sku ~ '^[0-9]+$') su
      ON o.sku = su.sku
`;
console.log(`  pad-to-5-digits match:         ${padZeros[0].n} SKUs`);

// ── 5. Overlap against sku_catalog (broader, since STOCKED is only 40 units) ──
rule('5. Overlap: open-order SKUs ↔ sku_catalog SKUs');
const catVerbatim = await sql`
  SELECT COUNT(*)::int AS n
    FROM (SELECT DISTINCT sku FROM orders WHERE (status IS NULL OR status != 'shipped') AND sku IS NOT NULL AND sku != '') o
   INNER JOIN (SELECT DISTINCT sku FROM sku_catalog) sc
      ON o.sku = sc.sku
`;
console.log(`  verbatim match:                ${catVerbatim[0].n} SKUs`);

const catStrip = await sql`
  SELECT COUNT(*)::int AS n
    FROM (SELECT DISTINCT LTRIM(sku, '0') AS sku FROM orders WHERE (status IS NULL OR status != 'shipped') AND sku IS NOT NULL AND sku != '') o
   INNER JOIN (SELECT DISTINCT LTRIM(sku, '0') AS sku FROM sku_catalog) sc
      ON o.sku = sc.sku
`;
console.log(`  strip-leading-zeros match:     ${catStrip[0].n} SKUs`);

// ── 6. Look for ORDER lines that already match STOCKED units ─────────────
rule('6. Concrete orders that would allocate today (verbatim SKU match)');
const allocCandidates = await sql`
  SELECT o.id, o.order_id, o.sku, o.status,
         (SELECT COUNT(*)::int FROM serial_units su WHERE su.sku = o.sku AND su.current_status = 'STOCKED') AS stocked_units
    FROM orders o
   WHERE (o.status IS NULL OR o.status != 'shipped')
     AND o.sku IS NOT NULL
     AND o.sku != ''
     AND EXISTS (SELECT 1 FROM serial_units su WHERE su.sku = o.sku AND su.current_status = 'STOCKED')
   ORDER BY o.id DESC
   LIMIT 20
`;
console.log(`  ${allocCandidates.length} orders found:`);
for (const r of allocCandidates) console.log(`    #${r.id} order_id=${r.order_id} sku=${r.sku} status=${r.status} stocked=${r.stocked_units}`);

// ── 7. account_source distribution on open orders ────────────────────────
rule('7. Open orders by account_source');
const sources = await sql`
  SELECT account_source, COUNT(*)::int AS n
    FROM orders
   WHERE status IS NULL OR status != 'shipped'
   GROUP BY account_source
   ORDER BY n DESC
`;
for (const r of sources) console.log(`  ${(r.account_source || '(null)').padEnd(30)} ${r.n}`);

// ── 8. Are there any existing helpers/transforms? grep hint ──────────────
rule('8. (Hint) Look at how the Zoho webhook writes SKUs to orders');
console.log('  Run: grep -rn "INSERT INTO orders" src/lib --include="*.ts" | head');
console.log('  Run: grep -rn "ingestOrder\\|order.sku" src/lib --include="*.ts" | head');
