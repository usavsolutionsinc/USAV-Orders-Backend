import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { assertCanConnectProvider } from '@/lib/integrations/connectors/connections';
import { encryptIntegrationPayload } from '@/lib/integrations/crypto';
import { amazonAppConfig } from '@/lib/amazon/client';
import { SELLERCENTRAL_HOSTS, isAmazonRegion, type AmazonRegion } from '@/lib/amazon/constants';

export const dynamic = 'force-dynamic';

/**
 * GET /api/amazon/oauth/start
 *
 * Multi-tenant connect: redirects the owner to Amazon's Seller Central consent
 * screen. Tenant identity travels in an encrypted (tamper-proof) `state` so the
 * callback — hit by Amazon's server-side redirect without our cookies — can
 * recover the org. Amazon redirects back to the app's configured OAuth Redirect
 * URI with `spapi_oauth_code` + `selling_partner_id`.
 */
export const GET = withAuth(async (req, ctx) => {
  // Plan ceiling: connecting a NEW provider must fit the org's maxIntegrations.
  const refusal = await assertCanConnectProvider(ctx.organizationId, 'amazon');
  if (refusal) return NextResponse.json(refusal, { status: 403 });

  const app = amazonAppConfig();
  if (!app.appId || !app.clientId || !app.clientSecret || !app.redirectUri) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Amazon SP-API app is not configured. Set AMAZON_APP_ID, AMAZON_LWA_CLIENT_ID, ' +
          'AMAZON_LWA_CLIENT_SECRET and AMAZON_OAUTH_REDIRECT_URI.',
      },
      { status: 500 },
    );
  }

  const regionParam = req.nextUrl.searchParams.get('region');
  const region: AmazonRegion = isAmazonRegion(regionParam) ? regionParam : 'NA';

  const state = encryptIntegrationPayload({
    organizationId: ctx.organizationId,
    createdBy: ctx.staffId,
    region,
    issuedAt: Date.now(),
  });

  const consent = new URL('/apps/authorize/consent', SELLERCENTRAL_HOSTS[region]);
  consent.searchParams.set('application_id', app.appId);
  consent.searchParams.set('state', state);
  // Draft (un-published) apps require version=beta on the consent URL.
  if (app.draft) consent.searchParams.set('version', 'beta');

  return NextResponse.redirect(consent.toString());
}, { permission: 'integrations.amazon' });
