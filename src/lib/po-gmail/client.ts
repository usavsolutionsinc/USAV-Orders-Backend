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
import { USAV_ORG_ID } from '@/lib/tenancy/constants';

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const PO_GMAIL_SCOPE = [
  'https://www.googleapis.com/auth/gmail.modify',
  'openid',
  'email',
].join(' ');

const PROVIDER = 'po_gmail';

/**
 * Thrown when the PO mailbox can't be reached because it's not connected or its
 * Google refresh token was revoked/expired (invalid_grant — Google rotates
 * test-mode refresh tokens ~weekly). Callers map this to a 409 with a reconnect
 * prompt instead of an opaque 500, so the operator knows the fix is "reconnect
 * at Admin → PO Mailbox", not "retry".
 */
export class PoGmailNotConnectedError extends Error {
  constructor(message: string, public readonly needsReconnect: boolean) {
    super(message);
    this.name = 'PoGmailNotConnectedError';
  }
}

/**
 * Thrown when a tenant OTHER than USAV tries to read or refresh the PO
 * mailbox token. The `google_oauth_tokens` row is a global singleton
 * (provider='po_gmail', no organization_id column) belonging to USAV's
 * connected mailbox — there is intentionally one mailbox, not one per org.
 * This guard makes that ownership explicit so a non-USAV tenant can never
 * touch USAV's credentials, even though the table itself can't isolate rows
 * by org.
 */
export class PoGmailWrongTenantError extends Error {
  constructor() {
    super('PO mailbox belongs to USAV; other tenants cannot access it.');
    this.name = 'PoGmailWrongTenantError';
  }
}

/**
 * Singleton-mailbox tenant guard. The PO Gmail token has no organization_id
 * column, so RLS can't fence it — instead every token accessor takes an
 * `orgId` (defaulting to USAV's) and asserts it through here. Any non-USAV
 * org throws before a single byte of the token is read or refreshed.
 */
export function assertUsavMailbox(orgId: string): void {
  if (orgId !== USAV_ORG_ID) {
    throw new PoGmailWrongTenantError();
  }
}

/**
 * Soft, non-throwing companion to {@link assertUsavMailbox}. The PO Gmail
 * mailbox is a global singleton owned by USAV (see {@link PoGmailWrongTenantError}),
 * so it is only ever "available" to USAV today.
 *
 * Route handlers should call this FIRST and, when it returns false, short-circuit
 * with a clean "not configured for this org" result (empty list / `{ configured:
 * false }`) BEFORE invoking any token-touching function (`getAccessToken`,
 * `poGmailFetch`, …). Those functions still hard-guard via `assertUsavMailbox`,
 * so security is unchanged — this predicate just lets callers degrade gracefully
 * instead of catching a thrown `PoGmailWrongTenantError`.
 *
 * Note: this answers "is the PO mailbox feature available to this org at all",
 * NOT "is a mailbox currently connected" (that's a token-row read gated by the
 * hard guard). A non-USAV org is never available regardless of connection state.
 */
export function isPoGmailAvailableForOrg(orgId: string): boolean {
  return orgId === USAV_ORG_ID;
}

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
    throw new PoGmailNotConnectedError(
      'PO mailbox is not connected. Connect it at Admin → PO Mailbox.',
      false,
    );
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
      throw new PoGmailNotConnectedError(
        'PO mailbox needs reconnect — its Google token expired or was revoked. Reconnect at Admin → PO Mailbox.',
        true,
      );
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

export async function getAccessToken(orgId: string = USAV_ORG_ID): Promise<string> {
  assertUsavMailbox(orgId);
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

export async function poGmailFetch(
  url: string,
  init: RequestInit = {},
  orgId: string = USAV_ORG_ID,
): Promise<Response> {
  assertUsavMailbox(orgId);
  const token = await getAccessToken(orgId);
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

export async function getConnectedEmail(orgId: string = USAV_ORG_ID): Promise<string | null> {
  // Non-USAV tenants must not learn anything about USAV's mailbox — return
  // empty rather than throwing so connection-status reads degrade quietly.
  if (orgId !== USAV_ORG_ID) return null;
  const { rows } = await pool.query<{ account_email: string | null }>(
    `SELECT account_email FROM google_oauth_tokens WHERE provider = $1 LIMIT 1`,
    [PROVIDER],
  );
  return rows[0]?.account_email ?? null;
}
