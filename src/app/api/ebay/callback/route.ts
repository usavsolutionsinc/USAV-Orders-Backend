import { NextRequest, NextResponse } from 'next/server';
import { decryptIntegrationPayload, encryptIntegrationPayload } from '@/lib/integrations/crypto';
import { tenantQuery } from '@/lib/tenancy/db';

/**
 * GET /api/ebay/callback
 * Handles the OAuth redirection from eBay, exchanges the auth code for tokens,
 * fetches the profile username, encrypts payloads, and upserts under multi-tenant RLS constraints.
 * 
 * Note: Since this endpoint is hit by eBay's server-side redirect (without authenticated cookies in standard context),
 * we resolve user identity and tenant scope purely via the encrypted secure `state` parameter.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;

  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!code || !state) {
      console.error('[ebay/callback] Missing code or state parameter');
      return NextResponse.redirect(`${origin}/settings?error=missing_oauth_params`);
    }

    // Decrypt the state to recover organizationId and accountName
    let decryptedState: { organizationId: string; accountName: string };
    try {
      decryptedState = decryptIntegrationPayload<{ organizationId: string; accountName: string }>(state);
    } catch (err: any) {
      console.error('[ebay/callback] Failed to decrypt state parameter:', err.message);
      return NextResponse.redirect(`${origin}/settings?error=invalid_oauth_state`);
    }

    const { organizationId, accountName } = decryptedState;

    if (!organizationId || !accountName) {
      console.error('[ebay/callback] Incomplete state context retrieved');
      return NextResponse.redirect(`${origin}/settings?error=incomplete_oauth_state`);
    }

    const sandbox = process.env.EBAY_ENVIRONMENT !== 'PRODUCTION';
    const tokenUrl = sandbox 
      ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token' 
      : 'https://api.ebay.com/identity/v1/oauth2/token';

    const clientId = process.env.EBAY_APP_ID!;
    const clientSecret = process.env.EBAY_CERT_ID!;
    const ruName = process.env.EBAY_RU_NAME!;

    if (!clientId || !clientSecret || !ruName) {
      console.error('[ebay/callback] eBay environment variables are not configured');
      return NextResponse.redirect(`${origin}/settings?error=server_configuration_error`);
    }

    const authString = `${clientId}:${clientSecret}`;
    const base64Auth = Buffer.from(authString).toString('base64');
    
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: ruName,
    });
    
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${base64Auth}`,
      },
      body: body.toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[ebay/callback] Token exchange failed:', errorText);
      return NextResponse.redirect(`${origin}/settings?error=token_exchange_failed`);
    }

    const data = await tokenResponse.json();

    // Fetch the eBay username / profile to populate ebay_user_id
    const userProfileUrl = sandbox
      ? 'https://api.sandbox.ebay.com/commerce/identity/v1/user/'
      : 'https://api.ebay.com/commerce/identity/v1/user/';

    let ebayUserId = '';
    try {
      const profileResponse = await fetch(userProfileUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${data.access_token}`,
          'Accept': 'application/json',
        },
      });

      if (profileResponse.ok) {
        const profileData = await profileResponse.json();
        ebayUserId = profileData.userId || profileData.username || '';
      } else {
        console.warn('[ebay/callback] Failed to fetch eBay user profile info:', await profileResponse.text());
      }
    } catch (profileErr: any) {
      console.warn('[ebay/callback] Ignored exception while fetching user profile:', profileErr.message);
    }

    // Encrypt the access_token and refresh_token symmetrically
    const encryptedAccessToken = encryptIntegrationPayload(data.access_token);
    const encryptedRefreshToken = encryptIntegrationPayload(data.refresh_token);

    // Calculate expiry dates
    const tokenExpiresAt = new Date(Date.now() + data.expires_in * 1000);
    const refreshTokenExpiresAt = new Date(Date.now() + (data.refresh_token_expires_in || 18 * 30 * 24 * 3600) * 1000);

    // Securely insert or update the credentials under the tenant's organization_id using tenantQuery
    await tenantQuery(
      organizationId,
      `INSERT INTO ebay_accounts (
        organization_id, account_name, ebay_user_id, access_token, refresh_token,
        token_expires_at, refresh_token_expires_at, marketplace_id, is_active, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (account_name) DO UPDATE
      SET organization_id = EXCLUDED.organization_id,
          ebay_user_id = EXCLUDED.ebay_user_id,
          access_token = EXCLUDED.access_token,
          refresh_token = EXCLUDED.refresh_token,
          token_expires_at = EXCLUDED.token_expires_at,
          refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
          updated_at = NOW(),
          is_active = true`,
      [
        organizationId,
        accountName,
        ebayUserId || null,
        encryptedAccessToken,
        encryptedRefreshToken,
        tokenExpiresAt,
        refreshTokenExpiresAt,
        'EBAY_US',
        true
      ]
    );

    console.log(`[ebay/callback] successfully connected accountName=${accountName} for org=${organizationId}`);
    return NextResponse.redirect(`${origin}/settings?success=ebay_connected`);
  } catch (error: any) {
    console.error('[ebay/callback] Unexpected error in handler:', error);
    return NextResponse.redirect(`${origin}/settings?error=unexpected_callback_error`);
  }
}
