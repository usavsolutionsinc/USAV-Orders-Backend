/**
 * Zoho OAuth token storage backed by the `ebay_accounts` table.
 *
 * The ZOHO_MAIN row is seeded by the migration and updated by the OAuth
 * callback. This replaces the previous Upstash KV implementation while
 * keeping the same exported function signatures so no other files need
 * to change.
 *
 * Table: ebay_accounts  (account_name = 'ZOHO_MAIN', platform = 'ZOHO')
 *   access_token          — current short-lived access token
 *   token_expires_at      — when the access token expires
 *   refresh_token         — long-lived refresh token (never expires automatically)
 *   refresh_token_expires_at — set far in the future; not a real expiry for Zoho
 */

import pool from '@/lib/db';

const ZOHO_ACCOUNT = 'ZOHO_MAIN';

/**
 * Returns the cached Zoho access token if it is still valid (> 5 min remaining),
 * otherwise returns null so the caller will trigger a token refresh.
 */
export async function getCachedZohoAccessToken(): Promise<string | null> {
  try {
    const res = await pool.query<{ access_token: string }>(
      `SELECT access_token FROM ebay_accounts
       WHERE account_name = $1
         AND token_expires_at > NOW() + INTERVAL '5 minutes'
       LIMIT 1`,
      [ZOHO_ACCOUNT]
    );
    const token = res.rows[0]?.access_token;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/** Returns the stored Zoho refresh token, or null if none is saved yet. */
export async function getZohoRefreshTokenFromKv(): Promise<string | null> {
  try {
    const res = await pool.query<{ refresh_token: string }>(
      `SELECT refresh_token FROM ebay_accounts WHERE account_name = $1 LIMIT 1`,
      [ZOHO_ACCOUNT]
    );
    const token = res.rows[0]?.refresh_token;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/**
 * Persists Zoho tokens to the database.
 * - accessToken + expiry are always updated.
 * - refreshToken is only updated when provided (never cleared on a refresh grant).
 */
export async function setZohoTokens(tokens: {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

  if (tokens.refreshToken) {
    await pool.query(
      `INSERT INTO ebay_accounts
         (account_name, platform, access_token, refresh_token,
          token_expires_at, refresh_token_expires_at, is_active)
       VALUES ($1, 'ZOHO', $2, $3, $4, NOW() + INTERVAL '10 years', true)
       ON CONFLICT (account_name) DO UPDATE SET
         access_token          = EXCLUDED.access_token,
         refresh_token         = EXCLUDED.refresh_token,
         token_expires_at      = EXCLUDED.token_expires_at,
         updated_at            = NOW()`,
      [ZOHO_ACCOUNT, tokens.accessToken, tokens.refreshToken, expiresAt]
    );
  } else {
    await pool.query(
      `INSERT INTO ebay_accounts
         (account_name, platform, access_token, refresh_token,
          token_expires_at, refresh_token_expires_at, is_active)
       VALUES ($1, 'ZOHO', $2, '', $3, NOW() + INTERVAL '10 years', true)
       ON CONFLICT (account_name) DO UPDATE SET
         access_token     = EXCLUDED.access_token,
         token_expires_at = EXCLUDED.token_expires_at,
         updated_at       = NOW()`,
      [ZOHO_ACCOUNT, tokens.accessToken, expiresAt]
    );
  }
}

/** Clears the Zoho access token (forces a refresh on the next call). */
export async function clearZohoTokens(): Promise<void> {
  try {
    await pool.query(
      `UPDATE ebay_accounts
       SET access_token = '', token_expires_at = NOW(), updated_at = NOW()
       WHERE account_name = $1`,
      [ZOHO_ACCOUNT]
    );
  } catch {
    // Ignore — row may not exist yet before first OAuth
  }
}
