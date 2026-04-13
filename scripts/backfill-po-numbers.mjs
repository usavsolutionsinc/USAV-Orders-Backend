#!/usr/bin/env node
/**
 * Backfill zoho_purchaseorder_number on receiving_lines that are not yet
 * fully received (workflow_status NOT IN ('DONE','SCRAP','RTV')).
 *
 * For each distinct zoho_purchaseorder_id missing a PO number, fetches the
 * human-readable number from Zoho and updates all matching lines.
 *
 * Usage:
 *   node scripts/backfill-po-numbers.mjs            # dry-run
 *   node scripts/backfill-po-numbers.mjs --apply     # actually write
 */

import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const ZOHO_ORG_ID = process.env.ZOHO_ORGANIZATION_ID || process.env.ZOHO_ORG_ID;

const dryRun = !process.argv.includes('--apply');
if (dryRun) console.log('DRY RUN — pass --apply to write changes\n');

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });

async function getZohoAccessToken() {
  const res = await pool.query(
    `SELECT access_token, refresh_token, expires_at FROM zoho_oauth_tokens ORDER BY id DESC LIMIT 1`
  );
  const row = res.rows[0];
  if (!row) throw new Error('No Zoho OAuth token found — authorize first via /api/zoho/oauth/authorize');

  if (new Date(row.expires_at) > new Date(Date.now() + 60_000)) {
    return row.access_token;
  }

  const refreshRes = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: row.refresh_token,
      client_id: process.env.ZOHO_CLIENT_ID || '',
      client_secret: process.env.ZOHO_CLIENT_SECRET || '',
      grant_type: 'refresh_token',
    }),
  });
  const data = await refreshRes.json();
  if (!data.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(data));

  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
  await pool.query(
    `UPDATE zoho_oauth_tokens SET access_token = $1, expires_at = $2 WHERE id = (SELECT id FROM zoho_oauth_tokens ORDER BY id DESC LIMIT 1)`,
    [data.access_token, expiresAt]
  );
  return data.access_token;
}

async function fetchPONumber(accessToken, poId) {
  const orgParam = ZOHO_ORG_ID ? `&organization_id=${ZOHO_ORG_ID}` : '';
  const url = `https://www.zohoapis.com/inventory/v1/purchaseorders/${poId}?${orgParam}`;
  const res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  if (!res.ok) {
    console.warn(`  ⚠ Failed to fetch PO ${poId}: ${res.status}`);
    return null;
  }
  const data = await res.json();
  return data?.purchaseorder?.purchaseorder_number || null;
}

async function main() {
  // Find distinct PO IDs on unreceived lines missing the PO number
  const { rows } = await pool.query(`
    SELECT DISTINCT zoho_purchaseorder_id
    FROM receiving_lines
    WHERE zoho_purchaseorder_id IS NOT NULL
      AND (zoho_purchaseorder_number IS NULL OR zoho_purchaseorder_number = '')
      AND (workflow_status IS NULL OR workflow_status NOT IN ('DONE', 'SCRAP', 'RTV'))
    ORDER BY zoho_purchaseorder_id
  `);

  console.log(`Found ${rows.length} PO IDs to backfill\n`);
  if (rows.length === 0) {
    await pool.end();
    return;
  }

  const accessToken = await getZohoAccessToken();
  let updated = 0;
  let failed = 0;

  for (const { zoho_purchaseorder_id: poId } of rows) {
    const poNumber = await fetchPONumber(accessToken, poId);
    if (!poNumber) {
      failed++;
      continue;
    }

    console.log(`  ${poId} → ${poNumber}`);

    if (!dryRun) {
      // Update receiving_lines
      const lineRes = await pool.query(
        `UPDATE receiving_lines SET zoho_purchaseorder_number = $1 WHERE zoho_purchaseorder_id = $2 AND (zoho_purchaseorder_number IS NULL OR zoho_purchaseorder_number = '')`,
        [poNumber, poId]
      );
      // Also backfill the receiving table
      const recRes = await pool.query(
        `UPDATE receiving SET zoho_purchaseorder_number = $1 WHERE zoho_purchaseorder_id = $2 AND (zoho_purchaseorder_number IS NULL OR zoho_purchaseorder_number = '')`,
        [poNumber, poId]
      );
      console.log(`    → ${lineRes.rowCount} lines, ${recRes.rowCount} receiving rows updated`);
    }
    updated++;

    // Rate limit: ~2 req/sec to stay under Zoho API limits
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\nDone: ${updated} backfilled, ${failed} failed`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
