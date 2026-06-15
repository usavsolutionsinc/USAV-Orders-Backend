/**
 * Amazon account + credential helpers shared by the /api/amazon routes.
 *
 * The per-seller LWA refresh token lives in the org vault keyed by
 * scope='seller-{sellerId}' (or scope=null for a single unnamed account);
 * amazon_accounts holds the non-secret metadata + sync state.
 */
import { getIntegrationCredentials, type AmazonCredentials } from '@/lib/integrations/credentials';
import { tenantQuery } from '@/lib/tenancy/db';
import { toAmazonAccount, type AmazonAccount } from './client';

export function amazonScopeForSeller(sellerId: string | null | undefined): string | null {
  return sellerId ? `seller-${sellerId}` : null;
}

export async function loadActiveAmazonAccounts(orgId: string): Promise<AmazonAccount[]> {
  const { rows } = await tenantQuery(
    orgId,
    `SELECT id, organization_id, account_name, seller_id, region, marketplace_ids,
            access_token, access_token_expires_at
       FROM amazon_accounts
      WHERE organization_id = $1 AND is_active = true
      ORDER BY account_name`,
    [orgId],
  );
  return rows.map(toAmazonAccount);
}

export async function loadAmazonCreds(orgId: string, account: AmazonAccount): Promise<AmazonCredentials | null> {
  return getIntegrationCredentials<AmazonCredentials>(orgId, 'amazon', {
    scope: amazonScopeForSeller(account.sellerId),
  });
}
