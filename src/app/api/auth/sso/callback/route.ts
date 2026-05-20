/**
 * GET /api/auth/sso/callback?code=...&state=...
 *
 * Consumes the PKCE state row, exchanges the code at the IdP, fetches
 * userinfo, finds-or-creates the staff row, mints a session, and
 * redirects to the originally-requested page.
 *
 * Errors at any step land at /signin?sso_error=<code> so the user sees a
 * legible message rather than a JSON dump.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import {
  createSession, SESSION_COOKIE_NAME, getCookieMaxAgeSeconds,
} from '@/lib/auth/session';
import {
  decodeIdTokenClaimsUnsafe, exchangeCode, fetchUserInfo, resolveEndpoints,
  type OidcProviderRow, type UserInfo,
} from '@/lib/auth/sso-oidc';
import { getIntegrationCredentials } from '@/lib/integrations/credentials';

interface StateRow {
  state: string;
  provider_id: number;
  organization_id: string;
  code_verifier: string;
  next_path: string | null;
}

interface ProviderDbRow {
  id: number;
  organization_id: string;
  issuer: string;
  client_id: string;
  authorize_url: string | null;
  token_url: string | null;
  userinfo_url: string | null;
  jwks_url: string | null;
  default_role: string;
  auto_provision: boolean;
}

function origin(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL ||
    `${req.nextUrl.protocol}//${req.nextUrl.host}`;
}

function failRedirect(req: NextRequest, code: string): NextResponse {
  const url = new URL('/signin', origin(req));
  url.searchParams.set('sso_error', code);
  return NextResponse.redirect(url);
}

export const GET = withAuth(async (req) => {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  if (!code || !state) return failRedirect(req, 'MISSING_PARAMS');

  // Pop the state row atomically (DELETE … RETURNING) so a replay can't
  // re-use it.
  const stateRes = await pool.query<StateRow>(
    `DELETE FROM sso_auth_state WHERE state = $1 RETURNING *`,
    [state],
  );
  const stateRow = stateRes.rows[0];
  if (!stateRow) return failRedirect(req, 'STATE_NOT_FOUND');
  // 10 min hard expiry, defense in depth against an attacker who pops a
  // valid state then waits before completing.
  if (Date.now() - new Date((stateRow as unknown as { created_at?: Date }).created_at ?? Date.now()).getTime() > 10 * 60 * 1000) {
    return failRedirect(req, 'STATE_EXPIRED');
  }

  const providerRes = await pool.query<ProviderDbRow>(
    `SELECT * FROM organization_sso_providers WHERE id = $1`,
    [stateRow.provider_id],
  );
  const providerRow = providerRes.rows[0];
  if (!providerRow) return failRedirect(req, 'PROVIDER_GONE');

  const provider: OidcProviderRow = {
    id: providerRow.id,
    organizationId: providerRow.organization_id,
    issuer: providerRow.issuer,
    clientId: providerRow.client_id,
    authorizeUrl: providerRow.authorize_url,
    tokenUrl: providerRow.token_url,
    userinfoUrl: providerRow.userinfo_url,
    jwksUrl: providerRow.jwks_url,
    defaultRole: providerRow.default_role,
    autoProvision: providerRow.auto_provision,
  };

  // The client secret is stored in the integrations vault keyed by a
  // synthetic provider key. Convention: `sso:<provider id>`. Lets us reuse
  // the AES-256-GCM machinery and the admin UI's connect flow.
  const creds = await getIntegrationCredentials<{ clientSecret: string }>(
    provider.organizationId,
    'stripe', // Placeholder — see TODO below
    { scope: `sso:${provider.id}` },
  );
  if (!creds?.clientSecret) {
    // TODO: dedicated 'sso' provider key. Today we piggyback on the vault
    // shape; the admin UI can store under provider='stripe' scope='sso:<id>'
    // as a transitional measure until we add the provider enum entry.
    return failRedirect(req, 'CLIENT_SECRET_MISSING');
  }

  let endpoints;
  try {
    endpoints = await resolveEndpoints(provider);
  } catch {
    return failRedirect(req, 'DISCOVERY_FAILED');
  }

  // Exchange + userinfo
  let tokens;
  try {
    tokens = await exchangeCode({
      endpoint: endpoints.token_endpoint,
      clientId: provider.clientId,
      clientSecret: creds.clientSecret,
      code,
      redirectUri: `${origin(req)}/api/auth/sso/callback`,
      codeVerifier: stateRow.code_verifier,
    });
  } catch {
    return failRedirect(req, 'TOKEN_EXCHANGE_FAILED');
  }

  let userinfo: UserInfo | null = null;
  if (endpoints.userinfo_endpoint) {
    try {
      userinfo = await fetchUserInfo({ endpoint: endpoints.userinfo_endpoint, accessToken: tokens.access_token });
    } catch {
      // Fall through to id_token decode.
    }
  }
  if (!userinfo && tokens.id_token) {
    userinfo = decodeIdTokenClaimsUnsafe(tokens.id_token);
  }
  if (!userinfo?.sub) return failRedirect(req, 'NO_USER_IDENTITY');

  // Find-or-create the staff row keyed by (organization_id, sso_provider,
  // sso_subject). sso_provider stores the issuer string for cross-IdP
  // disambiguation when an org adds multiple providers.
  const existing = await pool.query<{ id: number }>(
    `SELECT id FROM staff
      WHERE organization_id = $1 AND sso_provider = $2 AND sso_subject = $3
      LIMIT 1`,
    [provider.organizationId, provider.issuer, userinfo.sub],
  );

  let staffId: number;
  if (existing.rows[0]) {
    staffId = existing.rows[0].id;
    await pool.query(`UPDATE staff SET last_login_at = now() WHERE id = $1`, [staffId]);
  } else if (provider.autoProvision) {
    const name = userinfo.name || userinfo.preferred_username || userinfo.email || `SSO ${userinfo.sub.slice(0, 8)}`;
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO staff (name, role, active, organization_id, status, sso_provider, sso_subject, last_login_at, default_home_path)
       VALUES ($1, $2, true, $3, 'active', $4, $5, now(), '/dashboard')
       RETURNING id`,
      [name, provider.defaultRole, provider.organizationId, provider.issuer, userinfo.sub],
    );
    staffId = inserted.rows[0]!.id;
  } else {
    // Pre-invited-only mode: refuse unknown subjects.
    return failRedirect(req, 'STAFF_NOT_PROVISIONED');
  }

  const session = await createSession({
    staffId,
    deviceKind: 'personal',
    deviceLabel: 'sso',
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    userAgent: req.headers.get('user-agent'),
  });

  const target = new URL(stateRow.next_path || '/dashboard', origin(req));
  const res = NextResponse.redirect(target);
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: session.sid,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: getCookieMaxAgeSeconds('personal'),
  });
  return res;
}, { allowAnonymous: true });
