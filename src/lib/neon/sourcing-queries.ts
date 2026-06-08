import pool from '../db';
import { upsertEbaySupplier, type SupplierRow } from './suppliers-queries';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface SourcingAlertRow {
  id: number;
  sku_id: number;
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
 * statuses open + sourcing). Joined to the SKU + model so the alert pane can
 * render context without N+1 lookups. Ordered critical → warn → info, newest
 * first within a severity.
 */
export async function getSourcingAlerts(params: {
  status?: string | null;
  skuId?: number | null;
}): Promise<SourcingAlertListRow[]> {
  const status = (params.status || '').trim();
  const skuId = params.skuId ?? null;

  const result = await pool.query<SourcingAlertListRow>(
    `SELECT
       sa.*,
       sc.sku,
       sc.product_title,
       sc.lifecycle_status,
       sc.replenish_target_cents,
       bm.model_number,
       bm.model_name
     FROM sourcing_alerts sa
     JOIN sku_catalog sc ON sc.id = sa.sku_id
     LEFT JOIN bose_models bm ON bm.id = sa.bose_model_id
     WHERE (
        $1 = '' AND sa.status IN ('open','sourcing')
        OR ($1 <> '' AND sa.status = $1)
     )
       AND ($2::int IS NULL OR sa.sku_id = $2)
     ORDER BY
       CASE sa.severity WHEN 'critical' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END,
       sa.opened_at DESC`,
    [status, skuId],
  );
  return result.rows;
}

export async function getSourcingAlertById(id: number): Promise<SourcingAlertRow | null> {
  const result = await pool.query<SourcingAlertRow>(
    `SELECT * FROM sourcing_alerts WHERE id = $1 LIMIT 1`,
    [id],
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
}): Promise<SourcingAlertRow | null> {
  const isClosing = params.status === 'resolved' || params.status === 'dismissed';
  const result = await pool.query<SourcingAlertRow>(
    `UPDATE sourcing_alerts
        SET status      = $2,
            reason      = COALESCE($3, reason),
            resolved_at = CASE WHEN $4 THEN NOW() ELSE NULL END,
            resolved_by = CASE WHEN $4 THEN $5 ELSE NULL END,
            updated_at  = NOW()
      WHERE id = $1
      RETURNING *`,
    [params.id, params.status, params.reason?.trim() || null, isClosing, params.resolvedBy ?? null],
  );
  return result.rows[0] ?? null;
}

// ─── Candidates ──────────────────────────────────────────────────────────────

export async function getSourcingCandidates(params: {
  skuId?: number | null;
  boseModelId?: number | null;
  sourcingAlertId?: number | null;
  status?: string | null;
  limit?: number;
  offset?: number;
}): Promise<{ items: SourcingCandidateRow[]; total: number }> {
  const skuId = params.skuId ?? null;
  const boseModelId = params.boseModelId ?? null;
  const alertId = params.sourcingAlertId ?? null;
  const status = (params.status || '').trim();
  const limit = Math.min(params.limit || 100, 500);
  const offset = params.offset || 0;

  const where = `
    WHERE ($1::int IS NULL OR sku_id = $1)
      AND ($2::int IS NULL OR bose_model_id = $2)
      AND ($3::int IS NULL OR sourcing_alert_id = $3)
      AND ($4 = '' OR status = $4)`;

  const result = await pool.query<SourcingCandidateRow>(
    `SELECT * FROM sourcing_candidates ${where}
      ORDER BY captured_at DESC
      LIMIT $5 OFFSET $6`,
    [skuId, boseModelId, alertId, status, limit, offset],
  );
  const countResult = await pool.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM sourcing_candidates ${where}`,
    [skuId, boseModelId, alertId, status],
  );
  return { items: result.rows, total: countResult.rows[0]?.total || 0 };
}

export async function getSourcingCandidateById(id: number): Promise<SourcingCandidateRow | null> {
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
): Promise<{ row: SourcingCandidateRow; created: boolean }> {
  const source = (input.source || 'ebay').trim();
  const externalId = input.externalId?.trim() || null;

  // eBay hit with an externalId: upsert on the unique index.
  if (externalId) {
    const result = await pool.query<SourcingCandidateRow & { inserted: boolean }>(
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
  const result = await pool.query<SourcingCandidateRow>(
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

  if (sets.length === 0) return getSourcingCandidateById(id);
  sets.push(`updated_at = NOW()`);
  values.push(id);

  const result = await pool.query<SourcingCandidateRow>(
    `UPDATE sourcing_candidates SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
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
): Promise<PartAcquisitionRow | null> {
  const result = await pool.query<PartAcquisitionRow>(
    `SELECT * FROM part_acquisitions
      WHERE sourcing_candidate_id = $1 AND receiving_id IS NOT NULL
      ORDER BY id ASC LIMIT 1`,
    [candidateId],
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
}): Promise<ImportCandidateResult> {
  const { candidate } = params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Supplier — explicit override, existing link, or auto-create from seller.
    let supplier: SupplierRow | null = null;
    let supplierId = params.supplierId ?? candidate.supplier_id ?? null;
    if (!supplierId && candidate.seller_name) {
      const { supplier: s } = await upsertEbaySupplier({
        ebaySellerId: candidate.external_id
          ? `seller:${candidate.seller_name.trim()}`
          : candidate.seller_name.trim(),
        name: candidate.seller_name,
      });
      supplier = s;
      supplierId = s.id;
    } else if (supplierId) {
      const r = await client.query<SupplierRow>(`SELECT * FROM suppliers WHERE id = $1`, [supplierId]);
      supplier = r.rows[0] ?? null;
    }

    // 2. Receiving header (placeholder package for the inbound unbox).
    const recv = await client.query<{ id: number }>(
      `INSERT INTO receiving
         (source, source_platform, carrier, needs_test, notes, updated_at)
       VALUES ('sourcing_import', 'ebay', $1, true, $2, NOW())
       RETURNING id`,
      [
        params.carrier?.trim() || null,
        `Sourcing import: ${candidate.title}${candidate.url ? ` (${candidate.url})` : ''}`,
      ],
    );
    const receivingId = Number(recv.rows[0].id);

    // 3. Acquisition ledger row.
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

    // 4. Stamp rolling acquisition cost as the margin baseline.
    const costCents = params.acquisitionCostCents ?? candidate.price_cents ?? null;
    if (costCents != null) {
      await client.query(
        `UPDATE sku_catalog SET last_known_cost_cents = $1, updated_at = NOW() WHERE id = $2`,
        [costCents, params.skuId],
      );
    }

    // 5. Mark candidate ordered + link supplier/sku.
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

    await client.query('COMMIT');
    return {
      receivingId,
      acquisition: acq.rows[0],
      supplier,
      candidate: cand.rows[0],
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
