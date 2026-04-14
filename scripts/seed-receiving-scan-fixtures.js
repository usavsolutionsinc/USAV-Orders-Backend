#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Seeds a matched + unmatched receiving fixture so the scan UI can be
 * validated end-to-end without hitting Zoho.
 *
 *   Matched:   tracking 'MOCK-TRK-PO'      → receiving row (zoho_po) + 2 lines
 *   Unmatched: (none seeded — scan anything new to exercise the path)
 *
 * Run:  node scripts/seed-receiving-scan-fixtures.js
 */

const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

const TRACKING = 'MOCK-TRK-PO';
const PO_ID = 'MOCK-PO-8001';
const PO_NUMBER = 'PO-MOCK-001';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set in .env');

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query('BEGIN');

    // 1. Upsert the matched receiving row keyed by zoho_purchaseorder_id.
    const receivingRes = await client.query(
      `INSERT INTO receiving
         (source, zoho_purchaseorder_id, zoho_purchaseorder_number, carrier,
          receiving_date_time, received_at, qa_status, needs_test, updated_at)
       VALUES ('zoho_po', $1, $2, 'Mock', NOW(), NOW(), 'PENDING', true, NOW())
       ON CONFLICT (zoho_purchaseorder_id) WHERE source = 'zoho_po' AND zoho_purchaseorder_id IS NOT NULL
       DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [PO_ID, PO_NUMBER],
    );
    const receivingId = Number(receivingRes.rows[0].id);

    // 2. Fixture lines (delete-then-insert so re-running stays deterministic).
    await client.query(
      `DELETE FROM receiving_lines
       WHERE receiving_id = $1 AND zoho_line_item_id LIKE 'MOCK-LINE-%'`,
      [receivingId],
    );
    await client.query(
      `INSERT INTO receiving_lines
         (receiving_id, zoho_item_id, zoho_line_item_id, zoho_purchaseorder_id,
          item_name, sku, quantity_expected, quantity_received,
          qa_status, disposition_code, condition_grade, disposition_audit,
          workflow_status, needs_test, created_at, updated_at)
       VALUES
         ($1, 'MOCK-ITEM-1', 'MOCK-LINE-1', $2,
          'Bose SoundLink Mini II Bluetooth Speaker', 'BOSE-SLM2-BK',
          2, 0, 'PENDING', 'HOLD', 'BRAND_NEW', '[]'::jsonb,
          'MATCHED', true, NOW(), NOW()),
         ($1, 'MOCK-ITEM-2', 'MOCK-LINE-2', $2,
          'Apple AirPods Pro (2nd Generation)', 'APPL-APP2-WH',
          3, 0, 'PENDING', 'HOLD', 'BRAND_NEW', '[]'::jsonb,
          'MATCHED', true, NOW(), NOW())`,
      [receivingId, PO_ID],
    );

    // 3. Scan row so lookup-po's dedup short-circuit returns this PO.
    await client.query(
      `INSERT INTO receiving_scans
         (receiving_id, tracking_number, carrier, scanned_at, source)
       VALUES ($1, $2, 'Mock', NOW(), 'zoho_po')
       ON CONFLICT (tracking_number, receiving_id) DO NOTHING`,
      [receivingId, TRACKING],
    );

    await client.query('COMMIT');

    console.log('Seeded fixture:');
    console.log('  receiving_id =', receivingId);
    console.log('  tracking     =', TRACKING);
    console.log('  PO id        =', PO_ID);
    console.log('Scan', TRACKING, 'in the receiving UI to render this fixture.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err?.message || err);
  process.exit(1);
});
