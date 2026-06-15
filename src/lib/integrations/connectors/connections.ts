/**
 * Normalized connection reader — a typed, capability-aware view of an org's
 * integrations, built from the `organization_integrations` vault rows joined
 * with connector metadata. This is what the settings UI and the (Phase 1)
 * sync orchestrator read instead of hand-querying the table.
 *
 * Read-only + org-scoped. Does not decrypt the payload (metadata only).
 */
import pool from '@/lib/db';
import type { OrgId } from '@/lib/tenancy/constants';
import type { IntegrationProvider } from '@/lib/integrations/credentials';
import { entitlementsForPlan } from '@/lib/billing/plans';
import { getOrganization } from '@/lib/tenancy/organizations';
import { getConnector } from './registry';
import type { ConnectionState, ConnectionStatus } from './types';

interface IntegrationRow {
  provider: string;
  status: string;
  display_label: string | null;
  scope: string | null;
  last_error: string | null;
  last_used_at: Date | null;
  updated_at: Date | null;
}

function rowToState(status: string): ConnectionState {
  switch (status) {
    case 'active':
      return 'active';
    case 'error':
      return 'error';
    case 'revoked':
      return 'revoked';
    default:
      return 'disconnected';
  }
}

function toStatus(row: IntegrationRow): ConnectionStatus {
  const provider = row.provider as IntegrationProvider;
  const connector = getConnector(row.provider);
  return {
    provider,
    connected: row.status === 'active',
    state: rowToState(row.status),
    authKind: connector?.authKind ?? 'vault',
    capabilities: connector?.capabilities ?? [],
    displayLabel: row.display_label,
    scope: row.scope,
    lastError: row.last_error,
    lastUsedAt: row.last_used_at,
  };
}

const BASE_SELECT = `
  SELECT provider, status, display_label, scope, last_error, last_used_at, updated_at
    FROM organization_integrations
   WHERE organization_id = $1`;

/** All of an org's integration connections, newest-meaningful first. */
export async function listConnections(orgId: OrgId): Promise<ConnectionStatus[]> {
  const r = await pool.query<IntegrationRow>(`${BASE_SELECT} ORDER BY provider ASC, scope NULLS FIRST`, [orgId]);
  return r.rows.map(toStatus);
}

/** A single provider connection (optionally scoped), or null when absent. */
export async function getConnectionStatus(
  orgId: OrgId,
  provider: IntegrationProvider,
  scope: string | null = null,
): Promise<ConnectionStatus | null> {
  const r = await pool.query<IntegrationRow>(
    `${BASE_SELECT} AND provider = $2 AND COALESCE(scope, '') = COALESCE($3, '') LIMIT 1`,
    [orgId, provider, scope],
  );
  return r.rows[0] ? toStatus(r.rows[0]) : null;
}

/** Count of distinct connected providers — the unit `plans.ts.maxIntegrations`
 *  is measured in. */
export async function countConnectedProviders(orgId: OrgId): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `SELECT COUNT(DISTINCT provider)::text AS n
       FROM organization_integrations
      WHERE organization_id = $1 AND status = 'active'`,
    [orgId],
  );
  return Number(r.rows[0]?.n ?? 0);
}

export interface IntegrationLimit {
  used: number;
  /** Plan ceiling; 0 means unlimited (pro/enterprise). */
  max: number;
  unlimited: boolean;
  atLimit: boolean;
}

/** Where the org stands against its plan's `maxIntegrations` ceiling. */
export async function integrationLimitStatus(orgId: OrgId): Promise<IntegrationLimit> {
  const [used, org] = await Promise.all([countConnectedProviders(orgId), getOrganization(orgId)]);
  const max = entitlementsForPlan(org?.plan ?? 'trial').maxIntegrations;
  const unlimited = max === 0;
  return { used, max, unlimited, atLimit: !unlimited && used >= max };
}

/** True if connecting a NEW provider would exceed the plan ceiling. Updating an
 *  already-connected provider is always allowed (it doesn't add to the count). */
export async function wouldExceedIntegrationLimit(
  orgId: OrgId,
  provider: IntegrationProvider,
): Promise<boolean> {
  const existing = await getConnectionStatus(orgId, provider);
  if (existing?.connected) return false;
  const { atLimit } = await integrationLimitStatus(orgId);
  return atLimit;
}
