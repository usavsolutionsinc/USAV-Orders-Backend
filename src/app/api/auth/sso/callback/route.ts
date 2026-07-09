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
  createSession, SESSION_COOKIE_NAME, cookieMaxAgeForSession,
} from '@/lib/auth/session';
import {
  exchangeCode, fetchUserInfo, resolveEndpoints, validateIdTokenClaims,
  type IdTokenClaims, type OidcProviderRow, type UserInfo,
} from '@/lib/auth/sso-oidc';
import { getIntegrationCredentials } from '@/lib/integrations/credentials';
import { withTenantTransaction } from '@/lib/tenancy/db';
import {
  getAccountByEmail, getAccountIdByIdentity, createAccount, linkAccountIdentity,
} from '@/lib/identity/accounts';
import { logAuthEvent } from '@/lib/identity/memberships';
import { canonicalRole, ALL_ROLES, type StaffRole } from '@/lib/auth/permissions';
import { invalidateStaffRolesCache } from '@/lib/auth/role-store';

/** Internal sentinel: thrown to roll back the tx when an un-provisionable
 *  subject signs in under auto_provision=false. */
class SsoProvisioningError extends Error {}

interface StateRow {
  state: string;
  provider_id: number;
  organization_id: string;
  code_verifier: string;
  next_path: string | null;
  created_at: Date;
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
  // valid state then waits before completing. `created_at` comes back via the
  // DELETE … RETURNING * above (column exists in 2026-05-23_sso_providers.sql).
  if (Date.now() - new Date(stateRow.created_at).getTime() > 10 * 60 * 1000) {
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

  // Validate the id_token's standard claims (iss/aud/exp) when present. In the
  // auth-code flow it arrives over the direct, server-to-server TLS token
  // exchange, so claim validation + TLS stands in for JWS signature
  // verification (OIDC Core §3.1.3.7); JWKS signature checking is the v2
  // hardening. The validated claims are the authoritative identity source.
  let claims: IdTokenClaims | null = null;
  if (tokens.id_token) {
    try {
      claims = validateIdTokenClaims(tokens.id_token, {
        issuer: provider.issuer,
        clientId: provider.clientId,
      });
    } catch {
      return failRedirect(req, 'ID_TOKEN_INVALID');
    }
  }

  // Enrich with userinfo (name/email) — best effort; the id_token claims win.
  let userinfo: UserInfo | null = null;
  if (endpoints.userinfo_endpoint) {
    try {
      userinfo = await fetchUserInfo({ endpoint: endpoints.userinfo_endpoint, accessToken: tokens.access_token });
    } catch {
      // Fall through to id_token claims.
    }
  }

  const subject = claims?.sub ?? userinfo?.sub ?? null;
  if (!subject) return failRedirect(req, 'NO_USER_IDENTITY');
  const email = (claims?.email ?? userinfo?.email ?? null)?.toLowerCase() ?? null;
  // OIDC Core §5.7: an unverified email must not be used as a unique identifier.
  // We therefore only MATCH onto a pre-existing account by email when the IdP
  // asserts it verified — otherwise the email is still stored on a freshly
  // created (subject-keyed) account but can't be used to take over someone
  // else's identity. Absent `email_verified` is treated as NOT verified.
  const emailVerified = claims?.email_verified === true || userinfo?.email_verified === true;
  const displayName =
    userinfo?.name || claims?.name || userinfo?.preferred_username ||
    claims?.preferred_username || email || `SSO ${subject.slice(0, 8)}`;

  // Map the provider's default role onto a canonical role; fall back to viewer.
  const canonical = canonicalRole((provider.defaultRole || 'viewer').toLowerCase() as StaffRole);
  const role = canonical === 'unknown' || !ALL_ROLES.includes(canonical) ? 'viewer' : canonical;

  // Resolve the identity layer + per-org staff profile atomically. Mirrors the
  // invitation-accept flow: global account → membership → staff, all in one tx.
  let resolved: { staffId: number; accountId: string };
  try {
    resolved = await withTenantTransaction(provider.organizationId, async (client) => {
      // 1. Resolve the global account — by federated identity first (a stable
      //    `sub` survives email changes), then by VERIFIED email, else create.
      let accountId = await getAccountIdByIdentity(provider.issuer, subject, client);
      if (!accountId && email && emailVerified) {
        accountId = (await getAccountByEmail(email, client))?.id ?? null;
      }
      if (!accountId) {
        accountId = await createAccount({ displayName, email, password: null }, client);
      }
      // 2. Record the federated login (idempotent) so the next sign-in resolves
      //    straight to this account.
      await linkAccountIdentity(
        { accountId, provider: provider.issuer, subject, emailAtLink: email }, client,
      );

      // 3. Upsert the membership.
      const mem = await client.query<{ id: string }>(
        `INSERT INTO memberships (account_id, org_id, status, joined_at)
         VALUES ($1, $2, 'active', now())
         ON CONFLICT (account_id, org_id)
         DO UPDATE SET status = 'active', joined_at = COALESCE(memberships.joined_at, now())
         RETURNING id`,
        [accountId, provider.organizationId],
      );
      const membershipId = mem.rows[0]!.id;

      // 4. Find-or-create the per-org staff profile keyed by (org, issuer, sub).
      //    sso_provider stores the issuer string for cross-IdP disambiguation.
      const existing = await client.query<{ id: number }>(
        `SELECT id FROM staff
          WHERE organization_id = $1 AND sso_provider = $2 AND sso_subject = $3
          LIMIT 1`,
        [provider.organizationId, provider.issuer, subject],
      );
      if (existing.rows[0]) {
        const sid = existing.rows[0].id;
        // Backfill the identity link for staff provisioned before this wiring.
        await client.query(
          `UPDATE staff
              SET last_login_at = now(),
                  account_id    = COALESCE(account_id, $2),
                  membership_id = COALESCE(membership_id, $3)
            WHERE id = $1`,
          [sid, accountId, membershipId],
        );
        return { staffId: sid, accountId };
      }
      if (!provider.autoProvision) {
        // Pre-invited-only mode: refuse unknown subjects. Throw to roll back the
        // account/membership we just created for an un-provisionable login.
        throw new SsoProvisioningError();
      }
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO staff
           (name, role, active, organization_id, status, sso_provider, sso_subject,
            last_login_at, default_home_path, account_id, membership_id)
         VALUES ($1, $2, true, $3, 'active', $4, $5, now(), '/dashboard', $6, $7)
         RETURNING id`,
        [displayName, role, provider.organizationId, provider.issuer, subject, accountId, membershipId],
      );
      const sid = inserted.rows[0]!.id;
      await client.query(
        `INSERT INTO staff_roles (staff_id, role_id, granted_at)
         SELECT $1, r.id, now() FROM roles r WHERE r.key = $2
         ON CONFLICT (staff_id, role_id) DO NOTHING`,
        [sid, role],
      );
      return { staffId: sid, accountId };
    });
  } catch (err) {
    if (err instanceof SsoProvisioningError) return failRedirect(req, 'STAFF_NOT_PROVISIONED');
    console.error('[sso-callback] identity provisioning failed:', err);
    return failRedirect(req, 'PROVISIONING_FAILED');
  }

  const { staffId, accountId } = resolved;
  invalidateStaffRolesCache(staffId);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const userAgent = req.headers.get('user-agent');

  // Identity-layer audit: record the federated login in auth_events. Best-effort
  // (logAuthEvent never throws) so it can't block the session mint.
  await logAuthEvent({ accountId, orgId: provider.organizationId, event: 'login', ip, userAgent });

  const session = await createSession({
    staffId,
    deviceKind: 'personal',
    deviceLabel: 'sso',
    ip,
    userAgent,
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
    maxAge: cookieMaxAgeForSession(session),
  });
  return res;
}, { allowAnonymous: true });
