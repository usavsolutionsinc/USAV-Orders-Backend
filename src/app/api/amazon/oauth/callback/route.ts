import { NextRequest, NextResponse } from 'next/server';
import { decryptIntegrationPayload } from '@/lib/integrations/crypto';
import { tenantQuery } from '@/lib/tenancy/db';
import { upsertIntegrationCredentials, type AmazonCredentials } from '@/lib/integrations/credentials';
import { amazonAppConfig, getMarketplaceParticipations, type AmazonAccount } from '@/lib/amazon/client';
import { exchangeAuthCode } from '@/lib/amazon/token-refresh';
import { amazonScopeForSeller } from '@/lib/amazon/accounts';
import { isAmazonRegion, DEFAULT_MARKETPLACE_ID, type AmazonRegion } from '@/lib/amazon/constants';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STATE_TTL_MS = 15 * 60 * 1000;

/**
 * GET /api/amazon/oauth/callback
 *
 * Amazon's server-side redirect after consent. No session cookie is present, so
 * tenant scope is recovered purely from the encrypted `state` (AES-GCM = tamper
 * proof, with a 15-min freshness window). Exchanges spapi_oauth_code for a
 * refresh token, stores it in the org vault, and upserts the amazon_accounts row.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const back = (q: string) => NextResponse.redirect(`${origin}/settings/integrations?${q}`);

  try {
    const sp = req.nextUrl.searchParams;
    const code = sp.get('spapi_oauth_code') || sp.get('code');
    const state = sp.get('state');
    const sellerId = sp.get('selling_partner_id');

    if (!code || !state) return back('error=amazon_missing_oauth_params');

    let parsed: { organizationId: string; createdBy?: number; region?: AmazonRegion; issuedAt?: number };
    try {
      parsed = decryptIntegrationPayload(state);
    } catch {
      return back('error=amazon_invalid_oauth_state');
    }

    const organizationId = parsed.organizationId;
    const createdBy = parsed.createdBy ?? null;
    const region: AmazonRegion = isAmazonRegion(parsed.region) ? parsed.region : 'NA';
    if (!organizationId) return back('error=amazon_incomplete_oauth_state');
    if (!parsed.issuedAt || Date.now() - parsed.issuedAt > STATE_TTL_MS) {
      return back('error=amazon_oauth_state_expired');
    }

    const app = amazonAppConfig();
    if (!app.clientId || !app.clientSecret || !app.redirectUri) {
      return back('error=amazon_server_configuration');
    }

    const { refreshToken, accessToken } = await exchangeAuthCode(
      app.clientId, app.clientSecret, code, app.redirectUri,
    );

    const creds: AmazonCredentials = {
      lwaClientId: app.clientId,
      lwaClientSecret: app.clientSecret,
      refreshToken,
      region,
      marketplaceIds: [],
      sellerId: sellerId || undefined,
    };

    // Verify + discover marketplaces with the token we just minted (best-effort).
    let marketplaceIds: string[] = [];
    try {
      const probe: AmazonAccount = {
        id: 0, organizationId, accountName: 'amazon', sellerId: sellerId || null,
        region, marketplaceIds: [], accessToken: null, accessTokenExpiresAt: null,
      };
      const parts = await getMarketplaceParticipations(probe, creds, { accessToken });
      marketplaceIds = parts.map((p) => p.marketplaceId);
    } catch (err) {
      console.warn('[amazon/callback] marketplace probe failed (non-fatal):', err instanceof Error ? err.message : err);
    }
    if (marketplaceIds.length === 0) marketplaceIds = [DEFAULT_MARKETPLACE_ID];
    creds.marketplaceIds = marketplaceIds;

    const accountName = sellerId ? `amazon-${sellerId}` : 'amazon';

    await upsertIntegrationCredentials({
      orgId: organizationId,
      provider: 'amazon',
      scope: amazonScopeForSeller(sellerId),
      payload: creds,
      displayLabel: accountName,
      createdBy,
    });

    await tenantQuery(
      organizationId,
      `INSERT INTO amazon_accounts
         (organization_id, account_name, seller_id, region, marketplace_ids, status, is_active, created_by, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'active', true, $6, now())
       ON CONFLICT (organization_id, account_name) DO UPDATE
         SET seller_id       = EXCLUDED.seller_id,
             region          = EXCLUDED.region,
             marketplace_ids = EXCLUDED.marketplace_ids,
             status          = 'active',
             last_error      = NULL,
             is_active       = true,
             updated_at      = now()`,
      [organizationId, accountName, sellerId || null, region, JSON.stringify(marketplaceIds), createdBy],
    );

    return back('success=amazon_connected');
  } catch (err) {
    // Scope to the message — the raw error may carry LWA token/secret context.
    console.error('[amazon/callback] unexpected error:', err instanceof Error ? err.message : String(err));
    return back('error=amazon_callback_failed');
  }
}
