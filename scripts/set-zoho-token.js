#!/usr/bin/env node
/**
 * Seed a Zoho refresh token directly into the ebay_accounts DB table.
 *
 * Usage:
 *   node scripts/set-zoho-token.js <refresh_token>
 *
 * Run this once after completing the Zoho OAuth flow manually, or paste
 * a refresh token you already have. The import script and the web app will
 * then use this token automatically.
 */

require('dotenv').config();
const { Pool } = require('pg');

const refreshToken = process.argv[2];
if (!refreshToken || refreshToken.length < 10) {
  console.error('Usage: node scripts/set-zoho-token.js <refresh_token>');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  // Apply the platform column migration first (idempotent)
  await pool.query(`ALTER TABLE ebay_accounts ADD COLUMN IF NOT EXISTS platform VARCHAR(20)`);
  await pool.query(`UPDATE ebay_accounts SET platform = 'EBAY' WHERE platform IS NULL`);

  await pool.query(
    `INSERT INTO ebay_accounts
       (account_name, platform, access_token, refresh_token,
        token_expires_at, refresh_token_expires_at, is_active)
     VALUES ('ZOHO_MAIN', 'ZOHO', '', $1, NOW(), NOW() + INTERVAL '10 years', true)
     ON CONFLICT (account_name) DO UPDATE SET
       refresh_token = EXCLUDED.refresh_token,
       platform      = 'ZOHO',
       updated_at    = NOW()`,
    [refreshToken]
  );

  console.log('✅  Zoho refresh token saved to database (ebay_accounts / ZOHO_MAIN).');
  console.log('    You can now run: node scripts/import-zoho-pos.js');
  await pool.end();
}

main().catch(err => {
  console.error('Error:', err.message);
  pool.end().finally(() => process.exit(1));
});
