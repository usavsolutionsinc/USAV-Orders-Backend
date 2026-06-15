/**
 * Amazon connector sync adapter — wraps the EXISTING per-org Amazon sync
 * (`syncOrgAmazonOrders`). Lazily imported by the registry.
 */
import type { OrgId } from '@/lib/tenancy/constants';
import { syncOrgAmazonOrders } from '@/lib/amazon/order-sync';
import type { SyncOutcome } from './types';

export async function amazonSync(orgId: OrgId): Promise<SyncOutcome> {
  const { accounts } = await syncOrgAmazonOrders(orgId, { fetchPii: true });
  const imported = accounts.reduce((s, a) => s + a.imported, 0);
  const updated = accounts.reduce((s, a) => s + a.updated, 0);
  const errors = accounts.flatMap((a) => a.errors ?? []);
  return { ok: errors.length === 0, imported, updated, error: errors.length ? errors.join('; ') : undefined };
}
