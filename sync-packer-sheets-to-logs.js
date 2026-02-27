/**
 * Sync all packer_* sheets to packer_logs/orders_exceptions.
 *
 * Routing rules:
 * - If input includes ':' -> write directly to packer_logs as tracking_type='SKU'
 * - If input starts with X0 -> write directly to packer_logs as tracking_type='FNSKU'
 * - Otherwise treat as tracking number:
 *   - if matches orders.shipping_tracking_number -> write to packer_logs as tracking_type='ORDERS'
 *   - else -> write to orders_exceptions (source_station='packer')
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
  if (!clientEmail || !privateKey) {
    throw new Error('Missing GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY');
  }
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

async function ensureOrdersExceptionsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS orders_exceptions (
      id SERIAL PRIMARY KEY,
      shipping_tracking_number TEXT NOT NULL,
      source_station VARCHAR(20) NOT NULL,
      staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
      staff_name TEXT,
      exception_reason VARCHAR(50) NOT NULL DEFAULT 'not_found',
      notes TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
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

async function upsertPackerException(client, tracking, staffId) {
  const key18 = normalizeTrackingKey18(tracking);
  if (!key18) return;

  const existing = await client.query(
    `SELECT id
     FROM orders_exceptions
     WHERE source_station = 'packer'
       AND RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
     ORDER BY id DESC
     LIMIT 1`,
    [key18]
  );

  if (existing.rows.length > 0) {
    await client.query(
      `UPDATE orders_exceptions
       SET shipping_tracking_number = $1,
           source_station = 'packer',
           staff_id = COALESCE($2, staff_id),
           exception_reason = 'not_found',
           status = 'open',
           updated_at = NOW()
       WHERE id = $3`,
      [tracking, staffId ?? null, existing.rows[0].id]
    );
    return;
  }

  await client.query(
    `INSERT INTO orders_exceptions (
      shipping_tracking_number,
      source_station,
      staff_id,
      exception_reason,
      status,
      created_at,
      updated_at
    ) VALUES ($1, 'packer', $2, 'not_found', 'open', NOW(), NOW())`,
    [tracking, staffId ?? null]
  );
}

async function resolvePackerStaffId(client, sheetName) {
  const normalized = String(sheetName || '').trim().toLowerCase();
  const fallback = { packer_1: 4, packer_2: 5, packer_3: 6 };
  const staff = await client.query(
    `SELECT id
     FROM staff
     WHERE LOWER(COALESCE(source_table, '')) = $1
     ORDER BY active DESC, id ASC
     LIMIT 1`,
    [normalized]
  );
  return staff.rows[0]?.id ?? fallback[normalized] ?? null;
}

async function processPackerSheet(sheets, client, sheetName) {
  const packedBy = await resolvePackerStaffId(client, sheetName);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A2:B`,
  });

  const rows = response.data.values || [];
  let processed = 0;
  let skippedMissingTracking = 0;
  let insertedLogs = 0;
  let directLogs = 0;
  let orderLogs = 0;
  let exceptionsLogged = 0;

  for (const row of rows) {
    const packDateTime = String(row[0] || '').trim() || null;
    const scanInput = String(row[1] || '').trim();

    if (!scanInput) {
      skippedMissingTracking++;
      continue;
    }
    processed++;

    const isSkuColon = scanInput.includes(':');
    const isX0Like = /^X0/i.test(scanInput);

    let trackingType = 'ORDERS';
    if (isSkuColon) trackingType = 'SKU';
    if (isX0Like) trackingType = 'FNSKU';

    if (trackingType === 'ORDERS') {
      const match = await hasOrderByTracking(client, scanInput);
      if (!match) {
        await upsertPackerException(client, scanInput, packedBy);
        exceptionsLogged++;
        continue;
      }
      orderLogs++;
    } else {
      directLogs++;
    }

    await client.query(
      `INSERT INTO packer_logs (
         shipping_tracking_number,
         tracking_type,
         pack_date_time,
         packed_by
       ) VALUES ($1, $2, $3, $4)`,
      [scanInput, trackingType, packDateTime, packedBy]
    );
    insertedLogs++;
  }

  return {
    sheetName,
    packedBy,
    totalRows: rows.length,
    processed,
    skippedMissingTracking,
    insertedLogs,
    directLogs,
    orderLogs,
    exceptionsLogged,
  };
}

async function syncPackerSheets() {
  console.log('Starting packer_* sync to packer_logs/orders_exceptions...');
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const metadata = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const allSheetNames = (metadata.data.sheets || []).map((s) => s.properties?.title || '').filter(Boolean);
  const packerSheets = allSheetNames
    .filter((name) => /^packer_/i.test(String(name || '').trim()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  if (packerSheets.length === 0) {
    throw new Error('No packer_* sheets found');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureOrdersExceptionsTable(client);

    const summaries = [];
    for (const sheetName of packerSheets) {
      const summary = await processPackerSheet(sheets, client, sheetName);
      summaries.push(summary);
      console.log(`[${sheetName}] rows=${summary.totalRows} processed=${summary.processed} logs=${summary.insertedLogs} exceptions=${summary.exceptionsLogged}`);
    }

    await client.query('COMMIT');

    const totals = summaries.reduce(
      (acc, s) => {
        acc.totalRows += s.totalRows;
        acc.processed += s.processed;
        acc.insertedLogs += s.insertedLogs;
        acc.exceptionsLogged += s.exceptionsLogged;
        acc.directLogs += s.directLogs;
        acc.orderLogs += s.orderLogs;
        acc.skippedMissingTracking += s.skippedMissingTracking;
        return acc;
      },
      { totalRows: 0, processed: 0, insertedLogs: 0, exceptionsLogged: 0, directLogs: 0, orderLogs: 0, skippedMissingTracking: 0 }
    );

    console.log('\n==== SUMMARY ====');
    console.log(`packer sheets: ${packerSheets.length}`);
    console.log(`sheet rows: ${totals.totalRows}`);
    console.log(`processed: ${totals.processed}`);
    console.log(`packer_logs inserted: ${totals.insertedLogs}`);
    console.log(`  - direct logs (SKU/X0): ${totals.directLogs}`);
    console.log(`  - order logs (matched tracking): ${totals.orderLogs}`);
    console.log(`orders_exceptions upserted: ${totals.exceptionsLogged}`);
    console.log(`skipped missing tracking: ${totals.skippedMissingTracking}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

syncPackerSheets().catch((err) => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
