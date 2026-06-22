/**
 * Per-tenant cron fan-out.
 *
 * Background jobs that today run a single global pass must instead iterate every
 * org INSIDE its tenant GUC, so that once RLS is FORCE-enforced (Phase E) each
 * pass only sees that org's rows. Per-org failures are isolated — one bad tenant
 * never aborts the whole sweep.
 *
 * ⚠ TWO-POOL SPLIT (Phase E1): org ENUMERATION must run on a PRIVILEGED
 * connection. Today the app connects as `neondb_owner` (BYPASSRLS), so the
 * shared `pool` enumerates every org fine. After the app moves to the
 * non-bypass `app_tenant` role, this enumeration SELECT must use the
 * admin/owner pool (`ADMIN_DATABASE_URL`) — the tenant role with FORCE on
 * `organizations` would otherwise see only its own row and the sweep would
 * silently collapse to one tenant. Swap `enumerationQuery` to the admin pool
 * when ADMIN_DATABASE_URL lands.
 *
 * See docs/tenancy/multi-tenancy-execution-plan.md §Phase D2.
 */
import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import { withTenantConnection } from '@/lib/tenancy/db';
import { USAV_ORG_ID, type OrgId } from '@/lib/tenancy/constants';
import type { IntegrationProvider } from '@/lib/integrations/credentials';

export interface OrgRunResult<T> {
  orgId: OrgId;
  ok: boolean;
  result?: T;
  error?: unknown;
}

/** Enumerate the tenant orgs to sweep. Excludes cancelled orgs; runs on the
 *  privileged pool (see the two-pool note above). */
async function listSweepOrgIds(): Promise<OrgId[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM organizations WHERE status <> 'cancelled'`,
  );
  return rows.map((r) => r.id as OrgId);
}

/**
 * Run `fn` once per active org inside that org's tenant connection (GUC set).
 * Returns a per-org result list so callers can log partial failures. Never
 * throws for a single tenant's error — it's captured in the result.
 */
export async function forEachActiveOrg<T>(
  fn: (orgId: OrgId, client: PoolClient) => Promise<T>,
): Promise<OrgRunResult<T>[]> {
  const orgIds = await listSweepOrgIds();
  const results: OrgRunResult<T>[] = [];
  for (const orgId of orgIds) {
    try {
      const result = await withTenantConnection(orgId, (client) => fn(orgId, client));
      results.push({ orgId, ok: true, result });
    } catch (error) {
      console.error(`[forEachActiveOrg] org ${orgId} failed:`, error);
      results.push({ orgId, ok: false, error });
    }
  }
  return results;
}

/**
 * Which orgs have `provider` connected. eBay/Amazon track connections in
 * dedicated account tables; everything else lives in the integration vault.
 * Mirrors connectors/orchestrator.connectedOrgsForProvider, but kept here so
 * the cron fan-out doesn't depend on the connector registry.
 */
async function listOrgsWithProvider(provider: IntegrationProvider): Promise<OrgId[]> {
  if (provider === 'ebay' || provider === 'amazon') {
    const table = provider === 'ebay' ? 'ebay_accounts' : 'amazon_accounts';
    const { rows } = await pool.query<{ organization_id: string }>(
      `SELECT DISTINCT organization_id FROM ${table} WHERE is_active = true`,
    );
    return rows.map((r) => r.organization_id as OrgId);
  }
  const { rows } = await pool.query<{ organization_id: string }>(
    `SELECT DISTINCT organization_id FROM organization_integrations
      WHERE provider = $1 AND status = 'active'`,
    [provider],
  );
  return rows.map((r) => r.organization_id as OrgId);
}

export interface ForEachProviderOptions {
  /**
   * Include the transitional USAV org even when it has no vault row. USAV's
   * Zoho (and some other) credentials still come from env vars, so it has no
   * organization_integrations row yet — without this it would silently drop out
   * of provider-filtered sweeps and its sync would stop. Set true on crons that
   * must keep serving USAV during the env→vault transition. Retire once USAV's
   * credentials are migrated into the vault.
   */
  includeUsavTransitional?: boolean;
}

/**
 * Run `fn` once per org that has `provider` connected. Use for integration
 * crons so the sweep only touches orgs that actually connected the provider —
 * never a global-credential pass. Per-org failures are isolated.
 *
 * Unlike forEachActiveOrg this does NOT open a wrapping tenant transaction:
 * integration syncs do many independent units of work (per PO / per order),
 * each its own short GUC-scoped transaction via withTenantTransaction. Wrapping
 * the whole org pass in one transaction would hold an idle-in-transaction
 * connection open for the entire (up to maxDuration) sync. So `fn` receives
 * only the orgId and is responsible for org-scoping its own writes (which it
 * already does — e.g. the Zoho sync runs through withTenantTransaction(orgId)).
 */
export async function forEachOrgWithProvider<T>(
  provider: IntegrationProvider,
  fn: (orgId: OrgId) => Promise<T>,
  options: ForEachProviderOptions = {},
): Promise<OrgRunResult<T>[]> {
  const orgIds = await listOrgsWithProvider(provider);
  if (options.includeUsavTransitional && !orgIds.includes(USAV_ORG_ID)) {
    orgIds.push(USAV_ORG_ID);
  }
  const results: OrgRunResult<T>[] = [];
  for (const orgId of orgIds) {
    try {
      const result = await fn(orgId);
      results.push({ orgId, ok: true, result });
    } catch (error) {
      console.error(`[forEachOrgWithProvider:${provider}] org ${orgId} failed:`, error);
      results.push({ orgId, ok: false, error });
    }
  }
  return results;
}
