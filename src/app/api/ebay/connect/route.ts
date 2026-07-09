import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { withAuth } from '@/lib/auth/withAuth';
import { assertIntegrationKmsConfigured, encryptIntegrationPayload } from '@/lib/integrations/crypto';
import { getEbayAppCreds } from '@/lib/ebay/credentials';
import {
  ebayAuthDomain,
  ebayScopeStringForRole,
  normalizeEbayRole,
  EBAY_OAUTH_STATE_COOKIE,
} from '@/lib/ebay/oauth-config';

const STATE_COOKIE_MAX_AGE = 600; // 10 min — matches the callback TTL window

/**
 * GET /api/ebay/connect
 * Starts the multi-tenant eBay OAuth consent flow.
 *
 * CSRF defense is two-layer: an AES-GCM-encrypted `state` (tamper-proof, carries
 * the tenant + a nonce) PLUS an httpOnly cookie holding the same nonce so the
 * callback can confirm it returned to the same browser session that started it.
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(req.url);
    const accountName = searchParams.get('accountName');
    // The purchasing-account difference starts here: role=buyer requests the
    // buyer scope set and is persisted as ebay_accounts.account_role by the callback.
    const role = normalizeEbayRole(searchParams.get('role'));

    if (!accountName?.trim()) {
      return NextResponse.json({ error: 'accountName is required' }, { status: 400 });
    }

    // Encryption-at-rest is required to store the OAuth state (and tokens) —
    // hard-fail in production if the KMS key is missing.
    assertIntegrationKmsConfigured('eBay OAuth state');

    // Per-tenant / shared-app credentials (no process.env reads here).
    const creds = await getEbayAppCreds(ctx.organizationId);
    if (!creds) {
      return NextResponse.json(
        { error: 'eBay integration is not fully configured on the server' },
        { status: 500 },
      );
    }

    const nonce = randomBytes(16).toString('hex');
    const state = encryptIntegrationPayload({
      organizationId: ctx.organizationId,
      accountName: accountName.trim(),
      environment: creds.environment,
      role,
      createdBy: ctx.staffId,
      nonce,
      issuedAt: Date.now(),
    });

    const authUrl =
      `https://${ebayAuthDomain(creds.environment)}/oauth2/authorize` +
      `?client_id=${encodeURIComponent(creds.appId)}` +
      `&redirect_uri=${encodeURIComponent(creds.ruName)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(ebayScopeStringForRole(role))}` +
      `&state=${encodeURIComponent(state)}` +
      `&prompt=login`;

    const res = NextResponse.redirect(authUrl);
    res.cookies.set(EBAY_OAUTH_STATE_COOKIE, nonce, {
      httpOnly: true,
      sameSite: 'lax', // allow the top-level redirect back from eBay to carry it
      secure: process.env.NODE_ENV === 'production',
      maxAge: STATE_COOKIE_MAX_AGE,
      path: '/',
    });
    return res;
  } catch (error: any) {
    console.error('[ebay/connect] Failed to initiate connection:', error?.message || error);
    return NextResponse.redirect(
      `${req.nextUrl.origin}/settings/integrations?error=ebay_server_configuration`,
    );
  }
}, { permission: 'integrations.ebay' });
