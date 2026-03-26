import pool from '@/lib/db';
import { refreshEbayAccessToken } from '@/lib/ebay/token-refresh';

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
  const { rows: accounts } = await pool.query<{ account_name: string; refresh_token: string }>(
    `SELECT account_name, refresh_token
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

  for (const { account_name, refresh_token } of accounts) {
    try {
      const { accessToken, expiresIn } = await refreshEbayAccessToken(
        clientId,
        clientSecret,
        refresh_token
      );
      const newExpiresAt = new Date(Date.now() + expiresIn * 1000);

      await pool.query(
        `UPDATE ebay_accounts
         SET access_token = $1, token_expires_at = $2, updated_at = NOW()
         WHERE account_name = $3`,
        [accessToken, newExpiresAt, account_name]
      );
      refreshed++;
      console.log(`[ebay-refresh-tokens] refreshed account=${account_name}`);
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
