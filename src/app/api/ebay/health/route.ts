import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { EbayClient } from '@/lib/ebay/client';
import { getEbayAppCreds, listActiveEbayAccounts } from '@/lib/ebay/credentials';
import { ebayIdentityEndpoint } from '@/lib/ebay/oauth-config';

/**
 * GET /api/ebay/health
 * Live-checks each active eBay account for the current org. getValidAccessToken()
 * refreshes a near-expiry token (so a dead refresh token surfaces here), then a
 * light identity probe confirms the token is still accepted by eBay (401/403 =>
 * needs re-consent). Mirrors /api/amazon/health's response shape.
 */
export const GET = withAuth(async (_req, ctx) => {
  const accounts = await listActiveEbayAccounts(ctx.organizationId);
  const creds = await getEbayAppCreds(ctx.organizationId);
  const identityUrl = creds ? ebayIdentityEndpoint(creds.environment) : null;

  const results = await Promise.all(
    accounts.map(async (acct) => {
      try {
        const client = new EbayClient(acct.accountName, ctx.organizationId);
        const { accessToken } = await client.getValidAccessToken(); // throws if refresh is dead
        if (identityUrl) {
          const resp = await fetch(identityUrl, {
            headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
          });
          if (resp.status === 401 || resp.status === 403) {
            return {
              accountName: acct.accountName,
              ok: false,
              error: 'Re-authorization required (token rejected by eBay).',
            };
          }
        }
        return {
          accountName: acct.accountName,
          ok: true,
          ebayUserId: acct.ebayUserId,
          tokenExpiresAt: acct.tokenExpiresAt,
        };
      } catch (err: any) {
        return { accountName: acct.accountName, ok: false, error: err?.message || String(err) };
      }
    }),
  );

  return NextResponse.json({
    ok: results.length > 0 && results.every((r) => r.ok),
    connected: results.length > 0,
    accounts: results,
  });
}, { permission: 'integrations.ebay' });
