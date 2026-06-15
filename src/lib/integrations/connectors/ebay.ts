/**
 * eBay connector sync adapter — wraps the EXISTING per-account eBay sync
 * (`syncAccountOrders`) so a connection drives ingestion across the org's
 * active eBay accounts. Lazily imported by the registry so the lightweight
 * connection reader never pulls in the eBay client.
 */
import pool from '@/lib/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { syncAccountOrders } from '@/lib/ebay/sync';
import type { SyncOutcome } from './types';

export async function ebaySync(orgId: OrgId): Promise<SyncOutcome> {
  const { rows } = await pool.query<{ account_name: string }>(
    `SELECT account_name FROM ebay_accounts
      WHERE organization_id = $1 AND is_active = true
      ORDER BY account_name`,
    [orgId],
  );
  if (rows.length === 0) return { ok: true, imported: 0, updated: 0 };

  let imported = 0;
  const errors: string[] = [];
  for (const { account_name } of rows) {
    try {
      const r = await syncAccountOrders(account_name);
      imported += r.createdOrders ?? 0;
    } catch (e) {
      errors.push(`${account_name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { ok: errors.length === 0, imported, error: errors.length ? errors.join('; ') : undefined };
}
