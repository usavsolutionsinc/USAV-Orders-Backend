/**
 * Connection-driven sync orchestrator — the layer that makes a *connection*
 * drive ingestion instead of an ad-hoc button. Runs each connector's wired
 * `sync()` for every org that has that provider connected.
 *
 * `syncConnection` powers the per-org "Sync now"; `runOrdersSyncAllOrgs`
 * powers the cron. Both reuse the providers' existing sync code (eBay/Amazon).
 */
import pool from '@/lib/db';
import type { OrgId } from '@/lib/tenancy/constants';
import type { IntegrationProvider } from '@/lib/integrations/credentials';
import { EBAY_PLATFORM_PREDICATE } from '@/lib/ebay/credentials';
import { connectorsWithCapability, getConnector, listConnectors } from './registry';
import type { ReconcileOutcome, SyncOutcome } from './types';
import { tapBuyerNoteDerivation } from '@/lib/surfaces/buyer-note-derivation';

/** Post-sync mirror-derivation taps (plan §2.3 fresh path) — tapWorkflow
 *  semantics: best-effort, NEVER throws (tapBuyerNoteDerivation swallows all
 *  errors), so awaiting it cannot fail a sync — and awaiting is required on
 *  serverless, where un-awaited work is frozen once the response returns.
 *  Signals derive from the LOCAL mirror the sync just updated, so provider
 *  errors can't reach this layer. eBay only today (Amazon is a fast-follow). */
async function tapPostSyncDerivations(provider: IntegrationProvider, orgId: OrgId): Promise<void> {
  if (provider !== 'ebay') return;
  await tapBuyerNoteDerivation(orgId);
}

/** Run one org's sync for one provider (the "Sync now" action). */
export async function syncConnection(orgId: OrgId, provider: IntegrationProvider): Promise<SyncOutcome> {
  const connector = getConnector(provider);
  if (!connector) return { ok: false, error: `Unknown provider: ${provider}` };
  if (!connector.sync) return { ok: false, error: `${provider} has no sync capability yet` };
  const outcome = await connector.sync(orgId);
  await tapPostSyncDerivations(provider, orgId);
  return outcome;
}

/** Which orgs have this provider connected. eBay/Amazon track connections in
 *  dedicated account tables; everything else lives in the vault. */
async function connectedOrgsForProvider(provider: IntegrationProvider): Promise<OrgId[]> {
  if (provider === 'ebay' || provider === 'amazon') {
    const table = provider === 'ebay' ? 'ebay_accounts' : 'amazon_accounts';
    const platformFilter =
      provider === 'ebay' ? ` AND ${EBAY_PLATFORM_PREDICATE}` : '';
    const { rows } = await pool.query<{ organization_id: string }>(
      `SELECT DISTINCT organization_id FROM ${table} WHERE is_active = true${platformFilter}`,
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

export interface OrchestratorResult {
  provider: IntegrationProvider;
  orgId: OrgId;
  outcome: SyncOutcome;
}

/** Cron entrypoint: for every orders-capable connector with a wired sync(),
 *  sync every org that has it connected. `only` scopes the run to specific
 *  providers — used so the cron can drive eBay without double-running Amazon
 *  (which still has its own dedicated cron until Phase 4 consolidation). */
export async function runOrdersSyncAllOrgs(only?: IntegrationProvider[]): Promise<OrchestratorResult[]> {
  const out: OrchestratorResult[] = [];
  const allow = only && only.length ? new Set(only) : null;
  for (const connector of connectorsWithCapability('orders')) {
    if (!connector.sync) continue; // not wired yet (e.g. ecwid/square — later phase)
    if (allow && !allow.has(connector.provider)) continue;
    const orgs = await connectedOrgsForProvider(connector.provider);
    for (const orgId of orgs) {
      try {
        out.push({ provider: connector.provider, orgId, outcome: await connector.sync(orgId) });
        await tapPostSyncDerivations(connector.provider, orgId);
      } catch (e) {
        out.push({
          provider: connector.provider,
          orgId,
          outcome: { ok: false, error: e instanceof Error ? e.message : String(e) },
        });
      }
    }
  }
  return out;
}

export interface ReconcileResult {
  provider: IntegrationProvider;
  orgId: OrgId;
  outcome: ReconcileOutcome;
}

/** Daily drift-repair entrypoint: for every connector with a wired reconcile(),
 *  reconcile every org that has it connected. No-op (returns []) until providers
 *  implement reconcile() — additive and safe to schedule now. */
export async function runReconcileAllOrgs(opts?: { since?: Date }): Promise<ReconcileResult[]> {
  const out: ReconcileResult[] = [];
  for (const connector of listConnectors()) {
    if (!connector.reconcile) continue;
    const orgs = await connectedOrgsForProvider(connector.provider);
    for (const orgId of orgs) {
      try {
        out.push({
          provider: connector.provider,
          orgId,
          outcome: await connector.reconcile(orgId, opts),
        });
      } catch (e) {
        out.push({
          provider: connector.provider,
          orgId,
          outcome: { ok: false, error: e instanceof Error ? e.message : String(e) },
        });
      }
    }
  }
  return out;
}
