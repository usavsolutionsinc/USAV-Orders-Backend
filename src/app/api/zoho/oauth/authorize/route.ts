import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/zoho/oauth/authorize
 *
 * Redirects the browser to Zoho's OAuth 2.0 authorization page.
 * After the user grants access, Zoho redirects to /api/zoho/oauth/callback.
 *
 * Required env vars: ZOHO_CLIENT_ID, NEXT_PUBLIC_APP_URL
 * Optional: ZOHO_DOMAIN (defaults to accounts.zoho.com)
 */
export async function GET(request: NextRequest) {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const domain = process.env.ZOHO_DOMAIN || 'accounts.zoho.com';
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');

  if (!clientId) {
    return NextResponse.json(
      { error: 'ZOHO_CLIENT_ID is not configured in environment variables.' },
      { status: 500 }
    );
  }

  if (!appUrl) {
    return NextResponse.json(
      { error: 'NEXT_PUBLIC_APP_URL is not configured in environment variables.' },
      { status: 500 }
    );
  }

  const redirectUri = `${appUrl}/api/zoho/oauth/callback`;

  // Scopes required for Zoho Inventory receiving lines integration
  const scope = [
    'ZohoInventory.purchasereceives.READ',
    'ZohoInventory.purchasereceives.CREATE',
    'ZohoInventory.items.READ',
    'ZohoInventory.warehouses.READ',
  ].join(',');

  const authUrl = new URL(`https://${domain}/oauth/v2/auth`);
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('redirect_uri', redirectUri);

  return NextResponse.redirect(authUrl.toString());
}
