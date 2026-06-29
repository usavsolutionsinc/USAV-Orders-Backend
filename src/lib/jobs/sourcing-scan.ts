import type { PoolClient } from 'pg';
import { forEachActiveOrg } from '@/lib/cron/for-each-org';
import type { OrgId } from '@/lib/tenancy/constants';

/**
 * Nightly sourcing scan — turns lifecycle + stock conditions into the
 * sourcing_alerts auto-flag queue.
 *
 * Rules (see docs/bose-parts-sourcing-engine-plan.md §7):
 *   A. EOL/discontinued SKUs at/below their reorder threshold (or zero) →
 *      an 'eol'/'discontinued' alert.
 *   B. Active SKUs with a reorder_threshold breached → a 'low_stock' alert.
 *   C. Compatible parts (referenced by part_compatibility) with zero on-hand →
 *      a 'demand_no_stock' alert.
 *   D. Resolve any live alert whose underlying condition has cleared.
 *
 * Idempotent: the partial unique index uniq_sourcing_alert_live (sku_id,
 * alert_type WHERE status IN ('open','sourcing')) makes every INSERT a no-op
 * on re-run, so the job can run as often as scheduled without duplicating
 * alerts. on_hand is summed from bin_contents by the sku text key.
 *
 * Phase D tenancy: fans out per active org via forEachActiveOrg — each pass
 * runs inside that org's tenant connection (GUC set via SET LOCAL). sku_catalog,
 * bin_contents and sourcing_alerts all carry organization_id, so every read is
 * additionally constrained by an explicit `organization_id = $1` predicate
 * (defense-in-depth BEFORE and AFTER RLS FORCE) and every INSERT stamps the
 * swept org — no more single global pass hardcoded to the transitional USAV org.
 * part_compatibility is global-shared reference data (industry compatibility
 * knowledge), so its EXISTS join is intentionally NOT org-scoped. Per-org
 * failures are isolated by forEachActiveOrg.
 */

// Shared on-hand-per-active-sku CTE, inlined into each statement (CTEs don't
// span statements). bin_contents.sku is the text key matching sku_catalog.sku.
// Both sku_catalog and bin_contents are org-scoped to the swept org ($1).
const STOCK_CTE = `
  stock AS (
    SELECT
      sc.id   AS sku_id,
      sc.lifecycle_status,
      sc.reorder_threshold,
      COALESCE((SELECT SUM(bc.qty)::int FROM bin_contents bc
                 WHERE bc.sku = sc.sku AND bc.organization_id = $1), 0) AS on_hand
    FROM sku_catalog sc
    WHERE sc.is_active = true
      AND sc.organization_id = $1
  )`;

export interface SourcingScanResult {
  opened: { eol_discontinued: number; low_stock: number; demand_no_stock: number };
  resolved: number;
  orgs_swept: number;
  orgs_failed: number;
  elapsed_ms: number;
}

interface OrgSourcingScanSummary {
  opened: { eol_discontinued: number; low_stock: number; demand_no_stock: number };
  resolved: number;
}

export async function runSourcingScanJob(): Promise<SourcingScanResult> {
  const startedAt = Date.now();

  // Fan out per active org: each pass runs inside that org's tenant connection
  // (GUC set), so once RLS is FORCE-enforced a sweep only sees that org's rows.
  // Per-org failures are isolated by forEachActiveOrg.
  const perOrg = await forEachActiveOrg((orgId, client) =>
    runSourcingScanForOrg(orgId, client),
  );

  const opened = { eol_discontinued: 0, low_stock: 0, demand_no_stock: 0 };
  let resolved = 0;
  for (const r of perOrg) {
    if (!r.ok || !r.result) continue;
    opened.eol_discontinued += r.result.opened.eol_discontinued;
    opened.low_stock += r.result.opened.low_stock;
    opened.demand_no_stock += r.result.opened.demand_no_stock;
    resolved += r.result.resolved;
  }

  return {
    opened,
    resolved,
    orgs_swept: perOrg.length,
    orgs_failed: perOrg.filter((r) => !r.ok).length,
    elapsed_ms: Date.now() - startedAt,
  };
}

async function runSourcingScanForOrg(
  orgId: OrgId,
  client: PoolClient,
): Promise<OrgSourcingScanSummary> {
  // No BEGIN/COMMIT here — forEachActiveOrg wraps each org pass in a transaction
  // (with the org GUC set via SET LOCAL). $1 = orgId in every statement.

  // ─── A. EOL / discontinued at/below threshold ─────────────────────────────
  const eol = await client.query<{ inserted: number }>(
    `WITH ${STOCK_CTE},
     ins AS (
       INSERT INTO sourcing_alerts (sku_id, alert_type, severity, status, reason, organization_id)
       SELECT s.sku_id, s.lifecycle_status,
              CASE WHEN s.on_hand = 0 THEN 'critical' ELSE 'warn' END,
              'open',
              'auto: ' || s.lifecycle_status || ', on-hand ' || s.on_hand,
              $1::uuid
       FROM stock s
       WHERE s.lifecycle_status IN ('eol','discontinued')
         AND s.on_hand <= COALESCE(s.reorder_threshold, 0)
       ON CONFLICT (sku_id, alert_type) WHERE status IN ('open','sourcing')
       DO NOTHING
       RETURNING 1
     )
     SELECT COUNT(*)::int AS inserted FROM ins`,
    [orgId],
  );

  // ─── B. Active low_stock ──────────────────────────────────────────────────
  const low = await client.query<{ inserted: number }>(
    `WITH ${STOCK_CTE},
     ins AS (
       INSERT INTO sourcing_alerts (sku_id, alert_type, severity, status, reason, organization_id)
       SELECT s.sku_id, 'low_stock',
              CASE WHEN s.on_hand = 0 THEN 'critical' ELSE 'warn' END,
              'open',
              'auto: low stock, on-hand ' || s.on_hand || ' <= threshold ' || s.reorder_threshold,
              $1::uuid
       FROM stock s
       WHERE s.lifecycle_status = 'active'
         AND s.reorder_threshold IS NOT NULL
         AND s.on_hand <= s.reorder_threshold
       ON CONFLICT (sku_id, alert_type) WHERE status IN ('open','sourcing')
       DO NOTHING
       RETURNING 1
     )
     SELECT COUNT(*)::int AS inserted FROM ins`,
    [orgId],
  );

  // ─── C. Compatible part with zero stock (demand_no_stock) ─────────────────
  // part_compatibility is global-shared reference data — intentionally not org-scoped.
  const demand = await client.query<{ inserted: number }>(
    `WITH ${STOCK_CTE},
     ins AS (
       INSERT INTO sourcing_alerts (sku_id, alert_type, severity, status, reason, organization_id)
       SELECT DISTINCT s.sku_id, 'demand_no_stock', 'warn', 'open',
              'auto: compatible part out of stock',
              $1::uuid
       FROM stock s
       WHERE s.on_hand = 0
         AND EXISTS (SELECT 1 FROM part_compatibility pc WHERE pc.sku_id = s.sku_id)
       ON CONFLICT (sku_id, alert_type) WHERE status IN ('open','sourcing')
       DO NOTHING
       RETURNING 1
     )
     SELECT COUNT(*)::int AS inserted FROM ins`,
    [orgId],
  );

  // ─── D. Auto-resolve cleared conditions ───────────────────────────────────
  const resolved = await client.query<{ resolved: number }>(
    `WITH ${STOCK_CTE},
     closed AS (
       UPDATE sourcing_alerts sa
       SET status = 'resolved', resolved_at = NOW(), updated_at = NOW(),
           reason = COALESCE(sa.reason, 'auto-resolved: condition cleared')
       FROM stock s
       WHERE sa.sku_id = s.sku_id
         AND sa.organization_id = $1
         AND sa.status IN ('open','sourcing')
         AND sa.reason LIKE 'auto:%'   -- only touch machine-opened alerts
         AND (
           (sa.alert_type IN ('eol','discontinued')
              AND NOT (s.lifecycle_status = sa.alert_type AND s.on_hand <= COALESCE(s.reorder_threshold, 0)))
           OR (sa.alert_type = 'low_stock'
              AND NOT (s.lifecycle_status = 'active' AND s.reorder_threshold IS NOT NULL AND s.on_hand <= s.reorder_threshold))
           OR (sa.alert_type = 'demand_no_stock'
              AND NOT (s.on_hand = 0 AND EXISTS (SELECT 1 FROM part_compatibility pc WHERE pc.sku_id = s.sku_id)))
         )
       RETURNING 1
     )
     SELECT COUNT(*)::int AS resolved FROM closed`,
    [orgId],
  );

  return {
    opened: {
      eol_discontinued: eol.rows[0]?.inserted ?? 0,
      low_stock: low.rows[0]?.inserted ?? 0,
      demand_no_stock: demand.rows[0]?.inserted ?? 0,
    },
    resolved: resolved.rows[0]?.resolved ?? 0,
  };
}
