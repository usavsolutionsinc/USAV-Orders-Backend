#!/usr/bin/env node
/**
 * Standalone script: Import all Zoho Purchase Orders into receiving / receiving_lines.
 *
 * Usage:
 *   node scripts/import-zoho-pos.js
 *   node scripts/import-zoho-pos.js --status open
 *   node scripts/import-zoho-pos.js --days-back 365
 *   node scripts/import-zoho-pos.js --all          (no date filter)
 *
 * Reads credentials from .env (dotenv) in the project root.
 * Applies the migration (adds columns) before syncing.
 */

require('dotenv').config();
const { Pool } = require('pg');

// ─── Config ──────────────────────────────────────────────────────────────────

const DB_URL        = process.env.DATABASE_URL;
const ZOHO_ORG_ID   = process.env.ZOHO_ORG_ID;
const ZOHO_DOMAIN   = process.env.ZOHO_DOMAIN || 'accounts.zoho.com';
const ZOHO_CLIENT_ID     = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;

const ZOHO_ACCOUNT = 'ZOHO_MAIN';

if (!DB_URL)  { console.error('❌  DATABASE_URL not set'); process.exit(1); }
if (!ZOHO_ORG_ID)   { console.error('❌  ZOHO_ORG_ID not set'); process.exit(1); }
if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET) {
  console.error('❌  ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET not set'); process.exit(1);
}

const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

// ─── Parse CLI args ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function argVal(flag) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

const STATUS_FILTER = argVal('--status') || '';
const DAYS_BACK = args.includes('--all') ? 0 : Number(argVal('--days-back') || 365);
const PER_PAGE  = 200;
const MAX_PAGES = 100;
const MAX_ITEMS = 10000;

// ─── Zoho token helpers (DB-backed via ebay_accounts) ────────────────────────

let _cachedToken = null;

async function dbGetZohoToken() {
  // 1. Check for still-valid access token
  const accRes = await pool.query(
    `SELECT access_token FROM ebay_accounts
     WHERE account_name = $1 AND token_expires_at > NOW() + INTERVAL '5 minutes'
     LIMIT 1`,
    [ZOHO_ACCOUNT]
  );
  const accessToken = accRes.rows[0]?.access_token;
  if (accessToken && accessToken.length > 0) return { accessToken, refreshToken: null };

  // 2. Get refresh token
  const refRes = await pool.query(
    `SELECT refresh_token FROM ebay_accounts WHERE account_name = $1 LIMIT 1`,
    [ZOHO_ACCOUNT]
  );
  const refreshToken = refRes.rows[0]?.refresh_token;
  return { accessToken: null, refreshToken: refreshToken || null };
}

async function dbSaveZohoAccessToken(accessToken, expiresIn) {
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  await pool.query(
    `INSERT INTO ebay_accounts
       (account_name, platform, access_token, refresh_token,
        token_expires_at, refresh_token_expires_at, is_active)
     VALUES ($1, 'ZOHO', $2, '', $3, NOW() + INTERVAL '10 years', true)
     ON CONFLICT (account_name) DO UPDATE SET
       access_token     = EXCLUDED.access_token,
       token_expires_at = EXCLUDED.token_expires_at,
       updated_at       = NOW()`,
    [ZOHO_ACCOUNT, accessToken, expiresAt]
  );
}

async function getAccessToken() {
  if (_cachedToken) return _cachedToken;

  const { accessToken: cached, refreshToken } = await dbGetZohoToken();
  if (cached) { _cachedToken = cached; return cached; }

  // Fall back to ZOHO_REFRESH_TOKEN env var if DB has nothing
  const refreshTokenResolved =
    refreshToken ||
    (process.env.ZOHO_REFRESH_TOKEN && process.env.ZOHO_REFRESH_TOKEN.trim()) ||
    null;

  if (!refreshTokenResolved) {
    throw new Error(
      'No Zoho refresh token available. ' +
      'Visit /api/zoho/oauth/authorize in your app to complete OAuth setup, ' +
      'or run: node scripts/set-zoho-token.js <refresh_token>'
    );
  }

  const params = new URLSearchParams({
    refresh_token: refreshTokenResolved,
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });

  const res = await fetch(`https://${ZOHO_DOMAIN}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`Token refresh error: ${data.error}`);

  const newToken = data.access_token;
  const expiresIn = data.expires_in_sec || data.expires_in || 3600;

  await dbSaveZohoAccessToken(newToken, expiresIn);
  _cachedToken = newToken;
  return newToken;
}

function getBaseUrl() {
  if (ZOHO_DOMAIN.includes('.eu')) return 'https://inventory.zohoapis.eu';
  if (ZOHO_DOMAIN.includes('.in')) return 'https://inventory.zohoapis.in';
  if (ZOHO_DOMAIN.includes('.com.au')) return 'https://inventory.zohoapis.com.au';
  if (ZOHO_DOMAIN.includes('.ca')) return 'https://inventory.zohoapis.ca';
  if (ZOHO_DOMAIN.includes('.jp')) return 'https://inventory.zohoapis.jp';
  return 'https://inventory.zohoapis.com';
}

async function zohoGet(path, query = {}) {
  const token = await getAccessToken();
  const params = new URLSearchParams({ organization_id: ZOHO_ORG_ID });
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const url = `${getBaseUrl()}${path}?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Zoho API ${res.status}: ${body}`);
  }
  return res.json();
}

// ─── Migration ────────────────────────────────────────────────────────────────

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('⚙️   Running migration...');
    await client.query(`
      ALTER TABLE receiving
        ADD COLUMN IF NOT EXISTS zoho_purchaseorder_id     TEXT,
        ADD COLUMN IF NOT EXISTS zoho_purchaseorder_number TEXT
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_receiving_zoho_po_id ON receiving(zoho_purchaseorder_id)
    `);
    await client.query(`
      ALTER TABLE receiving_lines
        ADD COLUMN IF NOT EXISTS zoho_purchase_receive_id TEXT,
        ADD COLUMN IF NOT EXISTS zoho_purchaseorder_id    TEXT,
        ADD COLUMN IF NOT EXISTS zoho_line_item_id        TEXT,
        ADD COLUMN IF NOT EXISTS item_name                TEXT,
        ADD COLUMN IF NOT EXISTS sku                      TEXT,
        ADD COLUMN IF NOT EXISTS quantity_received        INTEGER,
        ADD COLUMN IF NOT EXISTS quantity_expected        INTEGER,
        ADD COLUMN IF NOT EXISTS notes                    TEXT
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_receiving_lines_zoho_po_id ON receiving_lines(zoho_purchaseorder_id)
    `);
    console.log('✅  Migration complete.');
  } finally {
    client.release();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function asStr(...values) {
  for (const v of values) {
    if (typeof v === 'string') { const t = v.trim(); if (t) return t; }
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

function asPositiveInt(...values) {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 0;
}

// ─── Import one PO ───────────────────────────────────────────────────────────

async function importPO(rawPo, recCols, lineCols) {
  let zohoId = asStr(rawPo.purchaseorder_id, rawPo.purchase_order_id, rawPo.id);
  if (!zohoId) throw new Error('Missing purchaseorder_id');

  let data = rawPo;

  // Fetch detail to get line_items
  if (!Array.isArray(rawPo.line_items)) {
    try {
      const detail = await zohoGet(`/api/v1/purchaseorders/${encodeURIComponent(zohoId)}`);
      const inner = detail?.purchaseorder;
      if (inner && typeof inner === 'object') {
        data = inner;
        zohoId = asStr(data.purchaseorder_id, zohoId) ?? zohoId;
      }
    } catch (e) {
      console.warn(`  ⚠️  Detail fetch failed for ${zohoId}: ${e.message}`);
    }
  }

  const poNumber   = asStr(data.purchaseorder_number, data.po_number);
  const vendor     = asStr(data.vendor_name);
  const poDate     = asStr(data.date, data.purchase_date);
  const normDate   = poDate ? `${poDate.substring(0, 10)} 00:00:00` : new Date().toISOString();
  const warehouseId = asStr(data.warehouse_id);
  const lineItems   = Array.isArray(data.line_items) ? data.line_items : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const recValues = {
      receiving_date_time: normDate,
      receiving_tracking_number: poNumber ?? zohoId,
      carrier: 'ZOHO_PO',
      received_at: normDate,
      qa_status: 'PENDING',
      disposition_code: 'HOLD',
      condition_grade: 'BRAND_NEW',
      is_return: false,
      needs_test: false,
      zoho_warehouse_id: warehouseId,
      updated_at: new Date().toISOString(),
      ...(recCols.has('date_time') ? { date_time: normDate } : {}),
      ...(recCols.has('zoho_purchaseorder_id') ? { zoho_purchaseorder_id: zohoId } : {}),
      ...(recCols.has('zoho_purchaseorder_number') ? { zoho_purchaseorder_number: poNumber } : {}),
      ...(recCols.has('notes') && vendor ? { notes: vendor } : {}),
    };

    // Check existing
    let receivingId = null;
    let mode = 'created';
    if (recCols.has('zoho_purchaseorder_id')) {
      const existing = await client.query(
        `SELECT id FROM receiving WHERE zoho_purchaseorder_id = $1 ORDER BY id DESC LIMIT 1`,
        [zohoId]
      );
      if (existing.rows[0]?.id) { receivingId = existing.rows[0].id; mode = 'updated'; }
    }

    if (mode === 'updated') {
      const updates = []; const vals = []; let i = 1;
      for (const [col, val] of Object.entries(recValues)) {
        if (!recCols.has(col)) continue;
        updates.push(`${col} = $${i++}`); vals.push(val);
      }
      vals.push(receivingId);
      if (updates.length) {
        await client.query(`UPDATE receiving SET ${updates.join(', ')} WHERE id = $${vals.length}`, vals);
      }
    } else {
      const cols = []; const vals = [];
      for (const [col, val] of Object.entries(recValues)) {
        if (!recCols.has(col)) continue;
        cols.push(col); vals.push(val);
      }
      const ph = cols.map((_, i) => `$${i + 1}`).join(', ');
      const ins = await client.query(
        `INSERT INTO receiving (${cols.join(', ')}) VALUES (${ph}) RETURNING id`, vals
      );
      receivingId = ins.rows[0].id;
    }

    // receiving_lines
    let insertedLines = 0;
    if (receivingId && lineCols.size > 0) {
      await client.query(`DELETE FROM receiving_lines WHERE receiving_id = $1`, [receivingId]);

      for (const rawLine of lineItems) {
        if (!rawLine) continue;
        const zohoItemId   = asStr(rawLine.item_id);
        const zohoLineId   = asStr(rawLine.line_item_id, rawLine.id);
        const qty          = asPositiveInt(rawLine.quantity, rawLine.quantity_ordered);
        if (!zohoItemId || qty <= 0) continue;

        const lv = {
          receiving_id: receivingId,
          zoho_item_id: zohoItemId,
          zoho_line_item_id: zohoLineId,
          zoho_purchaseorder_id: zohoId,
          item_name: asStr(rawLine.name, rawLine.item_name),
          sku: asStr(rawLine.sku),
          quantity: qty,
          quantity_expected: qty,
          quantity_received: asPositiveInt(rawLine.quantity_received, rawLine.received_quantity),
          qa_status: 'PENDING',
          disposition_code: 'HOLD',
          condition_grade: 'BRAND_NEW',
          disposition_audit: '[]',
          notes: asStr(rawLine.description),
        };

        const cols = []; const vals = [];
        for (const [col, val] of Object.entries(lv)) {
          if (!lineCols.has(col)) continue;
          cols.push(col); vals.push(val);
        }
        if (cols.length === 0) continue;

        const ph = cols.map((c, i) =>
          c === 'disposition_audit' ? `$${i + 1}::jsonb` : `$${i + 1}`
        );
        await client.query(
          `INSERT INTO receiving_lines (${cols.join(', ')}) VALUES (${ph.join(', ')})`, vals
        );
        insertedLines++;
      }
    }

    await client.query('COMMIT');
    return { zohoId, poNumber, mode, insertedLines };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀  Zoho PO Import');
  console.log(`    Status filter : ${STATUS_FILTER || '(all)'}`);
  console.log(`    Days back     : ${DAYS_BACK === 0 ? 'all time' : DAYS_BACK}`);
  console.log('');

  await runMigration();

  // Pre-fetch column sets once
  const recColsRes = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'receiving'`
  );
  const recCols = new Set(recColsRes.rows.map(r => r.column_name));

  const hasLinesRes = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'receiving_lines') AS exists`
  );
  const lineColsRes = hasLinesRes.rows[0]?.exists
    ? await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'receiving_lines'`)
    : { rows: [] };
  const lineCols = new Set(lineColsRes.rows.map(r => r.column_name));

  let lastModifiedTime;
  if (DAYS_BACK > 0) {
    lastModifiedTime = new Date(Date.now() - DAYS_BACK * 86400 * 1000).toISOString();
  }

  let processed = 0, created = 0, updated = 0, failed = 0;
  const errors = [];

  for (let page = 1; page <= MAX_PAGES && processed < MAX_ITEMS; page++) {
    console.log(`📄  Fetching page ${page}...`);

    const query = { page, per_page: PER_PAGE };
    if (STATUS_FILTER) query.status = STATUS_FILTER;
    if (lastModifiedTime) query.last_modified_time = lastModifiedTime;

    let data;
    try {
      data = await zohoGet('/api/v1/purchaseorders', query);
    } catch (err) {
      console.error(`❌  Failed to fetch page ${page}: ${err.message}`);
      break;
    }

    const pos = Array.isArray(data?.purchaseorders) ? data.purchaseorders : [];
    if (pos.length === 0) { console.log('    No more results.'); break; }

    console.log(`    Got ${pos.length} POs.`);

    for (const po of pos) {
      if (processed >= MAX_ITEMS) break;
      processed++;

      const zohoId = asStr(po.purchaseorder_id, po.purchase_order_id, po.id) ?? 'unknown';
      try {
        const result = await importPO(po, recCols, lineCols);
        const icon = result.mode === 'created' ? '✅' : '🔄';
        console.log(`  ${icon} [${result.mode}] ${result.poNumber ?? zohoId} — ${result.insertedLines} line(s)`);
        if (result.mode === 'created') created++;
        else updated++;
      } catch (err) {
        failed++;
        console.error(`  ❌  ${zohoId}: ${err.message}`);
        errors.push({ purchaseorder_id: zohoId, error: err.message });
      }
    }

    const hasMore = Boolean(data?.page_context?.has_more_page);
    if (!hasMore) { console.log('    Last page reached.'); break; }
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Total processed : ${processed}`);
  console.log(`  Created         : ${created}`);
  console.log(`  Updated         : ${updated}`);
  console.log(`  Failed          : ${failed}`);
  if (errors.length) {
    console.log('\n  Errors:');
    errors.slice(0, 10).forEach(e => console.log(`    - ${e.purchaseorder_id}: ${e.error}`));
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err.message);
  pool.end().finally(() => process.exit(1));
});
