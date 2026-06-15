import pool from '@/lib/db';
import { refreshEbayAccessToken, readEbayToken, writeEbayToken } from '@/lib/ebay/token-refresh';
import { getEbayAppCreds, markEbayAccountNeedsReconsent } from '@/lib/ebay/credentials';
import { tenantQuery } from '@/lib/tenancy/db';

export interface EbayRefreshTokensJobResult {
  success: boolean;
  refreshed: number;
  total?: number;
  needsReconsent?: number;
  errors?: string[];
  message: string;
  durationMs: number;
}

/** A 4xx from eBay's token endpoint means the refresh token is dead — re-consent needed. */
function isDeadRefreshToken(message: string): boolean {
  return /invalid_grant|HTTP 400|HTTP 401/i.test(message);
}

export async function runEbayRefreshTokensJob(): Promise<EbayRefreshTokensJobResult> {
  const startedAt = Date.now();
  // RLS bypass select via pool (raw connection without GUC) to fetch expiring accounts across all tenants
  const { rows: accounts } = await pool.query<{
    account_name: string;
    refresh_token: string;
    refresh_token_expires_at: string | null;
    organization_id: string;
  }>(
    `SELECT account_name, refresh_token, refresh_token_expires_at, organization_id
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

  let refreshed = 0;
  let needsReconsent = 0;
  const errors: string[] = [];

  for (const { account_name, refresh_token, refresh_token_expires_at, organization_id } of accounts) {
    try {
      // The refresh token itself (≈18 months) is dead — no point calling eBay.
      if (refresh_token_expires_at && new Date(refresh_token_expires_at).getTime() <= Date.now()) {
        await markEbayAccountNeedsReconsent(organization_id, account_name, 'refresh token expired');
        needsReconsent++;
        errors.push(`${account_name}: refresh token expired — re-authorization required`);
        continue;
      }

      // Resolve this account's eBay app credentials (per-org / shared env app).
      const creds = await getEbayAppCreds(organization_id);
      if (!creds) {
        errors.push(`${account_name}: no eBay app credentials configured for org ${organization_id}`);
        continue;
      }

      const decryptedRefreshToken = readEbayToken(refresh_token);
      const { accessToken, expiresIn } = await refreshEbayAccessToken(
        creds.appId,
        creds.certId,
        decryptedRefreshToken,
        creds.environment
      );
      const newExpiresAt = new Date(Date.now() + expiresIn * 1000);
      const encryptedAccessToken = writeEbayToken(accessToken);

      // Perform update scoped under tenantQuery for RLS policy compliance
      await tenantQuery(
        organization_id,
        `UPDATE ebay_accounts
         SET access_token = $1, token_expires_at = $2, updated_at = NOW()
         WHERE account_name = $3 AND organization_id = $4`,
        [encryptedAccessToken, newExpiresAt, account_name, organization_id]
      );
      refreshed++;
      console.log(`[ebay-refresh-tokens] refreshed account=${account_name} under organization=${organization_id}`);
    } catch (error: any) {
      const message = error?.message || 'unknown';
      // A dead refresh token won't recover on retry — flag for re-consent.
      if (isDeadRefreshToken(message)) {
        try {
          await markEbayAccountNeedsReconsent(organization_id, account_name, message);
          needsReconsent++;
        } catch {
          /* non-fatal */
        }
      }
      errors.push(`${account_name}: ${message}`);
      console.error(`[ebay-refresh-tokens] failed account=${account_name}: ${message}`);
    }
  }

  return {
    success: true,
    refreshed,
    total: accounts.length,
    needsReconsent: needsReconsent || undefined,
    errors: errors.length > 0 ? errors : undefined,
    message: `Refreshed ${refreshed}/${accounts.length} eBay tokens.${needsReconsent ? ` ${needsReconsent} need re-authorization.` : ''}`,
    durationMs: Date.now() - startedAt,
  };
}
