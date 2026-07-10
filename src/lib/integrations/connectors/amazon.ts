/**
 * Amazon connector sync + validate adapters — wrap the EXISTING per-org Amazon
 * sync (`syncOrgAmazonOrders`) and the /api/amazon/health check logic.
 * Lazily imported by the registry.
 */
import type { OrgId } from '@/lib/tenancy/constants';
import { loadActiveAmazonAccounts, loadAmazonCreds } from '@/lib/amazon/accounts';
import { getMarketplaceParticipations } from '@/lib/amazon/client';
import { syncOrgAmazonOrders } from '@/lib/amazon/order-sync';
import type { HealthResult, SyncOutcome } from './types';

export async function amazonSync(orgId: OrgId): Promise<SyncOutcome> {
  const { accounts } = await syncOrgAmazonOrders(orgId, { fetchPii: true });
  const imported = accounts.reduce((s, a) => s + a.imported, 0);
  const updated = accounts.reduce((s, a) => s + a.updated, 0);
  const errors = accounts.flatMap((a) => a.errors ?? []);
  return { ok: errors.length === 0, imported, updated, error: errors.length ? errors.join('; ') : undefined };
}

/**
 * connector.validate() (INT-011) — thin adapter over the /api/amazon/health
 * check: for each active account, exchange the stored refresh token and call
 * getMarketplaceParticipations (cheap whoami-style probe, non-PII).
 */
export async function amazonValidate(orgId: OrgId): Promise<HealthResult> {
  const accounts = await loadActiveAmazonAccounts(orgId);
  if (accounts.length === 0) {
    return { ok: false, error: 'No active Amazon accounts for this organization.' };
  }

  const results = await Promise.all(
    accounts.map(async (account) => {
      const creds = await loadAmazonCreds(orgId, account);
      if (!creds?.refreshToken) {
        return { accountName: account.accountName, ok: false, error: 'No stored credentials — reconnect.' };
      }
      try {
        await getMarketplaceParticipations(account, creds);
        return { accountName: account.accountName, ok: true as const };
      } catch (err) {
        return {
          accountName: account.accountName,
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
