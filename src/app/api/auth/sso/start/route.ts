/**
 * GET /api/auth/sso/start?slug=<tenant>
 *
 * Kicks off an OIDC PKCE flow for the tenant identified by `slug`.
 * Persists the state row, then 302s the browser to the IdP's authorize
 * endpoint. The callback at /api/auth/sso/callback consumes the state row
 * and creates the session.
 *
 * Gated by the tenant's `sso` entitlement (enterprise-plan-only by
 * default — see src/lib/billing/plans.ts).
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { getOrganizationBySlug } from '@/lib/tenancy/organizations';
import { hasFeature } from '@/lib/billing/entitlements';
import {
  buildAuthorizeUrl, generatePkce, generateState, resolveEndpoints,
  type OidcProviderRow,
} from '@/lib/auth/sso-oidc';

function origin(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL ||
    `${req.nextUrl.protocol}//${req.nextUrl.host}`;
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

function mapProvider(row: ProviderDbRow): OidcProviderRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    issuer: row.issuer,
    clientId: row.client_id,
    authorizeUrl: row.authorize_url,
    tokenUrl: row.token_url,
    userinfoUrl: row.userinfo_url,
    jwksUrl: row.jwks_url,
    defaultRole: row.default_role,
    autoProvision: row.auto_provision,
  };
}

export const GET = withAuth(async (req) => {
  const slug = req.nextUrl.searchParams.get('slug') || req.headers.get('x-tenant-slug');
  const nextPath = req.nextUrl.searchParams.get('next') || '/dashboard';
  if (!slug) {
    return NextResponse.json({ error: 'TENANT_REQUIRED' }, { status: 400 });
  }

  const org = await getOrganizationBySlug(slug);
  if (!org) {
    return NextResponse.json({ error: 'TENANT_NOT_FOUND' }, { status: 404 });
  }

  // Plan gate: SSO is enterprise-only by default.
  if (!(await hasFeature(org.id, 'sso'))) {
    return NextResponse.json({ error: 'SSO_NOT_AVAILABLE_ON_PLAN', plan: org.plan }, { status: 402 });
  }

  const providerRes = await pool.query<ProviderDbRow>(
    `SELECT id, organization_id, issuer, client_id, authorize_url, token_url,
            userinfo_url, jwks_url, default_role, auto_provision
       FROM organization_sso_providers
      WHERE organization_id = $1 AND status = 'active'
      ORDER BY id ASC LIMIT 1`,
    [org.id],
  );
  const provider = providerRes.rows[0];
  if (!provider) {
    return NextResponse.json({ error: 'SSO_NOT_CONFIGURED' }, { status: 404 });
  }
  const mapped = mapProvider(provider);

  let endpoints;
  try {
    endpoints = await resolveEndpoints(mapped);
  } catch (err) {
    return NextResponse.json(
      { error: 'SSO_DISCOVERY_FAILED', detail: err instanceof Error ? err.message : 'unknown' },
      { status: 502 },
    );
  }

  const { verifier, challenge } = generatePkce();
  const state = generateState();
  await pool.query(
    `INSERT INTO sso_auth_state (state, provider_id, organization_id, code_verifier, next_path)
     VALUES ($1, $2, $3, $4, $5)`,
    [state, mapped.id, mapped.organizationId, verifier, nextPath],
  );

  // Cheap GC of stale state rows older than 10 min — runs on every start.
  await pool.query(`DELETE FROM sso_auth_state WHERE created_at < now() - interval '10 minutes'`);

  const redirectUri = `${origin(req)}/api/auth/sso/callback`;
  const authorizeUrl = buildAuthorizeUrl({
    endpoint: endpoints.authorization_endpoint,
    clientId: mapped.clientId,
    redirectUri,
    state,
    codeChallenge: challenge,
  });

  return NextResponse.redirect(authorizeUrl);
}, { allowAnonymous: true });
