/**
 * Token refresh sweep (oauth-plan INT-010) — proactively rotates OAuth tokens
 * before they expire so a connection never goes dark between syncs.
 *
 * Iterates vault connections whose `expires_at` falls within the threshold
 * window and calls the provider connector's `refresh()` when one is defined
 * (providers without a wired refresh() are counted as skipped, not errors).
 *
 * Deps-injected (house pattern, backend-patterns.md) so the unit test runs
 * DB-free. Driven by GET /api/cron/integrations/refresh.
 */
import pool from '@/lib/db';
import type { OrgId } from '@/lib/tenancy/constants';
import type { IntegrationConnector } from './types';
import { getConnector } from './registry';

/** A vault connection whose token is at/near expiry. */
export interface ExpiringConnection {
  orgId: OrgId;
  provider: string;
  scope: string | null;
  expiresAt: Date | null;
}

export interface RefreshSweepDeps {
  /** Active + enabled connections with expires_at <= threshold. */
  listExpiringConnections(threshold: Date): Promise<ExpiringConnection[]>;
  getConnector(provider: string): IntegrationConnector | undefined;
  now(): Date;
}

/**
 * Real reader. Guarded: the `expires_at`/`enabled` columns ship in migration
 * `2026-07-09d_org_integrations_operational_cols.sql`, which is owner-applied
 * later — until then Postgres raises undefined_column (42703); we return []
 * so the sweep is a clean no-op before the migration lands.
 */
async function listExpiringConnectionsFromDb(threshold: Date): Promise<ExpiringConnection[]> {
  try {
    const { rows } = await pool.query<{
      organization_id: string;
      provider: string;
      scope: string | null;
      expires_at: Date | null;
    }>(
      `SELECT organization_id, provider, scope, expires_at
         FROM organization_integrations
        WHERE status = 'active'
          AND enabled IS NOT FALSE
          AND expires_at IS NOT NULL
          AND expires_at <= $1
        ORDER BY expires_at ASC`,
      [threshold],
    );
    return rows.map((r) => ({
      orgId: r.organization_id as OrgId,
      provider: r.provider,
      scope: r.scope,
      expiresAt: r.expires_at,
    }));
  } catch (e) {
    if ((e as { code?: string })?.code === '42703') return [];
    throw e;
  }
}

const defaultDeps: RefreshSweepDeps = {
  listExpiringConnections: listExpiringConnectionsFromDb,
  getConnector,
  now: () => new Date(),
};

export interface RefreshAttempt {
  orgId: OrgId;
  provider: string;
  scope: string | null;
  refreshed: boolean;
  /** Set when the provider has no wired refresh() (skipped, not an error). */
  skipped?: 'no-refresh';
  error?: string;
}

export interface RefreshSweepResult {
  scanned: number;
  refreshed: number;
  skipped: number;
  failures: number;
  attempts: RefreshAttempt[];
}

/** Default look-ahead: refresh anything expiring within the next 60 minutes. */
export const DEFAULT_REFRESH_THRESHOLD_MINUTES = 60;

export async function runTokenRefreshSweep(
  opts: { thresholdMinutes?: number } = {},
  deps: RefreshSweepDeps = defaultDeps,
): Promise<RefreshSweepResult> {
  const thresholdMinutes = opts.thresholdMinutes ?? DEFAULT_REFRESH_THRESHOLD_MINUTES;
  const threshold = new Date(deps.now().getTime() + thresholdMinutes * 60_000);
  const expiring = await deps.listExpiringConnections(threshold);

  const attempts: RefreshAttempt[] = [];
  for (const conn of expiring) {
    const connector = deps.getConnector(conn.provider);
    if (!connector?.refresh) {
      attempts.push({ ...connectionKey(conn), refreshed: false, skipped: 'no-refresh' });
      continue;
    }
    try {
      await connector.refresh(conn.orgId, conn.scope);
      attempts.push({ ...connectionKey(conn), refreshed: true });
    } catch (e) {
      attempts.push({
        ...connectionKey(conn),
        refreshed: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    scanned: expiring.length,
    refreshed: attempts.filter((a) => a.refreshed).length,
    skipped: attempts.filter((a) => a.skipped).length,
    failures: attempts.filter((a) => !a.refreshed && !a.skipped).length,
    attempts,
  };
}

function connectionKey(conn: ExpiringConnection): Pick<RefreshAttempt, 'orgId' | 'provider' | 'scope'> {
  return { orgId: conn.orgId, provider: conn.provider, scope: conn.scope };
}
