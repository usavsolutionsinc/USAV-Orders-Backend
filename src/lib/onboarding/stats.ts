/**
 * Onboarding activation stats — one cheap, org-scoped aggregate
 * (onboarding-foundational-plan §8). Backs GET /api/onboarding/stats.
 *
 * One round-trip: a single SELECT of capped COUNT scalar subqueries under the
 * standard tenant path (withTenantTransaction → GUC + RLS + explicit org
 * filter). Counts are capped (LIMIT inside the subquery) because the checklist
 * only needs small thresholds — never a full-table scan on a mature org.
 *
 * Degrade-not-fail: any error resolves to all-zero stats so the dashboard
 * checklist renders (as "nothing done yet") instead of 500ing the page.
 */

import type { PoolClient } from 'pg';
import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { EMPTY_ONBOARDING_STATS, type OnboardingStats } from './steps';

/** Injectable deps so unit tests run DB-free (backend-patterns.md). */
export interface OnboardingStatsDeps {
  withTenant: <T>(orgId: OrgId, fn: (client: Pick<PoolClient, 'query'>) => Promise<T>) => Promise<T>;
}

const defaultDeps: OnboardingStatsDeps = {
  withTenant: (orgId, fn) => withTenantTransaction(orgId, fn),
};

interface StatsRow {
  orders: number | string;
  receiving_lines: number | string;
  staff: number | string;
  integrations_connected: number | string;
  first_scan_done: boolean;
}

/** Caps keep the counts index-cheap; the checklist thresholds are tiny. */
const COUNT_CAP = 100;

export async function getOnboardingStats(
  orgId: OrgId,
  deps: OnboardingStatsDeps = defaultDeps,
): Promise<OnboardingStats> {
  try {
    return await deps.withTenant(orgId, async (client) => {
      const { rows } = await client.query<StatsRow>(
        `SELECT
           (SELECT COUNT(*)::int FROM (
              SELECT 1 FROM orders WHERE organization_id = $1 LIMIT ${COUNT_CAP}) o)  AS orders,
           (SELECT COUNT(*)::int FROM (
              SELECT 1 FROM receiving_lines WHERE organization_id = $1 LIMIT ${COUNT_CAP}) r) AS receiving_lines,
           (SELECT COUNT(*)::int FROM (
              SELECT 1 FROM staff WHERE organization_id = $1 LIMIT ${COUNT_CAP}) s)   AS staff,
           (SELECT COUNT(*)::int FROM organization_integrations
             WHERE organization_id = $1 AND status = 'active')                        AS integrations_connected,
           EXISTS (SELECT 1 FROM inventory_events WHERE organization_id = $1)         AS first_scan_done`,
        [orgId],
      );
      const row = rows[0];
      if (!row) return { ...EMPTY_ONBOARDING_STATS };
      return {
        orders: Number(row.orders ?? 0),
        receivingLines: Number(row.receiving_lines ?? 0),
        staff: Number(row.staff ?? 0),
        integrationsConnected: Number(row.integrations_connected ?? 0),
        firstScanDone: Boolean(row.first_scan_done),
      };
    });
  } catch (error) {
    console.error('onboarding stats failed (degrading to zeros):', error);
    return { ...EMPTY_ONBOARDING_STATS };
  }
}
