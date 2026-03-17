#!/usr/bin/env node
/**
 * Debug script: Compare Google Sheet transfer data with orders table.
 * NO transfer logic — just reads sheet + DB and reports why order_id matching fails.
 *
 * Usage:
 *   node scripts/debug-transfer-order-match.js 17-14367-78424
 *   node scripts/debug-transfer-order-match.js 17-14367-78424 --sheet "Sheet_3_17_2026"
 *   node scripts/debug-transfer-order-match.js 17-14367-78424 --all-tabs
 */

require('dotenv').config();
const { google } = require('googleapis');
const { Pool } = require('pg');

const SOURCE_SPREADSHEET_ID = '1b8uvgk4q7jJPjGvFM2TQs3vMES1o9MiAfbEJ7P1TW9w';

function findHeaderIndex(headers, candidates) {
  const idx = headers.findIndex((header) => {
    const normalized = String(header || '').trim().toLowerCase();
    return candidates.some((c) => normalized === c.trim().toLowerCase());
  });
  return idx;
}

function hexDump(str) {
  if (str == null || str === '') return '(empty)';
  return Array.from(str)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join(' ');
}

function inspectValue(val, label) {
  const s = String(val ?? '');
  const trimmed = s.trim();
  return {
    raw: s,
    trimmed,
    length: s.length,
    trimmedLength: trimmed.length,
    hex: hexDump(s),
    repr: JSON.stringify(s),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const targetOrderId = args.find((a) => !a.startsWith('--')) || '17-14367-78424';
  const manualSheet = args.includes('--sheet') ? args[args.indexOf('--sheet') + 1] : null;
  const allTabs = args.includes('--all-tabs');

  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  const dbUrl = process.env.DATABASE_URL;

  if (!clientEmail || !privateKey) {
    console.error('❌ GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY not set');
    process.exit(1);
  }
  if (!dbUrl) {
    console.error('❌ DATABASE_URL not set');
    process.exit(1);
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: (privateKey || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  DEBUG: Order ID match for "${targetOrderId}"`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1. Get spreadsheet and tabs
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SOURCE_SPREADSHEET_ID });
  const sourceTabs = spreadsheet.data.sheets || [];

  let tabsToCheck = [];
  if (manualSheet) {
    const t = sourceTabs.find((s) => (s.properties?.title || '') === manualSheet);
    if (!t) {
      console.error(`❌ Sheet tab "${manualSheet}" not found`);
      process.exit(1);
    }
    tabsToCheck = [manualSheet];
  } else if (allTabs) {
    tabsToCheck = sourceTabs.map((s) => s.properties?.title || '').filter(Boolean);
  } else {
    const dateTabs = sourceTabs
      .map((s) => s.properties?.title || '')
      .filter((t) => t.startsWith('Sheet_'))
      .map((title) => {
        const parts = title.split('_');
        if (parts.length < 4) return { title, date: new Date(0) };
        const mm = parseInt(parts[1], 10);
        const dd = parseInt(parts[2], 10);
        const yyyy = parseInt(parts[3], 10);
        return { title, date: new Date(yyyy, mm - 1, dd) };
      })
      .sort((a, b) => b.date.getTime() - a.date.getTime());
    tabsToCheck = dateTabs.length > 0 ? [dateTabs[0].title] : [sourceTabs[0]?.properties?.title].filter(Boolean);
  }

  console.log('Tabs to check:', tabsToCheck.join(', '));

  // 2. Query orders table for this order_id (exact + variations)
  const orderIdNorm = targetOrderId.replace(/-/g, '');
  const dbExact = await pool.query(
    `SELECT id, order_id, product_title, condition, item_number, quantity, sku, notes, shipment_id, created_at
     FROM orders
     WHERE order_id = $1
     ORDER BY created_at DESC`,
    [targetOrderId]
  );
  const dbLike = await pool.query(
    `SELECT id, order_id, product_title, condition, item_number, quantity, sku, notes, shipment_id, created_at
     FROM orders
     WHERE REPLACE(order_id, '-', '') = $1
        OR order_id LIKE $2
        OR order_id LIKE $3
     ORDER BY created_at DESC`,
    [orderIdNorm, `%${targetOrderId}%`, `%${orderIdNorm}%`]
  );

  console.log('\n--- ORDERS TABLE ---');
  console.log(`Exact match (order_id = '${targetOrderId}'): ${dbExact.rows.length} row(s)`);
  if (dbExact.rows.length > 0) {
    dbExact.rows.forEach((r, i) => {
      console.log(`  [${i}] id=${r.id} order_id=${JSON.stringify(r.order_id)} product_title=${JSON.stringify(r.product_title)} condition=${JSON.stringify(r.condition)}`);
    });
  }
  console.log(`LIKE/variant match: ${dbLike.rows.length} row(s)`);
  if (dbLike.rows.length > 0 && dbLike.rows.length !== dbExact.rows.length) {
    dbLike.rows.forEach((r, i) => {
      console.log(`  [${i}] id=${r.id} order_id=${JSON.stringify(r.order_id)}`);
    });
  }

  // 3. Read each tab and find matching rows (NO eligibility filter)
  for (const tabName of tabsToCheck) {
    console.log(`\n--- SHEET: ${tabName} ---`);
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SOURCE_SPREADSHEET_ID,
      range: `${tabName}!A1:Z`,
    });
    const rows = resp.data.values || [];
    if (rows.length < 2) {
      console.log('  (no data rows)');
      continue;
    }

    const headerRow = rows[0];
    const colOrderNumber = findHeaderIndex(headerRow, ['Order Number', 'Order - Number']);
    const colItemTitle = findHeaderIndex(headerRow, ['Item title', 'Item Title']);
    const colCondition = findHeaderIndex(headerRow, ['Condition']);
    const colTracking = findHeaderIndex(headerRow, ['Tracking', 'Shipment - Tracking Number']);
    const colPlatform = findHeaderIndex(headerRow, ['Platform', 'Account Source', 'Channel']);

    console.log(`  Header indices: orderNumber=${colOrderNumber} itemTitle=${colItemTitle} condition=${colCondition} tracking=${colTracking} platform=${colPlatform}`);

    const matchingRows = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rawOrderNum = row[colOrderNumber];
      const orderNum = String(rawOrderNum ?? '').trim();
      const containsTarget = orderNum.includes(targetOrderId) || orderNum.replace(/-/g, '').includes(orderIdNorm);
      if (containsTarget || orderNum === targetOrderId) {
        matchingRows.push({ rowIndex: i + 1, row, orderNum, rawOrderNum });
      }
    }

    console.log(`  Rows with Order Number matching "${targetOrderId}": ${matchingRows.length}`);
    if (matchingRows.length === 0) {
      console.log('  No matching rows in this tab.');
      continue;
    }

    for (const { rowIndex, row, orderNum, rawOrderNum } of matchingRows) {
      const tracking = String(row[colTracking] ?? '').trim();
      const platform = colPlatform >= 0 ? String(row[colPlatform] ?? '').trim() : '';
      const itemTitle = colItemTitle >= 0 ? String(row[colItemTitle] ?? '').trim() : '';
      const condition = colCondition >= 0 ? String(row[colCondition] ?? '').trim() : '';

      console.log(`\n  Row ${rowIndex}:`);
      console.log(`    Order Number: ${JSON.stringify(orderNum)}`);
      console.log(`    Raw Order Number: ${JSON.stringify(rawOrderNum)}`);
      console.log(`    Order Number inspect:`, inspectValue(rawOrderNum, 'orderNumber'));
      console.log(`    Item Title: ${JSON.stringify(itemTitle)}`);
      console.log(`    Condition: ${JSON.stringify(condition)}`);
      console.log(`    Tracking: ${JSON.stringify(tracking)}`);
      console.log(`    Platform: ${JSON.stringify(platform)}`);

      const wouldBeEligible = orderNum && (colPlatform < 0 || platform);
      console.log(`    Would pass eligibility (orderId + platform): ${wouldBeEligible}`);

      if (dbExact.rows.length === 0) {
        console.log(`    ⚠️  No exact order_id match in DB. Possible causes:`);
        console.log(`       - order_id in DB has different format (e.g. "171436778424" vs "17-14367-78424")`);
        console.log(`       - Hidden chars / encoding in sheet: hex=${hexDump(orderNum)}`);
        console.log(`       - Order not yet in orders table`);
      }
    }
  }

  // 4. Summary: why transfer wouldn't match
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  DIAGNOSIS');
  console.log('═══════════════════════════════════════════════════════════════');
  if (dbExact.rows.length === 0 && dbLike.rows.length > 0) {
    console.log(`\n  DB has order(s) with SIMILAR order_id but not exact match:`);
    dbLike.rows.forEach((r) => {
      const insp = inspectValue(r.order_id, 'db');
      console.log(`    id=${r.id} order_id=${JSON.stringify(r.order_id)}`);
      console.log(`      hex: ${insp.hex}`);
    });
    console.log(`\n  Sheet uses: "${targetOrderId}"`);
    console.log(`  → Consider normalizing order_id (e.g. strip dashes) before matching.`);
  } else if (dbExact.rows.length === 0 && dbLike.rows.length === 0) {
    console.log(`\n  No orders in DB with order_id matching "${targetOrderId}".`);
    console.log(`  → Order may need to be created first (e.g. via eBay sync or manual add).`);
  } else {
    const withBlanks = dbExact.rows.filter((r) => !r.product_title?.trim() || !r.condition?.trim());
    if (dbExact.rows.length > 1 && withBlanks.length > 0) {
      console.log(`\n  Multiple orders (${dbExact.rows.length}) share order_id "${targetOrderId}".`);
      console.log(`  ${withBlanks.length} have blank product_title/condition and need backfill.`);
      console.log(`  → Transfer now backfills ALL matching orders, not just the most recent.`);
    } else {
      console.log(`\n  Exact match exists. Backfill should work if row is eligible.`);
      console.log(`  Check: platform filled, row included in latestSourceRowByKey.`);
    }
  }
  console.log('');

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
