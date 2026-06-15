import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';
import { upsertIntegrationCredentials, type AmazonCredentials } from '@/lib/integrations/credentials';
import { amazonAppConfig, getMarketplaceParticipations, type AmazonAccount } from '@/lib/amazon/client';
import { exchangeRefreshToken } from '@/lib/amazon/token-refresh';
import { amazonScopeForSeller } from '@/lib/amazon/accounts';
import { isAmazonRegion, DEFAULT_MARKETPLACE_ID } from '@/lib/amazon/constants';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/amazon/connect
 *
 * Bootstrap path (USAV / self-authorization): paste a refresh token obtained by
 * self-authorizing a private SP-API app. Verifies the connection works (LWA
 * exchange + getMarketplaceParticipations) BEFORE persisting, then stores the
 * per-seller creds in the vault + an amazon_accounts row. The public OAuth flow
 * (/api/amazon/oauth/*) is the multi-tenant path; this unblocks dogfooding while
 * the published Appstore app is in review.
 */
const Body = z.object({
  refreshToken: z.string().trim().min(10),
  accountName: z.string().trim().min(1).max(80).optional(),
  sellerId: z.string().trim().max(64).optional(),
  region: z.enum(['NA', 'EU', 'FE']).optional(),
  marketplaceIds: z.array(z.string().trim().min(1)).optional(),
  // Optional per-connection LWA app creds; otherwise the shared env app is used.
  // NOTE: lwaClientSecret is a secret — never echo the request body into the
  // audit `extra` payload (the audit floor below only reads response.accountName).
  lwaClientId: z.string().trim().optional(),
  lwaClientSecret: z.string().trim().optional(),
});

export const POST = withAuth(async (req, ctx) => {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'INVALID_INPUT', detail: err?.message }, { status: 400 });
  }

  const app = amazonAppConfig();
  const lwaClientId = body.lwaClientId || app.clientId;
  const lwaClientSecret = body.lwaClientSecret || app.clientSecret;
  if (!lwaClientId || !lwaClientSecret) {
    return NextResponse.json(
      { ok: false, error: 'Missing LWA client id/secret. Set AMAZON_LWA_CLIENT_ID/SECRET or pass them in the body.' },
      { status: 400 },
    );
  }

  const region = isAmazonRegion(body.region) ? body.region : 'NA';
  const creds: AmazonCredentials = {
    lwaClientId,
    lwaClientSecret,
    refreshToken: body.refreshToken,
    region,
    marketplaceIds: body.marketplaceIds?.length ? body.marketplaceIds : [DEFAULT_MARKETPLACE_ID],
    sellerId: body.sellerId,
  };

  // Verify before persisting.
  let marketplaces: Array<{ marketplaceId: string; countryCode?: string; name?: string }>;
  try {
    const { accessToken } = await exchangeRefreshToken(lwaClientId, lwaClientSecret, body.refreshToken);
    const probe: AmazonAccount = {
      id: 0, organizationId: ctx.organizationId, accountName: 'amazon', sellerId: body.sellerId || null,
      region, marketplaceIds: creds.marketplaceIds, accessToken: null, accessTokenExpiresAt: null,
    };
    marketplaces = await getMarketplaceParticipations(probe, creds, { accessToken });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: `Connection verification failed: ${err?.message || err}` },
      { status: 400 },
    );
  }

  if (marketplaces.length) creds.marketplaceIds = marketplaces.map((m) => m.marketplaceId);
  const accountName = body.accountName || (body.sellerId ? `amazon-${body.sellerId}` : 'amazon');

  await upsertIntegrationCredentials({
    orgId: ctx.organizationId,
    provider: 'amazon',
    scope: amazonScopeForSeller(body.sellerId),
    payload: creds,
    displayLabel: accountName,
    createdBy: ctx.staffId,
  });

  await tenantQuery(
    ctx.organizationId,
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
    [ctx.organizationId, accountName, body.sellerId || null, region, JSON.stringify(creds.marketplaceIds), ctx.staffId],
  );

  return NextResponse.json({ ok: true, accountName, sellerId: body.sellerId || null, marketplaces });
}, {
  permission: 'integrations.amazon',
  audit: {
    source: 'admin',
    action: 'integrations.amazon.connected',
    entityType: 'amazon_account',
    entityId: ({ response }) => (response as { accountName?: string } | null)?.accountName ?? null,
  },
});
