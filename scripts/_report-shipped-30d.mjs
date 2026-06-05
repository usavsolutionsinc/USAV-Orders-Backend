import 'dotenv/config';
import pg from 'pg';

const url = process.env.DATABASE_URL;
const pool = new pg.Pool({
  connectionString: url,
  connectionTimeoutMillis: 20000,
  max: 1,
  ssl: { rejectUnauthorized: false },
});

// Mirrors src/utils/order-platform.ts getOrderPlatformLabel()
function platformLabel(orderId, accountSource) {
  const oid = String(orderId ?? '').trim();
  const src = String(accountSource ?? '').trim();
  if (oid === 'Not available' || oid === 'N/A') return src || 'Unknown';
  if (String(oid).toUpperCase().includes('FBA') || src.toLowerCase() === 'fba') return 'FBA';
  if (!oid) {
    const s = src.toLowerCase();
    if (!s) return 'Unknown';
    if (s === 'ecwid') return 'ECWID';
    return src;
  }
  if (/^\d{3}-\d+-\d+$/.test(oid)) return 'Amazon';
  if (/^\d{2}-\d+-\d+$/.test(oid)) return 'eBay';
  if (/^\d{15}$/.test(oid)) return 'Walmart';
  if (/^\d{4}$/.test(oid)) return 'ECWID';
  return src || 'Unknown';
}

const sql = `
  SELECT
    o.product_title,
    o.sku,
    o.item_number,
    o.order_id,
    o.account_source,
    o.quantity,
    COALESCE(pl.packed_at, stn.latest_event_at, o.created_at) AS ship_date
  FROM orders o
  LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
  LEFT JOIN LATERAL (
    SELECT pl.created_at AS packed_at
    FROM packer_logs pl
    WHERE pl.shipment_id IS NOT NULL
      AND pl.shipment_id = o.shipment_id
      AND pl.tracking_type = 'ORDERS'
    ORDER BY pl.created_at DESC NULLS LAST, pl.id DESC
    LIMIT 1
  ) pl ON true
  WHERE COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
          OR stn.is_out_for_delivery OR stn.is_delivered, false)
    AND COALESCE(pl.packed_at, stn.latest_event_at, o.created_at) >= NOW() - INTERVAL '30 days'
`;

const { rows } = await pool.query(sql);
await pool.end();

// Dedup on product_title + sku + platform
const groups = new Map();
for (const r of rows) {
  const platform = platformLabel(r.order_id, r.account_source);
  const title = String(r.product_title || r.item_number || r.sku || 'Unknown Product').trim();
  const sku = String(r.sku || r.item_number || '').trim();
  const key = `${title}||${sku}||${platform}`;
  if (!groups.has(key)) {
    groups.set(key, { title, sku, platform, orders: 0, units: 0 });
  }
  const g = groups.get(key);
  g.orders += 1;
  g.units += parseInt(String(r.quantity || '1'), 10) || 1;
}

const out = Array.from(groups.values()).sort(
  (a, b) => b.orders - a.orders || a.title.localeCompare(b.title)
);

console.log(`\nSHIPPED — last 30 days (deduped by product title + SKU + platform)`);
console.log(`Raw shipped order rows: ${rows.length}  |  Unique product/SKU/platform rows: ${out.length}\n`);

// platform breakdown
const byPlatform = {};
for (const g of out) byPlatform[g.platform] = (byPlatform[g.platform] || 0) + 1;
console.log('By platform (unique rows):', JSON.stringify(byPlatform));
console.log('');

// TSV so it pastes straight into a sheet
console.log(['Product Title', 'SKU', 'Platform', 'Orders', 'Units'].join('\t'));
for (const g of out) {
  console.log([g.title, g.sku, g.platform, g.orders, g.units].join('\t'));
}

// Write CSV to repo
import { writeFileSync } from 'fs';
const csvEscape = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = [
  ['Product Title', 'SKU', 'Platform', 'Orders', 'Units'].map(csvEscape).join(','),
  ...out.map((g) => [g.title, g.sku, g.platform, g.orders, g.units].map(csvEscape).join(',')),
].join('\n');
const outPath = new URL('../reports/shipped-last-30-days.csv', import.meta.url).pathname;
writeFileSync(outPath, csv + '\n');
console.log(`\nCSV written: ${outPath}`);
