import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { decryptIntegrationPayload } from '@/lib/integrations/crypto';
import { tenantQuery } from '@/lib/tenancy/db';
import { recordAudit } from '@/lib/audit-logs';
import { writeEbayToken } from '@/lib/ebay/token-refresh';
import { getEbayAppCreds } from '@/lib/ebay/credentials';
import {
  ebayIdentityEndpoint,
  ebayTokenEndpoint,
  normalizeEbayEnvironment,
  normalizeEbayRole,
  EBAY_OAUTH_STATE_COOKIE,
} from '@/lib/ebay/oauth-config';
import { syncEbayAccountsToPlatformAccounts } from '@/lib/neon/catalog-queries';

/** State freshness window — aligned with the connect cookie's maxAge (10 min). */
const STATE_TTL_MS = 10 * 60 * 1000;

interface EbayOauthState {
  organizationId: string;
  accountName: string;
  environment?: string;
  /** 'seller' | 'buyer' — the purchasing-account discriminator (default seller). */
  role?: string;
  createdBy?: number | null;
  nonce?: string;
  issuedAt?: number;
}

/**
 * GET /api/ebay/callback
 * Landing route for the eBay OAuth redirect (configured as the RuName target).
 * No withAuth — eBay's server-side redirect carries no app session; tenant +
 * user identity come from the encrypted, cookie-bound `state`.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  // Single-use nonce: clear it on every terminal outcome.
  const finish = (query: string) => {
    const res = NextResponse.redirect(`${origin}/settings/integrations?${query}`);
    res.cookies.delete(EBAY_OAUTH_STATE_COOKIE);
    return res;
  };

  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const oauthError = searchParams.get('error');

    // Seller declined / cancelled consent (eBay appends error / error_description).
    if (oauthError) {
      return finish('error=ebay_consent_declined');
    }

    if (!code || !state) {
      return finish('error=ebay_missing_oauth_params');
    }

    let parsed: EbayOauthState;
    try {
      parsed = decryptIntegrationPayload<EbayOauthState>(state);
    } catch {
      return finish('error=ebay_invalid_oauth_state');
    }

    const { organizationId, accountName, createdBy, nonce, issuedAt } = parsed;
    if (!organizationId || !accountName || !nonce) {
      return finish('error=ebay_incomplete_oauth_state');
    }
    // Purchasing-account difference: buyer connections are stamped account_role='buyer'.
    const accountRole = normalizeEbayRole(parsed.role);

    // Freshness — reject stale/replayed authorize requests.
    if (!issuedAt || Date.now() - issuedAt > STATE_TTL_MS) {
      return finish('error=ebay_oauth_state_expired');
    }

    // CSRF: the nonce in `state` must match the httpOnly cookie set at connect —
    // proves the callback returned to the same browser that initiated the flow.
    const cookieNonce = req.cookies.get(EBAY_OAUTH_STATE_COOKIE)?.value;
    if (!cookieNonce || cookieNonce !== nonce) {
      return finish('error=ebay_invalid_oauth_state');
    }

    const creds = await getEbayAppCreds(organizationId);
    if (!creds) {
      return finish('error=ebay_server_configuration');
    }
    const environment = normalizeEbayEnvironment(parsed.environment ?? creds.environment);

    // Exchange the authorization code for tokens (server-side, Basic auth).
    const base64Auth = Buffer.from(`${creds.appId}:${creds.certId}`).toString('base64');
    const tokenResponse = await fetch(ebayTokenEndpoint(environment), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${base64Auth}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: creds.ruName,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      // Surface the status only — the raw body can echo request context.
      console.error('[ebay/callback] Token exchange failed: HTTP', tokenResponse.status);
      return finish('error=ebay_token_exchange_failed');
    }

    const data = await tokenResponse.json();

    // Best-effort: resolve the eBay username/userId for the account label.
    let ebayUserId = '';
    try {
      const profileResponse = await fetch(ebayIdentityEndpoint(environment), {
        method: 'GET',
        headers: { Authorization: `Bearer ${data.access_token}`, Accept: 'application/json' },
      });
      if (profileResponse.ok) {
        const profileData = await profileResponse.json();
        ebayUserId = profileData.userId || profileData.username || '';
      }
    } catch {
      /* non-fatal — identity probe is informational only */
    }

    // Encrypt tokens with the KMS-aware writer so the read side (readEbayToken)
    // stays consistent (previously the callback used raw encryptIntegrationPayload).
    const encryptedAccessToken = writeEbayToken(data.access_token);
    const encryptedRefreshToken = writeEbayToken(data.refresh_token);

    const tokenExpiresAt = new Date(Date.now() + (data.expires_in || 7200) * 1000);
    const refreshTokenExpiresAt = new Date(
      Date.now() + (data.refresh_token_expires_in || 18 * 30 * 24 * 3600) * 1000,
    );

    await tenantQuery(
      organizationId,
      `INSERT INTO ebay_accounts (
        organization_id, account_name, ebay_user_id, access_token, refresh_token,
        token_expires_at, refresh_token_expires_at, marketplace_id, platform, account_role, is_active, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'EBAY', $9, true, NOW())
      ON CONFLICT (organization_id, account_name) DO UPDATE
      SET ebay_user_id            = EXCLUDED.ebay_user_id,
          access_token            = EXCLUDED.access_token,
          refresh_token           = EXCLUDED.refresh_token,
          token_expires_at        = EXCLUDED.token_expires_at,
          refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
          platform                = 'EBAY',
          account_role            = EXCLUDED.account_role,
          is_active               = true,
          updated_at              = NOW()`,
      [
        organizationId,
        accountName,
        ebayUserId || null,
        encryptedAccessToken,
        encryptedRefreshToken,
        tokenExpiresAt,
        refreshTokenExpiresAt,
        'EBAY_US',
        accountRole,
      ],
    );

    // Keep platform_accounts (catalog + Incoming account chip) aligned with the
    // new seller row — seedOrgCatalog only runs at org creation, not on connect.
    try {
      await syncEbayAccountsToPlatformAccounts(organizationId);
    } catch (syncErr: unknown) {
      console.warn(
        '[ebay/callback] platform_accounts sync failed:',
        syncErr instanceof Error ? syncErr.message : syncErr,
      );
    }

    // Audit (no auth context — pass org/actor overrides, the documented path).
    try {
      await recordAudit(pool, null, null, {
        source: 'ebay',
        action: 'integrations.ebay.connected',
        entityType: 'ebay_account',
        entityId: accountName,
        organizationIdOverride: organizationId,
        actorStaffIdOverride: createdBy ?? null,
        after: { ebayUserId: ebayUserId || null, environment, accountRole },
      });
    } catch (auditErr: any) {
      console.warn('[ebay/callback] audit write failed:', auditErr?.message || auditErr);
    }

    return finish('success=ebay_connected');
  } catch (error: any) {
    console.error('[ebay/callback] Unexpected error:', error?.message || error);
    return finish('error=ebay_callback_failed');
  }
}
