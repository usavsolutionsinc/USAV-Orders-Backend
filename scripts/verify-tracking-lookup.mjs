#!/usr/bin/env node
// Verify the tracking lookup fallback for a specific scanned barcode.
// Usage: node scripts/verify-tracking-lookup.mjs
import 'dotenv/config';
import { Pool } from '@neondatabase/serverless';

const SCANNED = '9622001900001691053100380368793934';
const last8 = SCANNED.replace(/\D/g, '').slice(-8);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log(`scanned : ${SCANNED}`);
  console.log(`last8   : ${last8}\n`);

  const rs = await pool.query(
    `SELECT id, receiving_id, tracking_number
       FROM receiving_scans
      WHERE RIGHT(regexp_replace(tracking_number, '\\D', '', 'g'), 8) = $1
      LIMIT 5`,
    [last8],
  );
  console.log(`[receiving_scans last-8 match] rows=${rs.rows.length}`);
  for (const r of rs.rows) console.log('  ', r);

  const stn = await pool.query(
    `SELECT stn.id, stn.tracking_number_normalized, r.id AS receiving_id
       FROM shipping_tracking_numbers stn
       LEFT JOIN receiving r ON r.shipment_id = stn.id
      WHERE RIGHT(regexp_replace(stn.tracking_number_normalized, '\\D', '', 'g'), 8) = $1
      LIMIT 5`,
    [last8],
  );
  console.log(`\n[shipping_tracking_numbers last-8 match] rows=${stn.rows.length}`);
  for (const r of stn.rows) console.log('  ', r);

  const rl = await pool.query(
    `SELECT id, receiving_id, zoho_purchaseorder_id, zoho_reference_number
       FROM receiving_lines
      WHERE zoho_reference_number IS NOT NULL
        AND RIGHT(regexp_replace(zoho_reference_number, '\\D', '', 'g'), 8) = $1
      LIMIT 5`,
    [last8],
  );
  console.log(`\n[receiving_lines.zoho_reference_number last-8 match] rows=${rl.rows.length}`);
  for (const r of rl.rows) console.log('  ', r);

  await pool.end();
}

main().catch((err) => {
  console.error('FAILED:', err);
  pool.end().finally(() => process.exit(1));
});
