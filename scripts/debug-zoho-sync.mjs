/**
 * Debug script: tests the full Zoho PO → receiving_lines sync pipeline.
 * Run: node scripts/debug-zoho-sync.mjs
 *
 * Pass --write to actually commit changes to the DB (default is dry-run).
 */
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const DRY_RUN = !process.argv.includes('--write');
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ZOHO_ORG_ID = process.env.ZOHO_ORG_ID;
const BASE_URL = 'https://inventory.zohoapis.com';

async function getToken() {
  const res = await pool.query(
    `SELECT access_token, token_expires_at, refresh_token
     FROM ebay_accounts WHERE account_name = 'ZOHO_MAIN' LIMIT 1`
  );
  const row = res.rows[0];
  if (!row) throw new Error('No ZOHO_MAIN row in ebay_accounts');
  console.log('  token_expires_at:', row.token_expires_at);
  console.log('  now:             ', new Date().toISOString());
  const valid = new Date(row.token_expires_at) > new Date();
  console.log('  token_valid:     ', valid);
  console.log('  has_refresh:     ', !!(row.refresh_token && row.refresh_token.length > 5));
  if (!valid) throw new Error('Access token is EXPIRED. Re-authorize via /api/zoho/oauth/authorize');
  return row.access_token;
}

let _token = null;
async function zohoGet(path, params = {}) {
  if (!_token) _token = await getToken();
  const qs = new URLSearchParams({ organization_id: ZOHO_ORG_ID, ...params });
  const url = `${BASE_URL}${path}?${qs}`;
  console.log('  GET', url.replace(ZOHO_ORG_ID, '<org_id>'));
  const r = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${_token}` } });
  const body = await r.text();
  if (!r.ok) throw new Error(`Zoho ${r.status}: ${body.slice(0, 300)}`);
  const json = JSON.parse(body);
  if (json.code && json.code !== 0) throw new Error(`Zoho error ${json.code}: ${json.message}`);
  return json;
}

async function main() {
  console.log(DRY_RUN ? '\n⚡ DRY-RUN mode (no DB writes). Pass --write to commit.\n' : '\n✏️  WRITE mode — changes will be committed to DB.\n');

  // ── Step 1: Token check ──────────────────────────────────────────────────────
  console.log('=== STEP 1: Check Zoho token ===');
  await getToken();

  // ── Step 2: List Purchase Orders ─────────────────────────────────────────────
  console.log('\n=== STEP 2: List Purchase Orders ===');
  let listData;
  try {
    listData = await zohoGet('/api/v1/purchaseorders', { per_page: 5 });
  } catch (e) {
    console.error('\n❌ FAILED listing POs:', e.message);
    await pool.end(); return;
  }
  const pos = listData.purchaseorders || [];
  console.log(`  Found ${pos.length} POs (first page)`);
  if (pos.length === 0) {
    console.log('  ⚠️  No purchase orders found in your Zoho org.');
    await pool.end(); return;
  }

  // Show first few PO summaries
  pos.slice(0, 3).forEach((po, i) => {
    console.log(`  [${i}] id=${po.purchaseorder_id}  num=${po.purchaseorder_number}  status=${po.status}  vendor=${po.vendor_name}`);
  });

  // ── Step 3: Get PO detail ────────────────────────────────────────────────────
  const firstPo = pos[0];
  const poId = String(firstPo.purchaseorder_id || firstPo.id || '');
  console.log(`\n=== STEP 3: Get PO detail for ${poId} ===`);
  let detailData;
  try {
    detailData = await zohoGet(`/api/v1/purchaseorders/${encodeURIComponent(poId)}`);
  } catch (e) {
    console.error('\n❌ FAILED getting PO detail:', e.message);
    await pool.end(); return;
  }

  const po = detailData.purchaseorder;
  console.log('  PO number:  ', po.purchaseorder_number);
  console.log('  Status:     ', po.status);
  console.log('  Date:       ', po.date);
  console.log('  Vendor:     ', po.vendor_name);
  console.log('  line_items: ', (po.line_items || []).length);
  console.log('  purchasereceives:', (po.purchasereceives || []).length);

  if ((po.line_items || []).length > 0) {
    const li = po.line_items[0];
    console.log('\n  First line item keys:', Object.keys(li).join(', '));
    console.log('  First line item sample:', JSON.stringify({
      item_id: li.item_id,
      line_item_id: li.line_item_id,
      name: li.name,
      sku: li.sku,
      quantity: li.quantity,
      quantity_received: li.quantity_received,
    }, null, 2));
  }

  // ── Step 4: Check DB schema ──────────────────────────────────────────────────
  console.log('\n=== STEP 4: Check DB schema ===');
  const [recSchema, lineSchema] = await Promise.all([
    pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='receiving' ORDER BY ordinal_position`),
    pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='receiving_lines' ORDER BY ordinal_position`),
  ]);
  const recCols = new Set(recSchema.rows.map(r => r.column_name));
  const lineCols = new Set(lineSchema.rows.map(r => r.column_name));
  console.log('  receiving cols:', [...recCols].join(', '));
  console.log('  receiving_lines cols:', [...lineCols].join(', '));
  console.log('  zoho_purchaseorder_id in receiving:', recCols.has('zoho_purchaseorder_id'));
  console.log('  zoho_purchaseorder_id in receiving_lines:', lineCols.has('zoho_purchaseorder_id'));

  // ── Step 5: Simulate / execute import ────────────────────────────────────────
  console.log(`\n=== STEP 5: ${DRY_RUN ? 'Simulate' : 'Execute'} import of PO ${poId} ===`);

  const normalizedPoId = String(po.purchaseorder_id || poId);
  const poNumber = po.purchaseorder_number || normalizedPoId;
  const poDate = po.date;
  const normalizedDate = poDate ? `${poDate} 00:00:00` : new Date().toISOString();

  const recValues = {
    receiving_tracking_number: poNumber,
    carrier: 'ZOHO-PO',
    received_at: normalizedDate,
    qa_status: 'PENDING',
    disposition_code: 'HOLD',
    condition_grade: 'BRAND_NEW',
    is_return: false,
    needs_test: false,
    zoho_purchaseorder_id: normalizedPoId,
    zoho_purchaseorder_number: poNumber,
    zoho_warehouse_id: po.warehouse_id || null,
    updated_at: new Date().toISOString(),
    ...(recCols.has('date_time') ? { date_time: normalizedDate } : {}),
    ...(recCols.has('receiving_date_time') ? { receiving_date_time: normalizedDate } : {}),
  };

  const validRecCols = Object.keys(recValues).filter(c => recCols.has(c));
  console.log('  receiving cols to insert:', validRecCols.join(', '));

  const lineItems = po.line_items || [];
  let validLines = 0;
  for (const li of lineItems) {
    if (li.item_id && Number(li.quantity) > 0) validLines++;
  }
  console.log(`  line items with valid item_id+quantity: ${validLines}/${lineItems.length}`);

  if (DRY_RUN) {
    console.log('\n✅ Dry-run complete — looks good! Run with --write to import.');
    await pool.end(); return;
  }

  // Actual write
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check for existing receiving record
    let receivingId = null;
    let mode = 'created';
    if (recCols.has('zoho_purchaseorder_id')) {
      const existing = await client.query(
        `SELECT id FROM receiving WHERE zoho_purchaseorder_id = $1 ORDER BY id DESC LIMIT 1`,
        [normalizedPoId]
      );
      if (existing.rows[0]?.id) {
        receivingId = existing.rows[0].id;
        mode = 'updated';
      }
    }

    if (receivingId) {
      const setClauses = validRecCols.map((c, i) => `${c} = $${i+1}`).join(', ');
      await client.query(
        `UPDATE receiving SET ${setClauses} WHERE id = $${validRecCols.length + 1}`,
        [...validRecCols.map(c => recValues[c]), receivingId]
      );
    } else {
      const cols = validRecCols;
      const vals = cols.map(c => recValues[c]);
      const placeholders = cols.map((_, i) => `$${i+1}`).join(', ');
      const r = await client.query(
        `INSERT INTO receiving (${cols.join(', ')}) VALUES (${placeholders}) RETURNING id`,
        vals
      );
      receivingId = r.rows[0].id;
    }

    // Delete existing lines
    await client.query(`DELETE FROM receiving_lines WHERE receiving_id = $1`, [receivingId]);

    // Insert line items
    let insertedLines = 0;
    for (const li of lineItems) {
      const zohoItemId = String(li.item_id || '').trim();
      if (!zohoItemId || Number(li.quantity) <= 0) continue;

      const lineValues = {
        receiving_id: receivingId,
        zoho_item_id: zohoItemId,
        zoho_line_item_id: String(li.line_item_id || li.id || '').trim() || null,
        zoho_purchaseorder_id: normalizedPoId,
        item_name: String(li.name || li.item_name || '').trim() || null,
        sku: String(li.sku || '').trim() || null,
        quantity_received: Math.floor(Number(li.quantity_received) || 0),
        quantity_expected: Math.floor(Number(li.quantity) || 0),
        qa_status: 'PENDING',
        disposition_code: 'HOLD',
        condition_grade: 'BRAND_NEW',
        disposition_audit: '[]',
        notes: String(li.description || '').trim() || null,
      };

      const cols = Object.keys(lineValues).filter(c => lineCols.has(c));
      if (!cols.includes('receiving_id')) continue;
      if (cols.length === 0) continue;

      const vals = cols.map(c => lineValues[c]);
      const placeholders = cols.map((c, i) => c === 'disposition_audit' ? `$${i+1}::jsonb` : `$${i+1}`);
      await client.query(
        `INSERT INTO receiving_lines (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
        vals
      );
      insertedLines++;
    }

    await client.query('COMMIT');
    console.log(`\n✅ Imported PO ${poNumber}:`);
    console.log(`   receiving.id = ${receivingId}  (${mode})`);
    console.log(`   receiving_lines inserted: ${insertedLines}`);
    client.release();
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    throw e;
  }

  await pool.end();
}

main().catch(async e => {
  console.error('\n❌ FATAL:', e.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
