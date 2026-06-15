import { NextRequest, NextResponse } from 'next/server';
import { normalizeEnvValue } from '@/lib/env-utils';
import { getCurrentUser } from '@/lib/auth/current-user';
import {
  getIntegrationCredentials,
  upsertIntegrationCredentials,
  type ZohoCredentials,
} from '@/lib/integrations/credentials';
import { assertIntegrationKmsConfigured } from '@/lib/integrations/crypto';

export const dynamic = 'force-dynamic';

/**
 * GET /api/zoho/oauth/callback
 *
 * Authorized Redirect URI registered in the Zoho API Console. Receives the
 * authorization code, exchanges it for access + refresh tokens, discovers the
 * tenant's Zoho Inventory organization_id, and persists the connection to the
 * per-tenant vault (organization_integrations, provider='zoho') — the single
 * source of truth. No env vars are written; the Zoho *app* client id/secret are
 * shared across tenants (like Amazon's LWA app) and copied into the encrypted
 * payload so it is self-contained at runtime.
 *
 * The connecting TENANT is resolved from the signed-in admin's session (the
 * Zoho redirect is a top-level same-site navigation, so the session cookie is
 * present). Required env: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, NEXT_PUBLIC_APP_URL.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const code = searchParams.get('code');
  const oauthError = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  // Zoho may return an accounts-server that differs from the default domain.
  const accountsServer =
    searchParams.get('accounts-server') ||
    `https://${normalizeEnvValue(process.env.ZOHO_DOMAIN) || 'accounts.zoho.com'}`;
  const accountsDomainHost = (() => {
    try {
      return new URL(accountsServer).host;
    } catch {
      return 'accounts.zoho.com';
    }
  })();

  if (oauthError) {
    return NextResponse.json(
      { success: false, error: oauthError, description: errorDescription ?? undefined },
      { status: 400 },
    );
  }
  if (!code) {
    return NextResponse.json(
      { success: false, error: 'Missing authorization code from Zoho.' },
      { status: 400 },
    );
  }

  // Resolve the connecting tenant from the admin's session.
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      {
        success: false,
        error: 'Not signed in.',
        description: 'Start the Zoho connection from Settings → Integrations while signed in.',
      },
      { status: 401 },
    );
  }
  const orgId = user.organizationId;

  // Refuse to connect if we cannot store the secret encrypted in production.
  try {
    assertIntegrationKmsConfigured('Zoho credentials');
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }

  const clientId = normalizeEnvValue(process.env.ZOHO_CLIENT_ID);
  const clientSecret = normalizeEnvValue(process.env.ZOHO_CLIENT_SECRET);
  const appUrl = normalizeEnvValue(process.env.NEXT_PUBLIC_APP_URL).replace(/\/$/, '');

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        success: false,
        error: 'ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET must be set before completing OAuth.',
      },
      { status: 500 },
    );
  }

  // ── Exchange the authorization code for tokens ────────────────────────────
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
        { status: 502 },
      );
    }
    if (!tokenRes.ok || tokenData.error) {
      return NextResponse.json(
        {
          success: false,
          error: String(tokenData.error ?? `HTTP ${tokenRes.status}`),
          description: tokenData.error_description ?? undefined,
        },
        { status: 400 },
      );
    }
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: `Token exchange request failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  const accessToken = normalizeEnvValue(String(tokenData.access_token ?? ''));
  const refreshToken = normalizeEnvValue(String(tokenData.refresh_token ?? ''));
  const apiDomain = normalizeEnvValue(String(tokenData.api_domain ?? 'https://www.zohoapis.com')).replace(/\/$/, '');

  if (!accessToken) {
    return NextResponse.json(
      { success: false, error: 'Zoho did not return an access_token.' },
      { status: 502 },
    );
  }

  // Zoho only mints a refresh token on an offline consent grant. If it didn't
  // rotate one, keep the tenant's existing stored refresh token.
  const existing = await getIntegrationCredentials<ZohoCredentials>(orgId, 'zoho');
  const effectiveRefreshToken = refreshToken || existing?.refreshToken || '';
  if (!effectiveRefreshToken) {
    return NextResponse.json(
      {
        success: false,
        error: 'Zoho did not return a refresh_token.',
        description:
          'Refresh tokens are only issued on an offline consent grant. Retry /api/zoho/oauth/authorize and approve the consent screen again.',
        accounts_server: accountsServer,
      },
      { status: 502 },
    );
  }

  // ── Discover the tenant's Zoho Inventory organization_id ──────────────────
  let zohoOrgId = existing?.orgId ?? '';
  let zohoOrgName: string | null = null;
  let organizationsSeen: Array<{ organization_id: string; name: string }> = [];
  try {
    const orgsRes = await fetch(`${apiDomain}/inventory/v1/organizations`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      cache: 'no-store',
    });
    if (orgsRes.ok) {
      const orgsJson = (await orgsRes.json()) as {
        organizations?: Array<{ organization_id?: string; name?: string }>;
      };
      organizationsSeen = (orgsJson.organizations ?? [])
        .filter((o) => o.organization_id)
        .map((o) => ({ organization_id: String(o.organization_id), name: String(o.name ?? '') }));
      // Prefer an explicitly requested org (?org=) when present, else the first.
      const requested = searchParams.get('org');
      const chosen =
        organizationsSeen.find((o) => o.organization_id === requested) ?? organizationsSeen[0];
      if (chosen) {
        zohoOrgId = chosen.organization_id;
        zohoOrgName = chosen.name || null;
      }
    }
  } catch {
    // Non-fatal: fall back to any previously stored org id.
  }

  if (!zohoOrgId) {
    return NextResponse.json(
      {
        success: false,
        error: 'Could not determine the Zoho Inventory organization_id.',
        description:
          'The token was issued but listing organizations failed. Ensure the ZohoInventory.* scopes were granted, then retry.',
      },
      { status: 502 },
    );
  }

  // ── Persist the connection to the vault (encrypted, per-tenant) ───────────
  const payload: ZohoCredentials = {
    clientId,
    clientSecret,
    refreshToken: effectiveRefreshToken,
    orgId: zohoOrgId,
    domain: accountsDomainHost,
  };

  await upsertIntegrationCredentials({
    orgId,
    provider: 'zoho',
    payload,
    displayLabel: zohoOrgName ? `Connected · ${zohoOrgName}` : `Connected · org ${zohoOrgId}`,
    createdBy: user.staffId,
  });

  return NextResponse.json({
    success: true,
    message: 'Zoho connected. Credentials saved to the encrypted per-tenant vault.',
    organization_id: orgId,
    zoho_organization_id: zohoOrgId,
    zoho_organization_name: zohoOrgName,
    refresh_token_rotated: Boolean(refreshToken),
    organizations: organizationsSeen,
    accounts_server: accountsServer,
    token_type: tokenData.token_type ?? 'Bearer',
    api_domain: apiDomain,
  });
}
