/**
 * PO Gmail mailbox — auth plumbing only.
 *
 * Holds the refresh token for the dedicated purchase-order mailbox in
 * google_oauth_tokens (provider='po_gmail') and exposes:
 *   - getAccessToken(): refreshes when expired, persists the new token
 *   - poGmailFetch(): Bearer-authed wrapper around fetch() for Gmail API
 *
 * Implements the standard OAuth lifecycle (refresh, needs_reconnect, store
 * back) against the shared google_oauth_tokens table. Gmail-specific helpers
 * (list messages, modify labels, etc.) live in a separate file that's added
 * when we wire the email-reconcile pipeline — this module is auth only.
 */

import pool from '@/lib/db';

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const PO_GMAIL_SCOPE = [
  'https://www.googleapis.com/auth/gmail.modify',
  'openid',
  'email',
].join(' ');

const PROVIDER = 'po_gmail';

interface TokenRow {
  id: number;
  refresh_token: string;
  access_token: string | null;
  expires_at: string | null;
  account_email: string | null;
}

async function loadActiveToken(): Promise<TokenRow> {
  const { rows } = await pool.query<TokenRow>(
    `SELECT id, refresh_token, access_token, expires_at, account_email
       FROM google_oauth_tokens
      WHERE provider = $1
      LIMIT 1`,
    [PROVIDER],
  );
  if (!rows[0]) {
    throw new Error('PO mailbox is not connected. Visit Admin → PO Mailbox to connect.');
  }
  return rows[0];
}

async function markNeedsReconnect(reason: string): Promise<void> {
  await pool.query(
    `UPDATE google_oauth_tokens
        SET needs_reconnect = TRUE,
            needs_reconnect_reason = $1
      WHERE provider = $2`,
    [reason.slice(0, 500), PROVIDER],
  );
}

async function clearNeedsReconnect(): Promise<void> {
  await pool.query(
    `UPDATE google_oauth_tokens
        SET needs_reconnect = FALSE,
            needs_reconnect_reason = NULL
      WHERE provider = $1 AND needs_reconnect = TRUE`,
    [PROVIDER],
  );
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
  const clientId = process.env.PO_GMAIL_CLIENT_ID;
  const clientSecret = process.env.PO_GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('PO_GMAIL_CLIENT_ID / PO_GMAIL_CLIENT_SECRET are not set');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    // 400 / 401 here means the refresh token was revoked or rotated
    // (Google rotates test-mode tokens every 7 days). Flag the row so
    // the admin UI can surface a reconnect prompt.
    if (res.status === 400 || res.status === 401) {
      await markNeedsReconnect(`Token refresh rejected (${res.status}): ${text.slice(0, 200)}`);
    }
    throw new Error(`PO Gmail token refresh failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  await clearNeedsReconnect();
  return {
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + (json.expires_in - 60) * 1000),
  };
}

export async function getAccessToken(): Promise<string> {
  const row = await loadActiveToken();
  const now = Date.now();
  if (row.access_token && row.expires_at && new Date(row.expires_at).getTime() > now + 30_000) {
    return row.access_token;
  }
  const { accessToken, expiresAt } = await refreshAccessToken(row.refresh_token);
  await pool.query(
    `UPDATE google_oauth_tokens
        SET access_token = $1,
            expires_at = $2
      WHERE id = $3`,
    [accessToken, expiresAt.toISOString(), row.id],
  );
  return accessToken;
}

export async function poGmailFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

export async function getConnectedEmail(): Promise<string | null> {
  const { rows } = await pool.query<{ account_email: string | null }>(
    `SELECT account_email FROM google_oauth_tokens WHERE provider = $1 LIMIT 1`,
    [PROVIDER],
  );
  return rows[0]?.account_email ?? null;
}
