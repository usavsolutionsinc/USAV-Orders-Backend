import { NextResponse } from 'next/server';
import { getZohoHttpClientStatus } from '@/lib/zoho/httpClient';
import { getAccessToken, loadZohoCredentials, ZohoNotConnectedError } from '@/lib/zoho/core';
import { withZohoOrg } from '@/lib/zoho/tenant-context';
import { withAuth } from '@/lib/auth/withAuth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/zoho/health
 *
 * Tenant-aware connection check for the Settings → Connections Zoho card.
 * Resolves THIS org's Zoho credentials from the vault (env fallback for USAV),
 * confirms the refresh token still mints an access token, and returns the
 * non-secret connection facts (Zoho org id, data center) alongside the shared
 * rate-limiter / circuit-breaker status. Never returns secrets.
 */
export const GET = withAuth(async (_req, ctx) => {
  const orgId = ctx.organizationId;
  const limiter = getZohoHttpClientStatus();

  // 1. Is there a usable connection for this tenant?
  let connection: { zoho_organization_id: string; data_center: string } | null = null;
  try {
    const creds = await loadZohoCredentials(orgId);
    connection = {
      zoho_organization_id: creds.orgId,
      data_center: creds.domain || 'accounts.zoho.com',
    };
  } catch (err) {
    if (err instanceof ZohoNotConnectedError) {
      return NextResponse.json({
        success: true,
        connected: false,
        reason: 'No Zoho connection for this organization.',
        rate_limit: { circuit: limiter.circuit, limiter: limiter.limiter },
      });
    }
    const message = err instanceof Error ? err.message : 'Failed to load Zoho credentials';
    return NextResponse.json({ success: false, connected: false, error: message }, { status: 500 });
  }

  // 2. Live check — confirm the stored refresh token still works (mints a token).
  let tokenOk = false;
  let liveError: string | null = null;
  try {
    const token = await withZohoOrg(orgId, () => getAccessToken(orgId));
    tokenOk = Boolean(token);
  } catch (err) {
    liveError = err instanceof Error ? err.message : 'Token mint failed';
  }

  return NextResponse.json({
    success: true,
    connected: true,
    token_ok: tokenOk,
    live_error: liveError,
    connection,
    rate_limit: {
      requests_per_minute_budget: limiter.config.reservoir,
      max_concurrent: limiter.config.maxConcurrent,
      min_spacing_ms: limiter.config.minTimeMs,
      max_retries: limiter.config.maxRetries,
      circuit: limiter.circuit,
      limiter: limiter.limiter,
    },
  });
}, { permission: 'integrations.zoho' });
