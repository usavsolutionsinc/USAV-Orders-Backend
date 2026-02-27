/**
 * Dry-run preview for packer_* sheet routing.
 *
 * Routing rules previewed:
 * - includes ':' -> packer_logs (SKU)
 * - starts with X0 -> packer_logs (FNSKU)
 * - otherwise tracking:
 *   - match orders -> packer_logs (ORDERS)
 *   - no match -> orders_exceptions
 */

require('dotenv').config({ path: '.env' });
const { google } = require('googleapis');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE';

function getGoogleAuth() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!clientEmail || !privateKey) throw new Error('Missing GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY');
  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly'],
  });
}

function normalizeTrackingKey18(value) {
  const normalized = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalized ? normalized.slice(-18) : '';
}

async function hasOrderByTracking(client, tracking) {
  const key18 = normalizeTrackingKey18(tracking);
  if (!key18) return false;
  const res = await client.query(
    `SELECT id
     FROM orders
     WHERE shipping_tracking_number IS NOT NULL
       AND shipping_tracking_number != ''
       AND RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
     LIMIT 1`,
    [key18]
  );
  return res.rows.length > 0;
}

async function previewSheet(sheets, client, sheetName) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A2:B`,
  });
  const rows = response.data.values || [];

  let processed = 0;
  let skippedMissingTracking = 0;
  let directSku = 0;
  let directX0 = 0;
  let orderMatched = 0;
  let orderToExceptions = 0;

  for (const row of rows) {
    const scanInput = String(row[1] || '').trim();
    if (!scanInput) {
      skippedMissingTracking++;
      continue;
    }

    processed++;
    if (scanInput.includes(':')) {
      directSku++;
      continue;
    }
    if (/^X0/i.test(scanInput)) {
      directX0++;
      continue;
    }

    const matched = await hasOrderByTracking(client, scanInput);
    if (matched) orderMatched++;
    else orderToExceptions++;
  }

  return {
    sheetName,
    totalRows: rows.length,
    processed,
    skippedMissingTracking,
    directSku,
    directX0,
    orderMatched,
    orderToExceptions,
  };
}

async function runDryRun() {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const metadata = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const allSheetNames = (metadata.data.sheets || []).map((s) => s.properties?.title || '').filter(Boolean);
  const packerSheets = allSheetNames
    .filter((name) => /^packer_/i.test(String(name || '').trim()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  if (packerSheets.length === 0) throw new Error('No packer_* sheets found');

  const client = await pool.connect();
  try {
    const summaries = [];
    for (const name of packerSheets) {
      const summary = await previewSheet(sheets, client, name);
      summaries.push(summary);
      console.log(`[${name}] rows=${summary.totalRows} processed=${summary.processed} skuColon=${summary.directSku} x0=${summary.directX0} orderMatched=${summary.orderMatched} toExceptions=${summary.orderToExceptions}`);
    }

    const totals = summaries.reduce(
      (acc, s) => {
        acc.totalRows += s.totalRows;
        acc.processed += s.processed;
        acc.skippedMissingTracking += s.skippedMissingTracking;
        acc.directSku += s.directSku;
        acc.directX0 += s.directX0;
        acc.orderMatched += s.orderMatched;
        acc.orderToExceptions += s.orderToExceptions;
        return acc;
      },
      { totalRows: 0, processed: 0, skippedMissingTracking: 0, directSku: 0, directX0: 0, orderMatched: 0, orderToExceptions: 0 }
    );

    console.log('\n==== DRY RUN SUMMARY ====');
    console.log(`packer sheets: ${packerSheets.length}`);
    console.log(`sheet rows: ${totals.totalRows}`);
    console.log(`processed: ${totals.processed}`);
    console.log(`to packer_logs (SKU colon): ${totals.directSku}`);
    console.log(`to packer_logs (X0): ${totals.directX0}`);
    console.log(`to packer_logs (orders matched): ${totals.orderMatched}`);
    console.log(`to orders_exceptions: ${totals.orderToExceptions}`);
    console.log(`skipped missing tracking: ${totals.skippedMissingTracking}`);
  } finally {
    client.release();
    await pool.end();
  }
}

runDryRun().catch((err) => {
  console.error('Dry run failed:', err.message || err);
  process.exit(1);
});
