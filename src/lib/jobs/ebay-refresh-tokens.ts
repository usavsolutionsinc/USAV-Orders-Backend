import pool from '@/lib/db';
import { refreshEbayAccessToken } from '@/lib/ebay/token-refresh';
import { decryptIntegrationPayload, encryptIntegrationPayload } from '@/lib/integrations/crypto';
import { tenantQuery } from '@/lib/tenancy/db';

export interface EbayRefreshTokensJobResult {
  success: boolean;
  refreshed: number;
  total?: number;
  errors?: string[];
  message: string;
  durationMs: number;
}

export async function runEbayRefreshTokensJob(): Promise<EbayRefreshTokensJobResult> {
  const startedAt = Date.now();
  // RLS bypass select via pool (raw connection without GUC) to fetch expiring accounts across all tenants
  const { rows: accounts } = await pool.query<{ account_name: string; refresh_token: string; organization_id: string }>(
    `SELECT account_name, refresh_token, organization_id
     FROM ebay_accounts
     WHERE (platform = 'EBAY' OR platform IS NULL)
       AND is_active = true
       AND token_expires_at <= NOW() + INTERVAL '30 minutes'
     ORDER BY token_expires_at ASC`
  );

  if (accounts.length === 0) {
    return {
      success: true,
      refreshed: 0,
      message: 'No eBay tokens need refresh.',
      durationMs: Date.now() - startedAt,
    };
  }

  const clientId = process.env.EBAY_APP_ID;
  const clientSecret = process.env.EBAY_CERT_ID;
  if (!clientId || !clientSecret) {
    throw new Error('EBAY_APP_ID or EBAY_CERT_ID not configured');
  }

  let refreshed = 0;
  const errors: string[] = [];

  for (const { account_name, refresh_token, organization_id } of accounts) {
    try {
      // Decrypt the integration refresh token
      const decryptedRefreshToken = decryptIntegrationPayload<string>(refresh_token);

      const { accessToken, expiresIn } = await refreshEbayAccessToken(
        clientId,
        clientSecret,
        decryptedRefreshToken
      );
      const newExpiresAt = new Date(Date.now() + expiresIn * 1000);
      const encryptedAccessToken = encryptIntegrationPayload(accessToken);

      // Perform update scoped under tenantQuery for RLS policy compliance
      await tenantQuery(
        organization_id,
        `UPDATE ebay_accounts
         SET access_token = $1, token_expires_at = $2, updated_at = NOW()
         WHERE account_name = $3`,
        [encryptedAccessToken, newExpiresAt, account_name]
      );
      refreshed++;
      console.log(`[ebay-refresh-tokens] refreshed account=${account_name} under organization=${organization_id}`);
    } catch (error: any) {
      errors.push(`${account_name}: ${error?.message || 'unknown'}`);
      console.error(`[ebay-refresh-tokens] failed account=${account_name}`, error);
    }
  }

  return {
    success: true,
    refreshed,
    total: accounts.length,
    errors: errors.length > 0 ? errors : undefined,
    message: `Refreshed ${refreshed}/${accounts.length} eBay tokens.`,
    durationMs: Date.now() - startedAt,
  };
}

