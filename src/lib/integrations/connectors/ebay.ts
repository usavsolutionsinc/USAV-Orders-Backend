/**
 * eBay connector sync + validate adapters — wrap the EXISTING per-account eBay
 * sync (`syncAccountOrders`) and the /api/ebay/health check logic so a
 * connection drives ingestion and credential validation across the org's
 * active eBay accounts. Lazily imported by the registry so the lightweight
 * connection reader never pulls in the eBay client.
 */
import pool from '@/lib/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { EbayClient } from '@/lib/ebay/client';
import { EBAY_PLATFORM_PREDICATE, getEbayAppCreds, listActiveEbayAccounts } from '@/lib/ebay/credentials';
import { ebayIdentityEndpoint } from '@/lib/ebay/oauth-config';
import { syncAccountOrders } from '@/lib/ebay/sync';
import type { HealthResult, SyncOutcome } from './types';

export async function ebaySync(orgId: OrgId): Promise<SyncOutcome> {
  const { rows } = await pool.query<{ account_name: string }>(
    `SELECT account_name FROM ebay_accounts
      WHERE organization_id = $1 AND is_active = true
        AND ${EBAY_PLATFORM_PREDICATE}
      ORDER BY account_name`,
    [orgId],
  );
  if (rows.length === 0) return { ok: true, imported: 0, updated: 0 };

  let imported = 0;
  const errors: string[] = [];
  for (const { account_name } of rows) {
    try {
      const r = await syncAccountOrders(account_name, orgId);
      imported += r.createdOrders ?? 0;
    } catch (e) {
      errors.push(`${account_name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { ok: errors.length === 0, imported, error: errors.length ? errors.join('; ') : undefined };
}

/**
 * connector.validate() (INT-011) — thin adapter over the /api/ebay/health
 * check: for each active account, getValidAccessToken() refreshes a
 * near-expiry token (a dead refresh token surfaces here), then a light
 * identity probe confirms eBay still accepts the token (401/403 ⇒ re-consent).
 */
export async function ebayValidate(orgId: OrgId): Promise<HealthResult> {
  const accounts = await listActiveEbayAccounts(orgId);
  if (accounts.length === 0) {
    return { ok: false, error: 'No active eBay accounts for this organization.' };
  }
  const creds = await getEbayAppCreds(orgId);
  const identityUrl = creds ? ebayIdentityEndpoint(creds.environment) : null;

  const results = await Promise.all(
    accounts.map(async (acct) => {
      try {
        const client = new EbayClient(acct.accountName, orgId);
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
        return { accountName: acct.accountName, ok: true as const };
      } catch (err) {
        return {
          accountName: acct.accountName,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  const failures = results.filter((r) => !r.ok);
  return {
    ok: failures.length === 0,
    error: failures.length
      ? failures.map((f) => `${f.accountName}: ${f.error}`).join('; ')
      : undefined,
    detail: { accounts: results },
  };
}
