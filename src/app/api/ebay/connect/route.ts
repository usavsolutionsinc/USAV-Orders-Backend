import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { encryptIntegrationPayload } from '@/lib/integrations/crypto';

/**
 * GET /api/ebay/connect
 * Starts the multi-tenant eBay OAuth consent flow by building a state-encoded redirect URL.
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(req.url);
    const accountName = searchParams.get('accountName');

    if (!accountName) {
      return NextResponse.json({ error: 'accountName is required' }, { status: 400 });
    }

    const sandbox = process.env.EBAY_ENVIRONMENT !== 'PRODUCTION';
    const authDomain = sandbox ? 'auth.sandbox.ebay.com' : 'auth.ebay.com';
    const clientId = process.env.EBAY_APP_ID!;
    const ruName = process.env.EBAY_RU_NAME!;

    if (!clientId || !ruName) {
      return NextResponse.json({ error: 'eBay integration is not fully configured on the server' }, { status: 500 });
    }

    // Encrypt the target organizationId and accountName inside the OAuth state parameter
    const state = encryptIntegrationPayload({
      organizationId: ctx.organizationId,
      accountName,
    });

    const scopes = [
      'https://api.ebay.com/oauth/api_scope',
      'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
      'https://api.ebay.com/oauth/api_scope/sell.inventory',
      'https://api.ebay.com/oauth/api_scope/sell.marketing',
      'https://api.ebay.com/oauth/api_scope/sell.account',
    ].join(' ');

    const authUrl = `https://${authDomain}/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(ruName)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}&prompt=login`;

    return NextResponse.redirect(authUrl);
  } catch (error: any) {
    console.error('[ebay/connect] Failed to initiate connection:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: error.message }, { status: 500 });
  }
}, { permission: 'integrations.ebay' });
