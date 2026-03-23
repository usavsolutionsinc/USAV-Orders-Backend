import { NextRequest, NextResponse } from 'next/server';
import { setZohoTokens, clearZohoTokens, getZohoRefreshTokenFromKv } from '@/lib/zoho-kv';
import { normalizeEnvValue } from '@/lib/env-utils';

export const dynamic = 'force-dynamic';

/**
 * GET /api/zoho/oauth/callback
 *
 * Authorized Redirect URI registered in the Zoho API Console.
 * Receives the authorization code from Zoho, exchanges it for access + refresh
 * tokens, and persists them to Upstash KV so the rest of the app can call
 * Zoho Inventory without manual env-var management.
 *
 * Zoho appends: ?code=...&location=...&accounts-server=...
 *
 * Required env vars: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, NEXT_PUBLIC_APP_URL
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const code = searchParams.get('code');
  const oauthError = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  // Zoho may return an accounts-server that differs from the default domain
  const accountsServer =
    searchParams.get('accounts-server') ||
    `https://${normalizeEnvValue(process.env.ZOHO_DOMAIN) || 'accounts.zoho.com'}`;

  if (oauthError) {
    return NextResponse.json(
      {
        success: false,
        error: oauthError,
        description: errorDescription ?? undefined,
      },
      { status: 400 }
    );
  }

  if (!code) {
    return NextResponse.json(
      { success: false, error: 'Missing authorization code from Zoho.' },
      { status: 400 }
    );
  }

  const clientId = normalizeEnvValue(process.env.ZOHO_CLIENT_ID);
  const clientSecret = normalizeEnvValue(process.env.ZOHO_CLIENT_SECRET);
  const appUrl = normalizeEnvValue(process.env.NEXT_PUBLIC_APP_URL).replace(/\/$/, '');

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        success: false,
        error:
          'ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET must be set in environment variables before completing OAuth.',
      },
      { status: 500 }
    );
  }

  const redirectUri = `${appUrl}/api/zoho/oauth/callback`;
  const tokenUrl = `${accountsServer}/oauth/v2/token`;

  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  let tokenData: Record<string, unknown>;
  try {
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      cache: 'no-store',
    });

    const text = await tokenRes.text();
    try {
      tokenData = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { success: false, error: `Zoho returned non-JSON: ${text}` },
        { status: 502 }
      );
    }

    if (!tokenRes.ok || tokenData.error) {
      return NextResponse.json(
        {
          success: false,
          error: String(tokenData.error ?? `HTTP ${tokenRes.status}`),
          description: tokenData.error_description ?? undefined,
        },
        { status: 400 }
      );
    }
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: `Token exchange request failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }

  const accessToken = normalizeEnvValue(String(tokenData.access_token ?? ''));
  const refreshToken = normalizeEnvValue(String(tokenData.refresh_token ?? ''));
  const expiresIn = Number(tokenData.expires_in_sec ?? tokenData.expires_in ?? 3600);

  if (!accessToken) {
    return NextResponse.json(
      { success: false, error: 'Zoho did not return an access_token.' },
      { status: 502 }
    );
  }

  const existingRefreshToken = await getZohoRefreshTokenFromKv();
  if (!refreshToken && !existingRefreshToken) {
    return NextResponse.json(
      {
        success: false,
        error: 'Zoho did not return a refresh_token.',
        description:
          'Refresh tokens are only issued on an offline consent grant. Retry /api/zoho/oauth/authorize and approve the consent screen again.',
        accounts_server: accountsServer,
      },
      { status: 502 }
    );
  }

  // Clear any stale tokens, then persist fresh ones to the DB (ebay_accounts ZOHO_MAIN row)
  await clearZohoTokens();
  await setZohoTokens({ accessToken, refreshToken: refreshToken || undefined, expiresIn });

  return NextResponse.json({
    success: true,
    message: 'Zoho OAuth connected successfully. Tokens saved to database (ebay_accounts).',
    refresh_token_received: Boolean(refreshToken),
    ...(refreshToken
      ? {
          refresh_token: refreshToken,
          tip: 'Tokens are stored in the database. No env var update needed.',
        }
      : {
          tip: 'Zoho did not rotate the refresh token, so the previously stored refresh token was kept.',
        }),
    scopes: tokenData.scope ?? null,
    token_type: tokenData.token_type ?? 'Bearer',
    api_domain: tokenData.api_domain ?? null,
    accounts_server: accountsServer,
  });
}
