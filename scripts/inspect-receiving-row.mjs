#!/usr/bin/env node
import 'dotenv/config';
import { Pool } from '@neondatabase/serverless';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const SCANNED = '9622001900001691053100380368793934';
const last8 = SCANNED.replace(/\D/g, '').slice(-8);

async function main() {
  // What columns does receiving_lines actually have?
  const cols = await pool.query(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_name = 'receiving_lines'
      ORDER BY ordinal_position`,
  );
  console.log('receiving_lines columns:');
  for (const c of cols.rows) console.log(`  ${c.column_name} (${c.data_type})`);

  // The scan resolves to receiving_id 3578 — inspect that receiving row and its lines.
  console.log('\n[receiving row 3578]');
  const r = await pool.query(
    `SELECT id, source, zoho_purchaseorder_id, zoho_purchaseorder_number,
            receiving_tracking_number, shipment_id, source_platform
       FROM receiving WHERE id = 3578`,
  );
  console.log(r.rows[0]);

  console.log('\n[receiving_lines for receiving_id = 3578]');
  const lines = await pool.query(
    `SELECT id, receiving_id, zoho_purchaseorder_id, zoho_purchaseorder_number, sku, item_name
       FROM receiving_lines WHERE receiving_id = 3578 LIMIT 5`,
  );
  for (const l of lines.rows) console.log('  ', l);

  // Also find any line whose PO# matches — helps diagnose soft-join behavior.
  if (r.rows[0]?.zoho_purchaseorder_id) {
    console.log(`\n[lines under PO# ${r.rows[0].zoho_purchaseorder_id}]`);
    const po = await pool.query(
      `SELECT id, receiving_id, sku, item_name
         FROM receiving_lines
        WHERE zoho_purchaseorder_id = $1
        LIMIT 5`,
      [r.rows[0].zoho_purchaseorder_id],
    );
    for (const l of po.rows) console.log('  ', l);
  }

  void last8;
  await pool.end();
}

main().catch((err) => {
  console.error('FAILED:', err);
  pool.end().finally(() => process.exit(1));
});
