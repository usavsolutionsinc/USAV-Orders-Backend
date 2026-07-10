import type { QueryResultRow } from 'pg';
import pool from '../db';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { upsertEbaySupplier, type SupplierRow } from './suppliers-queries';

// ─── Tenancy note ────────────────────────────────────────────────────────────
// None of sourcing_alerts / sourcing_candidates / part_acquisitions carry an
// `organization_id` column yet (all child-scoped in
// docs/tenancy/org-id-coverage.generated.md). They are scoped via their
// `sku_catalog` parent (sku_id → sku_catalog.organization_id) where a SKU is
// present, and otherwise rely on the per-request `app.current_org` GUC set by
// tenantQuery/withTenantTransaction (the RLS backstop). Free-text demand rows
// (sku_id NULL) have no SKU anchor, so the GUC is their only isolation today.
// Functions reachable from out-of-fileset callers (jobs, the [id] candidate
// route) take an OPTIONAL orgId and keep byte-identical raw-pool behavior when
// it is omitted, so those callers do not break.

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface SourcingAlertRow {
  id: number;
  sku_id: number | null;
  bose_model_id: number | null;
  alert_type: string;
  severity: string;
  status: string;
  reason: string | null;
  opened_at: string;
  resolved_at: string | null;
  resolved_by: number | null;
  created_at: string;
  updated_at: string;
  // Unified-demand metadata (migration 2026-06-13d).
  demand_source: string;
  demand_ref_type: string | null;
  demand_ref_id: number | null;
  target_qty: number | null;
  search_query: string | null;
}

export interface SourcingAlertListRow extends SourcingAlertRow {
  sku: string | null;
  product_title: string | null;
  lifecycle_status: string | null;
  replenish_target_cents: number | null;
  model_number: string | null;
  model_name: string | null;
}

export interface SourcingCandidateRow {
  id: number;
  sku_id: number | null;
  bose_model_id: number | null;
  sourcing_alert_id: number | null;
  supplier_id: number | null;
  source: string;
  external_id: string | null;
  title: string;
  url: string | null;
  image_url: string | null;
  condition: string | null;
  price_cents: number | null;
  shipping_cents: number | null;
  currency: string;
  seller_name: string | null;
  status: string;
  raw: unknown;
  captured_at: string;
  created_at: string;
  updated_at: string;
}

// ─── Alerts ──────────────────────────────────────────────────────────────────

/**
 * List sourcing alerts, optionally filtered by status (defaults to the live
 * statuses open + sourcing). LEFT-joined to the SKU + model so the queue pane
 * can render context without N+1 lookups — and so SKU-less (free-text) demand
 * rows still appear. Ordered critical → warn → info, newest first within a
 * severity.
 */
export async function getSourcingAlerts(params: {
  status?: string | null;
  skuId?: number | null;
}, orgId: OrgId): Promise<SourcingAlertListRow[]> {
  const status = (params.status || '').trim();
  const skuId = params.skuId ?? null;

  // Scope to this org's SKUs (sku_catalog carries the org). SKU-less free-text
  // demand rows have no SKU anchor, so they pass through and rely on the GUC.
  const result = await tenantQuery<SourcingAlertListRow>(
    orgId,
    `SELECT
       sa.*,
       sc.sku,
       sc.product_title,
       sc.lifecycle_status,
       sc.replenish_target_cents,
       bm.model_number,
       bm.model_name
     FROM sourcing_alerts sa
     LEFT JOIN sku_catalog sc ON sc.id = sa.sku_id
     LEFT JOIN bose_models bm ON bm.id = sa.bose_model_id
     WHERE (
        $1 = '' AND sa.status IN ('open','sourcing')
        OR ($1 <> '' AND sa.status = $1)
     )
       AND ($2::int IS NULL OR sa.sku_id = $2)
       AND (sa.sku_id IS NULL OR sc.organization_id = $3)
     ORDER BY
       CASE sa.severity WHEN 'critical' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END,
       sa.opened_at DESC`,
    [status, skuId, orgId],
  );
  return result.rows;
}

export async function getSourcingAlertById(id: number, orgId: OrgId): Promise<SourcingAlertRow | null> {
  const result = await tenantQuery<SourcingAlertRow>(
    orgId,
    `SELECT sa.* FROM sourcing_alerts sa
       LEFT JOIN sku_catalog sc ON sc.id = sa.sku_id
      WHERE sa.id = $1
        AND (sa.sku_id IS NULL OR sc.organization_id = $2)
      LIMIT 1`,
    [id, orgId],
  );
  return result.rows[0] ?? null;
}

/**
 * Transition an alert's status. Resolving/dismissing stamps resolved_at +
 * resolved_by and stores the reason. Re-opening clears the resolution.
 */
export async function updateSourcingAlertStatus(params: {
  id: number;
  status: 'open' | 'sourcing' | 'resolved' | 'dismissed';
  reason?: string | null;
  resolvedBy?: number | null;
}, orgId: OrgId): Promise<SourcingAlertRow | null> {
  const isClosing = params.status === 'resolved' || params.status === 'dismissed';
  // Only transition alerts whose SKU belongs to this org (or SKU-less rows,
  // gated by the GUC); a cross-tenant id never matches.
  const result = await tenantQuery<SourcingAlertRow>(
    orgId,
    `UPDATE sourcing_alerts sa
        SET status      = $2,
            reason      = COALESCE($3, reason),
            resolved_at = CASE WHEN $4 THEN NOW() ELSE NULL END,
            resolved_by = CASE WHEN $4 THEN $5 ELSE NULL END,
            updated_at  = NOW()
      WHERE sa.id = $1
        AND (
          sa.sku_id IS NULL
          OR EXISTS (SELECT 1 FROM sku_catalog sc WHERE sc.id = sa.sku_id AND sc.organization_id = $6)
        )
      RETURNING sa.*`,
    [params.id, params.status, params.reason?.trim() || null, isClosing, params.resolvedBy ?? null, orgId],
  );
  return result.rows[0] ?? null;
}

export interface CreateDemandAlertInput {
  skuId?: number | null;
  boseModelId?: number | null;
  searchQuery?: string | null;
  alertType?: string;       // default 'manual'
  demandSource?: string;    // default 'manual'
  demandRefType?: string | null;
  demandRefId?: number | null;
  severity?: string;        // info|warn|critical (default 'warn')
  reason?: string | null;
  targetQty?: number | null;
}

/**
 * Open a demand alert in the unified sourcing queue — THE single demand writer
 * (manual "Source this" + every nightly demand collector). Idempotent via the
 * two live partial unique indexes: uniq_sourcing_alert_live (sku_id, alert_type)
 * for SKU-backed rows, and uniq_sourcing_alert_live_demand (demand_ref_type,
 * demand_ref_id, alert_type) for ref-backed rows (2026-06-13d). The bare
 * ON CONFLICT DO NOTHING arbitrates BOTH indexes, so a repeat open returns the
 * existing live row instead of duplicating or throwing. Free-text rows with
 * neither a SKU nor a demand ref have no natural key, so they always insert.
 * Returns { row, created }.
 */
export async function createDemandAlert(
  input: CreateDemandAlertInput,
  orgId: OrgId,
): Promise<{ row: SourcingAlertRow; created: boolean }> {
  const alertType = (input.alertType || 'manual').trim();
  const demandSource = (input.demandSource || 'manual').trim();
  const skuId = input.skuId ?? null;
  const demandRefType = input.demandRefType ?? null;
  const demandRefId = input.demandRefId ?? null;

  return withTenantTransaction(orgId, async (client) => {
    const ins = await client.query<SourcingAlertRow>(
      `INSERT INTO sourcing_alerts
         (sku_id, bose_model_id, alert_type, severity, status, reason,
          demand_source, demand_ref_type, demand_ref_id, target_qty, search_query)
       VALUES ($1,$2,$3,$4,'open',$5,$6,$7,$8,$9,$10)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        skuId,
        input.boseModelId ?? null,
        alertType,
        (input.severity || 'warn').trim(),
        input.reason?.trim() || null,
        demandSource,
        demandRefType,
        demandRefId,
        input.targetQty ?? null,
        input.searchQuery?.trim() || null,
      ],
    );
    if (ins.rows[0]) return { row: ins.rows[0], created: true };

    // Conflict on one of the live indexes — return the existing live row.
    if (skuId != null) {
      const bySku = await client.query<SourcingAlertRow>(
        `SELECT * FROM sourcing_alerts
          WHERE sku_id = $1 AND alert_type = $2 AND status IN ('open','sourcing')
          ORDER BY opened_at DESC LIMIT 1`,
        [skuId, alertType],
      );
      if (bySku.rows[0]) return { row: bySku.rows[0], created: false };
    }
    const byRef = await client.query<SourcingAlertRow>(
      `SELECT * FROM sourcing_alerts
        WHERE demand_ref_type = $1 AND demand_ref_id = $2 AND alert_type = $3
          AND status IN ('open','sourcing')
        ORDER BY opened_at DESC LIMIT 1`,
      [demandRefType, demandRefId, alertType],
    );
    return { row: byRef.rows[0], created: false };
  });
}

// ─── Candidates ──────────────────────────────────────────────────────────────

export async function getSourcingCandidates(params: {
  skuId?: number | null;
  boseModelId?: number | null;
  sourcingAlertId?: number | null;
  status?: string | null;
  limit?: number;
  offset?: number;
}, orgId: OrgId): Promise<{ items: SourcingCandidateRow[]; total: number }> {
  const skuId = params.skuId ?? null;
  const boseModelId = params.boseModelId ?? null;
  const alertId = params.sourcingAlertId ?? null;
  const status = (params.status || '').trim();
  const limit = Math.min(params.limit || 100, 500);
  const offset = params.offset || 0;

  // Scope to this org's SKUs (sku_catalog carries the org); SKU-less manual
  // candidates have no SKU anchor and rely on the GUC.
  const where = `
    FROM sourcing_candidates cnd
    WHERE ($1::int IS NULL OR cnd.sku_id = $1)
      AND ($2::int IS NULL OR cnd.bose_model_id = $2)
      AND ($3::int IS NULL OR cnd.sourcing_alert_id = $3)
      AND ($4 = '' OR cnd.status = $4)
      AND (
        cnd.sku_id IS NULL
        OR EXISTS (SELECT 1 FROM sku_catalog sc WHERE sc.id = cnd.sku_id AND sc.organization_id = $5)
      )`;

  const result = await tenantQuery<SourcingCandidateRow>(
    orgId,
    `SELECT cnd.* ${where}
      ORDER BY cnd.captured_at DESC
      LIMIT $6 OFFSET $7`,
    [skuId, boseModelId, alertId, status, orgId, limit, offset],
  );
  const countResult = await tenantQuery<{ total: number }>(
    orgId,
    `SELECT COUNT(*)::int AS total ${where}`,
    [skuId, boseModelId, alertId, status, orgId],
  );
  return { items: result.rows, total: countResult.rows[0]?.total || 0 };
}

export async function getSourcingCandidateById(id: number, orgId?: OrgId): Promise<SourcingCandidateRow | null> {
  // Optional orgId: candidates/[id]/route.ts (out of fileset) still calls this
  // without one. With orgId we org-scope via sku_catalog under the GUC; without
  // it we keep the original raw-pool behavior byte-identical.
  if (orgId) {
    const result = await tenantQuery<SourcingCandidateRow>(
      orgId,
      `SELECT cnd.* FROM sourcing_candidates cnd
         LEFT JOIN sku_catalog sc ON sc.id = cnd.sku_id
        WHERE cnd.id = $1
          AND (cnd.sku_id IS NULL OR sc.organization_id = $2)
        LIMIT 1`,
      [id, orgId],
    );
    return result.rows[0] ?? null;
  }
  const result = await pool.query<SourcingCandidateRow>(
    `SELECT * FROM sourcing_candidates WHERE id = $1 LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export interface SaveCandidateInput {
  source?: string;
  externalId?: string | null;
  title: string;
  url?: string | null;
  imageUrl?: string | null;
  condition?: string | null;
  priceCents?: number | null;
  shippingCents?: number | null;
  currency?: string | null;
  sellerName?: string | null;
  skuId?: number | null;
  boseModelId?: number | null;
  sourcingAlertId?: number | null;
  supplierId?: number | null;
  status?: string;
  raw?: unknown;
}

/**
 * Save (or refresh) a candidate. eBay hits dedupe on the (source, external_id)
 * partial unique index — a re-save updates price/status in place. Manual
 * candidates (no externalId) always insert. Returns { row, created }.
 */
export async function saveCandidate(
  input: SaveCandidateInput,
  orgId?: OrgId,
): Promise<{ row: SourcingCandidateRow; created: boolean }> {
  const source = (input.source || 'ebay').trim();
  const externalId = input.externalId?.trim() || null;

  // Optional orgId: the scour/replenishment jobs (out of fileset) call this
  // without one. With orgId the INSERTs run under the GUC (the RLS backstop);
  // without it we keep the original raw-pool path byte-identical.
  const exec = <T extends QueryResultRow>(sql: string, p: unknown[]) =>
    orgId ? tenantQuery<T>(orgId, sql, p) : pool.query<T>(sql, p);

  // eBay hit with an externalId: upsert on the unique index.
  if (externalId) {
    const result = await exec<SourcingCandidateRow & { inserted: boolean }>(
      `INSERT INTO sourcing_candidates
         (source, external_id, title, url, image_url, condition, price_cents, shipping_cents,
          currency, seller_name, sku_id, bose_model_id, sourcing_alert_id, supplier_id, status, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
       ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL
       DO UPDATE SET
         title          = EXCLUDED.title,
         url            = COALESCE(EXCLUDED.url, sourcing_candidates.url),
         image_url      = COALESCE(EXCLUDED.image_url, sourcing_candidates.image_url),
         condition      = COALESCE(EXCLUDED.condition, sourcing_candidates.condition),
         price_cents    = COALESCE(EXCLUDED.price_cents, sourcing_candidates.price_cents),
         shipping_cents = COALESCE(EXCLUDED.shipping_cents, sourcing_candidates.shipping_cents),
         seller_name    = COALESCE(EXCLUDED.seller_name, sourcing_candidates.seller_name),
         sku_id         = COALESCE(EXCLUDED.sku_id, sourcing_candidates.sku_id),
         bose_model_id  = COALESCE(EXCLUDED.bose_model_id, sourcing_candidates.bose_model_id),
         sourcing_alert_id = COALESCE(EXCLUDED.sourcing_alert_id, sourcing_candidates.sourcing_alert_id),
         status         = EXCLUDED.status,
         raw            = COALESCE(EXCLUDED.raw, sourcing_candidates.raw),
         updated_at     = NOW()
       RETURNING *, (xmax = 0) AS inserted`,
      [
        source, externalId, input.title.trim(), input.url?.trim() || null, input.imageUrl?.trim() || null,
        input.condition || null, input.priceCents ?? null, input.shippingCents ?? null,
        (input.currency?.trim() || 'USD'), input.sellerName?.trim() || null,
        input.skuId ?? null, input.boseModelId ?? null, input.sourcingAlertId ?? null,
        input.supplierId ?? null, (input.status || 'watching'),
        input.raw != null ? JSON.stringify(input.raw) : null,
      ],
    );
    const { inserted, ...row } = result.rows[0];
    return { row: row as SourcingCandidateRow, created: Boolean(inserted) };
  }

  // Manual candidate — always insert.
  const result = await exec<SourcingCandidateRow>(
    `INSERT INTO sourcing_candidates
       (source, title, url, image_url, condition, price_cents, shipping_cents, currency,
        seller_name, sku_id, bose_model_id, sourcing_alert_id, supplier_id, status, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
     RETURNING *`,
    [
      (source === 'ebay' ? 'manual' : source), input.title.trim(), input.url?.trim() || null,
      input.imageUrl?.trim() || null, input.condition || null, input.priceCents ?? null,
      input.shippingCents ?? null, (input.currency?.trim() || 'USD'), input.sellerName?.trim() || null,
      input.skuId ?? null, input.boseModelId ?? null, input.sourcingAlertId ?? null,
      input.supplierId ?? null, (input.status || 'watching'),
      input.raw != null ? JSON.stringify(input.raw) : null,
    ],
  );
  return { row: result.rows[0], created: true };
}

export async function updateCandidate(
  id: number,
  updates: {
    status?: string;
    skuId?: number | null;
    boseModelId?: number | null;
    supplierId?: number | null;
    sourcingAlertId?: number | null;
  },
  orgId?: OrgId,
): Promise<SourcingCandidateRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  const push = (col: string, val: unknown) => {
    sets.push(`${col} = $${idx++}`);
    values.push(val);
  };

  if (updates.status !== undefined) push('status', updates.status);
  if (updates.skuId !== undefined) push('sku_id', updates.skuId ?? null);
  if (updates.boseModelId !== undefined) push('bose_model_id', updates.boseModelId ?? null);
  if (updates.supplierId !== undefined) push('supplier_id', updates.supplierId ?? null);
  if (updates.sourcingAlertId !== undefined) push('sourcing_alert_id', updates.sourcingAlertId ?? null);

  if (sets.length === 0) return getSourcingCandidateById(id, orgId);
  sets.push(`updated_at = NOW()`);
  values.push(id);
  const idIdx = idx;

  // Optional orgId: candidates/[id]/route.ts (out of fileset) calls without one
  // (byte-identical raw-pool path). With orgId, scope the UPDATE to this org's
  // SKUs (or SKU-less rows under the GUC) so a cross-tenant id never matches.
  if (orgId) {
    values.push(orgId);
    const result = await tenantQuery<SourcingCandidateRow>(
      orgId,
      `UPDATE sourcing_candidates cnd SET ${sets.join(', ')}
        WHERE cnd.id = $${idIdx}
          AND (
            cnd.sku_id IS NULL
            OR EXISTS (SELECT 1 FROM sku_catalog sc WHERE sc.id = cnd.sku_id AND sc.organization_id = $${idIdx + 1})
          )
        RETURNING cnd.*`,
      values,
    );
    return result.rows[0] ?? null;
  }

  const result = await pool.query<SourcingCandidateRow>(
    `UPDATE sourcing_candidates SET ${sets.join(', ')} WHERE id = $${idIdx} RETURNING *`,
    values,
  );
  return result.rows[0] ?? null;
}

// ─── Acquisitions / import (candidate → receiving → ledger) ─────────────────

export interface PartAcquisitionRow {
  id: number;
  sourcing_candidate_id: number | null;
  supplier_id: number | null;
  sku_id: number;
  receiving_id: number | null;
  serial_unit_id: number | null;
  acquisition_cost_cents: number | null;
  shipping_cost_cents: number | null;
  condition: string | null;
  status: string;
  ordered_at: string;
  received_at: string | null;
}

export interface ImportCandidateResult {
  receivingId: number;
  acquisition: PartAcquisitionRow;
  supplier: SupplierRow | null;
  candidate: SourcingCandidateRow;
}

/**
 * The acquisition already created for a candidate, if any. Used as a second
 * idempotency guard so a retried import (even without an Idempotency-Key) won't
 * create a duplicate receiving row.
 */
export async function getAcquisitionByCandidateId(
  candidateId: number,
  orgId: OrgId,
): Promise<PartAcquisitionRow | null> {
  // part_acquisitions has no org column; scope via its sku_catalog parent
  // (sku_id is NOT NULL on this table) so a cross-tenant candidate id can't
  // surface another org's acquisition. Runs under the GUC.
  const result = await tenantQuery<PartAcquisitionRow>(
    orgId,
    `SELECT pa.* FROM part_acquisitions pa
       JOIN sku_catalog sc ON sc.id = pa.sku_id AND sc.organization_id = $2
      WHERE pa.sourcing_candidate_id = $1 AND pa.receiving_id IS NOT NULL
      ORDER BY pa.id ASC LIMIT 1`,
    [candidateId, orgId],
  );
  return result.rows[0] ?? null;
}

/**
 * Import a candidate into inventory inside one transaction:
 *   1. Resolve/auto-create the supplier (eBay seller → suppliers, deduped).
 *   2. Create a receiving header row (source='sourcing_import', source_platform='ebay').
 *   3. Insert a part_acquisitions(status='ordered') ledger row.
 *   4. Stamp sku_catalog.last_known_cost_cents from the acquisition cost.
 *   5. Mark the candidate ordered.
 * Returns the receiving id (the caller routes it into the normal unbox flow).
 * Idempotency at the HTTP layer (Idempotency-Key) prevents duplicate receiving
 * rows on retry.
 */
export async function importCandidate(params: {
  candidate: SourcingCandidateRow;
  skuId: number;
  acquisitionCostCents?: number | null;
  shippingCostCents?: number | null;
  condition?: string | null;
  carrier?: string | null;
  supplierId?: number | null;
  staffId?: number | null;
}, orgId: OrgId): Promise<ImportCandidateResult> {
  const { candidate } = params;
  // One tenant transaction: the GUC is set for the whole import so every write
  // (incl. the org-bearing `receiving` header) is attributed to this org.
  return withTenantTransaction<ImportCandidateResult>(orgId, async (client) => {
    // 1. Supplier — explicit override, existing link, or auto-create from seller.
    //    upsertEbaySupplier runs its own tenant-scoped statement (separate
    //    connection, as before) so thread the orgId through.
    let supplier: SupplierRow | null = null;
    let supplierId = params.supplierId ?? candidate.supplier_id ?? null;
    if (!supplierId && candidate.seller_name) {
      const { supplier: s } = await upsertEbaySupplier({
        ebaySellerId: candidate.external_id
          ? `seller:${candidate.seller_name.trim()}`
          : candidate.seller_name.trim(),
        name: candidate.seller_name,
      }, orgId);
      supplier = s;
      supplierId = s.id;
    } else if (supplierId) {
      const r = await client.query<SupplierRow>(`SELECT * FROM suppliers WHERE id = $1`, [supplierId]);
      supplier = r.rows[0] ?? null;
    }

    // 2. Receiving header (placeholder package for the inbound unbox).
    //    receiving carries organization_id — stamp it so the inbound row is
    //    owned by this org (was a NULL-org write bug before).
    const recv = await client.query<{ id: number }>(
      `INSERT INTO receiving
         (source, source_platform, carrier, needs_test, notes, organization_id, updated_at)
       VALUES ('sourcing_import', 'ebay', $1, true, $2, $3, NOW())
       RETURNING id`,
      [
        params.carrier?.trim() || null,
        `Sourcing import: ${candidate.title}${candidate.url ? ` (${candidate.url})` : ''}`,
        orgId,
      ],
    );
    const receivingId = Number(recv.rows[0].id);

    // 3. Acquisition ledger row (no org column; scoped via its sku_catalog
    //    parent + the GUC).
    const acq = await client.query<PartAcquisitionRow>(
      `INSERT INTO part_acquisitions
         (sourcing_candidate_id, supplier_id, sku_id, receiving_id,
          acquisition_cost_cents, shipping_cost_cents, condition, status, ordered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'ordered', NOW())
       RETURNING *`,
      [
        candidate.id,
        supplierId,
        params.skuId,
        receivingId,
        params.acquisitionCostCents ?? candidate.price_cents ?? null,
        params.shippingCostCents ?? candidate.shipping_cents ?? null,
        params.condition ?? candidate.condition ?? null,
      ],
    );

    // 4. Stamp rolling acquisition cost as the margin baseline — only on THIS
    //    org's SKU (sku_catalog carries the org).
    const costCents = params.acquisitionCostCents ?? candidate.price_cents ?? null;
    if (costCents != null) {
      await client.query(
        `UPDATE sku_catalog SET last_known_cost_cents = $1, updated_at = NOW()
          WHERE id = $2 AND organization_id = $3`,
        [costCents, params.skuId, orgId],
      );
    }

    // 5. Mark candidate ordered + link supplier/sku (under the GUC).
    const cand = await client.query<SourcingCandidateRow>(
      `UPDATE sourcing_candidates
          SET status = 'ordered',
              supplier_id = COALESCE($2, supplier_id),
              sku_id = COALESCE($3, sku_id),
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [candidate.id, supplierId, params.skuId],
    );

    return {
      receivingId,
      acquisition: acq.rows[0],
      supplier,
      candidate: cand.rows[0],
    };
  });
}

// ─── Analytics (read-only rollup for the hub's ?mode=analytics Monitor) ─────

export type SourcingAnalyticsRange = '30d' | '90d' | '1y';

const ANALYTICS_RANGE_INTERVAL: Record<SourcingAnalyticsRange, string> = {
  '30d': '30 days',
  '90d': '90 days',
  '1y': '365 days',
};

export interface SourcingSpendBucket {
  bucket: string;            // ISO week start
  acquisitions: number;
  spend_cents: number;
}

export interface SourcingSkuCostRow {
  sku_id: number;
  sku: string | null;
  product_title: string | null;
  acquisitions: number;
  avg_cost_cents: number | null;
  last_known_cost_cents: number | null;
  replenish_target_cents: number | null;
  spend_cents: number;
}

export interface SourcingAnalytics {
  range: SourcingAnalyticsRange;
  spendByWeek: SourcingSpendBucket[];
  acquisitions: {
    ordered: number;
    received: number;
    spend_cents: number;
    avg_days_order_to_receive: number | null;
  };
  demand: {
    opened: number;
    resolved: number;
    dismissed: number;
    avg_days_demand_to_order: number | null;
    sourced_from_alerts: number;
  };
  skuCosts: SourcingSkuCostRow[];
}

/**
 * Org-scoped sourcing analytics over part_acquisitions + sourcing_alerts +
 * sku_catalog.last_known_cost_cents / replenish_target_cents:
 *   - spend + acquisition volume per week,
 *   - fill-rate inputs (ordered vs received; demand opened vs resolved),
 *   - time-to-source (alert opened → ordered, ordered → received),
 *   - per-SKU acquisition cost vs the catalog target/baseline (margin proxy).
 * Pure read — four aggregate round-trips, no N+1.
 */
export async function getSourcingAnalytics(
  range: SourcingAnalyticsRange,
  orgId: OrgId,
): Promise<SourcingAnalytics> {
  const interval = ANALYTICS_RANGE_INTERVAL[range];

  const spend = await tenantQuery<{ bucket: string; acquisitions: number; spend_cents: string }>(
    orgId,
    `SELECT date_trunc('week', pa.ordered_at)::date::text AS bucket,
            COUNT(*)::int AS acquisitions,
            COALESCE(SUM(COALESCE(pa.acquisition_cost_cents, 0) + COALESCE(pa.shipping_cost_cents, 0)), 0)::bigint AS spend_cents
       FROM part_acquisitions pa
       JOIN sku_catalog sc ON sc.id = pa.sku_id AND sc.organization_id = $1
      WHERE pa.ordered_at >= NOW() - $2::interval
      GROUP BY 1
      ORDER BY 1`,
    [orgId, interval],
  );

  const acq = await tenantQuery<{
    ordered: number;
    received: number;
    spend_cents: string;
    avg_days_order_to_receive: string | null;
  }>(
    orgId,
    `SELECT COUNT(*)::int AS ordered,
            COUNT(*) FILTER (WHERE pa.received_at IS NOT NULL)::int AS received,
            COALESCE(SUM(COALESCE(pa.acquisition_cost_cents, 0) + COALESCE(pa.shipping_cost_cents, 0)), 0)::bigint AS spend_cents,
            AVG(EXTRACT(EPOCH FROM (pa.received_at - pa.ordered_at)) / 86400.0)
              FILTER (WHERE pa.received_at IS NOT NULL) AS avg_days_order_to_receive
       FROM part_acquisitions pa
       JOIN sku_catalog sc ON sc.id = pa.sku_id AND sc.organization_id = $1
      WHERE pa.ordered_at >= NOW() - $2::interval`,
    [orgId, interval],
  );

  const demand = await tenantQuery<{
    opened: number;
    resolved: number;
    dismissed: number;
  }>(
    orgId,
    `SELECT COUNT(*)::int AS opened,
            COUNT(*) FILTER (WHERE sa.status = 'resolved')::int AS resolved,
            COUNT(*) FILTER (WHERE sa.status = 'dismissed')::int AS dismissed
       FROM sourcing_alerts sa
       LEFT JOIN sku_catalog sc ON sc.id = sa.sku_id
      WHERE sa.opened_at >= NOW() - $2::interval
        AND (sa.sku_id IS NULL OR sc.organization_id = $1)`,
    [orgId, interval],
  );

  const timeToSource = await tenantQuery<{
    sourced_from_alerts: number;
    avg_days_demand_to_order: string | null;
  }>(
    orgId,
    `SELECT COUNT(*)::int AS sourced_from_alerts,
            AVG(EXTRACT(EPOCH FROM (pa.ordered_at - sa.opened_at)) / 86400.0) AS avg_days_demand_to_order
       FROM part_acquisitions pa
       JOIN sourcing_candidates cnd ON cnd.id = pa.sourcing_candidate_id
       JOIN sourcing_alerts sa ON sa.id = cnd.sourcing_alert_id
       JOIN sku_catalog sc ON sc.id = pa.sku_id AND sc.organization_id = $1
      WHERE pa.ordered_at >= NOW() - $2::interval`,
    [orgId, interval],
  );

  const skuCosts = await tenantQuery<{
    sku_id: number;
    sku: string | null;
    product_title: string | null;
    acquisitions: number;
    avg_cost_cents: string | null;
    last_known_cost_cents: number | null;
    replenish_target_cents: number | null;
    spend_cents: string;
  }>(
    orgId,
    `SELECT sc.id AS sku_id, sc.sku, sc.product_title,
            COUNT(*)::int AS acquisitions,
            AVG(pa.acquisition_cost_cents)::int AS avg_cost_cents,
            sc.last_known_cost_cents, sc.replenish_target_cents,
            COALESCE(SUM(COALESCE(pa.acquisition_cost_cents, 0) + COALESCE(pa.shipping_cost_cents, 0)), 0)::bigint AS spend_cents
       FROM part_acquisitions pa
       JOIN sku_catalog sc ON sc.id = pa.sku_id AND sc.organization_id = $1
      WHERE pa.ordered_at >= NOW() - $2::interval
      GROUP BY sc.id, sc.sku, sc.product_title, sc.last_known_cost_cents, sc.replenish_target_cents
      ORDER BY spend_cents DESC
      LIMIT 12`,
    [orgId, interval],
  );

  const toNum = (v: string | number | null | undefined): number | null =>
    v == null ? null : Number(v);

  const acqRow = acq.rows[0];
  const demandRow = demand.rows[0];
  const ttsRow = timeToSource.rows[0];

  return {
    range,
    spendByWeek: spend.rows.map((r) => ({
      bucket: r.bucket,
      acquisitions: r.acquisitions,
      spend_cents: Number(r.spend_cents),
    })),
    acquisitions: {
      ordered: acqRow?.ordered ?? 0,
      received: acqRow?.received ?? 0,
      spend_cents: Number(acqRow?.spend_cents ?? 0),
      avg_days_order_to_receive: toNum(acqRow?.avg_days_order_to_receive ?? null),
    },
    demand: {
      opened: demandRow?.opened ?? 0,
      resolved: demandRow?.resolved ?? 0,
      dismissed: demandRow?.dismissed ?? 0,
      avg_days_demand_to_order: toNum(ttsRow?.avg_days_demand_to_order ?? null),
      sourced_from_alerts: ttsRow?.sourced_from_alerts ?? 0,
    },
    skuCosts: skuCosts.rows.map((r) => ({
      sku_id: r.sku_id,
      sku: r.sku,
      product_title: r.product_title,
      acquisitions: r.acquisitions,
      avg_cost_cents: toNum(r.avg_cost_cents),
      last_known_cost_cents: r.last_known_cost_cents,
      replenish_target_cents: r.replenish_target_cents,
      spend_cents: Number(r.spend_cents),
    })),
  };
}
