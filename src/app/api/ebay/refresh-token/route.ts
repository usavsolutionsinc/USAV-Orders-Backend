import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';
import { refreshEbayAccessToken, readEbayToken, writeEbayToken } from '@/lib/ebay/token-refresh';
import { getEbayAppCreds, markEbayAccountNeedsReconsent } from '@/lib/ebay/credentials';
import { formatPSTTimestamp } from '@/utils/date';

/** A 4xx from eBay's token endpoint means the refresh token is dead — re-consent needed. */
function isDeadRefreshToken(message: string): boolean {
  return /invalid_grant|HTTP 400|HTTP 401/i.test(message);
}

/**
 * POST /api/ebay/refresh-token  { accountName }
 * Manually refresh an account's access token (the per-account "Refresh" button).
 * Org-scoped via tenantQuery, KMS-aware token read/write, per-tenant environment.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const { accountName } = await req.json();
    if (!accountName) {
      return NextResponse.json({ success: false, error: 'Account name is required' }, { status: 400 });
    }

    const result = await tenantQuery(
      ctx.organizationId,
      `SELECT refresh_token, refresh_token_expires_at
         FROM ebay_accounts
        WHERE account_name = $1 AND organization_id = $2`,
      [accountName, ctx.organizationId],
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: `Account ${accountName} not found` }, { status: 404 });
    }
    const { refresh_token, refresh_token_expires_at } = result.rows[0];

    // Dead refresh token → re-consent, don't bother calling eBay.
    if (refresh_token_expires_at && new Date(refresh_token_expires_at).getTime() <= Date.now()) {
      await markEbayAccountNeedsReconsent(ctx.organizationId, accountName, 'refresh token expired');
      return NextResponse.json(
        { success: false, error: 'Re-authorization required — the refresh token expired. Reconnect the account.' },
        { status: 409 },
      );
    }

    const creds = await getEbayAppCreds(ctx.organizationId);
    if (!creds) {
      return NextResponse.json({ success: false, error: 'eBay app credentials are not configured.' }, { status: 500 });
    }

    const decryptedRefreshToken = readEbayToken(refresh_token);

    let accessToken: string;
    let expiresIn: number;
    try {
      ({ accessToken, expiresIn } = await refreshEbayAccessToken(
        creds.appId,
        creds.certId,
        decryptedRefreshToken,
        creds.environment,
      ));
    } catch (err: any) {
      const message = err?.message || 'refresh failed';
      if (isDeadRefreshToken(message)) {
        await markEbayAccountNeedsReconsent(ctx.organizationId, accountName, message);
        return NextResponse.json(
          { success: false, error: 'Re-authorization required — please reconnect the account.' },
          { status: 409 },
        );
      }
      return NextResponse.json({ success: false, error: message }, { status: 502 });
    }

    const newExpiresAt = new Date(Date.now() + expiresIn * 1000);
    await tenantQuery(
      ctx.organizationId,
      `UPDATE ebay_accounts
          SET access_token = $1, token_expires_at = $2, updated_at = NOW()
        WHERE account_name = $3 AND organization_id = $4`,
      [writeEbayToken(accessToken), newExpiresAt, accountName, ctx.organizationId],
    );

    return NextResponse.json({
      success: true,
      message: `Token refreshed successfully for ${accountName}`,
      expiresAt: formatPSTTimestamp(newExpiresAt),
      expiresIn,
    });
  } catch (error: any) {
    console.error('[ebay/refresh-token] error:', error?.message || error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}, { permission: 'integrations.ebay' });
