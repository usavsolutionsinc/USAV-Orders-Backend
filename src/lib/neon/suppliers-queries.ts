import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

// ─── Tenancy note ────────────────────────────────────────────────────────────
// `suppliers` has no `organization_id` column yet (tenant-owned-NEEDS-COL in
// docs/tenancy/org-id-coverage.generated.md) and no parent FK to scope through,
// so there is no column-level predicate to add here. Every statement is run via
// `tenantQuery`/`withTenantTransaction` so it executes under the per-request
// `app.current_org` GUC (the RLS backstop) once the suppliers table is given an
// org column + FORCE in a later phase. Callers must thread the request's orgId.

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface SupplierRow {
  id: number;
  name: string;
  supplier_type: string;
  email: string | null;
  phone: string | null;
  url: string | null;
  ebay_seller_id: string | null;
  rating: number | null;
  lead_time_days: number | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── List ────────────────────────────────────────────────────────────────────

export async function getSupplierList(params: {
  q?: string;
  type?: string | null;
  limit?: number;
  offset?: number;
}, orgId: OrgId): Promise<{ items: SupplierRow[]; total: number }> {
  const search = (params.q || '').trim();
  const type = (params.type || '').trim();
  const limit = Math.min(params.limit || 100, 500);
  const offset = params.offset || 0;

  const result = await tenantQuery<SupplierRow>(
    orgId,
    `SELECT * FROM suppliers
      WHERE is_active = true
        AND ($1 = '' OR name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%' OR ebay_seller_id ILIKE '%' || $1 || '%')
        AND ($2 = '' OR supplier_type = $2)
      ORDER BY name
      LIMIT $3 OFFSET $4`,
    [search, type, limit, offset],
  );

  const countResult = await tenantQuery<{ total: number }>(
    orgId,
    `SELECT COUNT(*)::int AS total FROM suppliers
      WHERE is_active = true
        AND ($1 = '' OR name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%' OR ebay_seller_id ILIKE '%' || $1 || '%')
        AND ($2 = '' OR supplier_type = $2)`,
    [search, type],
  );

  return { items: result.rows, total: countResult.rows[0]?.total || 0 };
}

export interface SupplierWithStatsRow extends SupplierRow {
  candidate_count: number;
  acquisition_count: number;
  spend_cents: number;
  last_ordered_at: string | null;
}

/**
 * Supplier list enriched with their sourcing activity — candidate count, number
 * of acquisitions, total spend (acquisition + shipping), and last order date.
 * Powers the read-only Suppliers rollup in the sourcing hub. Aggregates are
 * computed in two grouped sub-selects (no per-row N+1).
 */
export async function getSupplierListWithStats(params: {
  q?: string;
  type?: string | null;
  limit?: number;
  offset?: number;
}, orgId: OrgId): Promise<{ items: SupplierWithStatsRow[]; total: number }> {
  const search = (params.q || '').trim();
  const type = (params.type || '').trim();
  const limit = Math.min(params.limit || 100, 500);
  const offset = params.offset || 0;

  // supplier_id joins below are on the globally-unique integer PK (suppliers.id)
  // so they are tenant-safe bare (Rule 4); the whole query runs under the GUC.
  const result = await tenantQuery<SupplierWithStatsRow>(
    orgId,
    `SELECT s.*,
            COALESCE(c.candidate_count, 0)   AS candidate_count,
            COALESCE(a.acquisition_count, 0) AS acquisition_count,
            COALESCE(a.spend_cents, 0)       AS spend_cents,
            a.last_ordered_at
       FROM suppliers s
       LEFT JOIN (
         SELECT supplier_id, COUNT(*)::int AS candidate_count
           FROM sourcing_candidates WHERE supplier_id IS NOT NULL GROUP BY supplier_id
       ) c ON c.supplier_id = s.id
       LEFT JOIN (
         SELECT supplier_id,
                COUNT(*)::int AS acquisition_count,
                COALESCE(SUM(COALESCE(acquisition_cost_cents,0) + COALESCE(shipping_cost_cents,0)),0)::bigint AS spend_cents,
                MAX(ordered_at) AS last_ordered_at
           FROM part_acquisitions WHERE supplier_id IS NOT NULL GROUP BY supplier_id
       ) a ON a.supplier_id = s.id
      WHERE s.is_active = true
        AND ($1 = '' OR s.name ILIKE '%' || $1 || '%' OR s.email ILIKE '%' || $1 || '%' OR s.ebay_seller_id ILIKE '%' || $1 || '%')
        AND ($2 = '' OR s.supplier_type = $2)
      ORDER BY a.spend_cents DESC NULLS LAST, s.name
      LIMIT $3 OFFSET $4`,
    [search, type, limit, offset],
  );

  const countResult = await tenantQuery<{ total: number }>(
    orgId,
    `SELECT COUNT(*)::int AS total FROM suppliers
      WHERE is_active = true
        AND ($1 = '' OR name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%' OR ebay_seller_id ILIKE '%' || $1 || '%')
        AND ($2 = '' OR supplier_type = $2)`,
    [search, type],
  );

  // pg returns bigint (SUM::bigint) as a string — coerce spend to a number.
  const items = result.rows.map((r) => ({ ...r, spend_cents: Number(r.spend_cents) }));
  return { items, total: countResult.rows[0]?.total || 0 };
}

export async function getSupplierById(id: number, orgId: OrgId): Promise<SupplierRow | null> {
  const result = await tenantQuery<SupplierRow>(
    orgId,
    `SELECT * FROM suppliers WHERE id = $1 LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function getSupplierByEbaySellerId(ebaySellerId: string, orgId: OrgId): Promise<SupplierRow | null> {
  const trimmed = ebaySellerId.trim();
  if (!trimmed) return null;
  const result = await tenantQuery<SupplierRow>(
    orgId,
    `SELECT * FROM suppliers WHERE ebay_seller_id = $1 LIMIT 1`,
    [trimmed],
  );
  return result.rows[0] ?? null;
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createSupplier(params: {
  name: string;
  supplierType?: string;
  email?: string | null;
  phone?: string | null;
  url?: string | null;
  ebaySellerId?: string | null;
  rating?: number | null;
  leadTimeDays?: number | null;
  notes?: string | null;
  isActive?: boolean;
}, orgId: OrgId): Promise<SupplierRow> {
  const result = await tenantQuery<SupplierRow>(
    orgId,
    `INSERT INTO suppliers
       (name, supplier_type, email, phone, url, ebay_seller_id, rating, lead_time_days, notes, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      params.name.trim(),
      params.supplierType?.trim() || 'other',
      params.email?.trim() || null,
      params.phone?.trim() || null,
      params.url?.trim() || null,
      params.ebaySellerId?.trim() || null,
      params.rating ?? null,
      params.leadTimeDays ?? null,
      params.notes?.trim() || null,
      params.isActive ?? true,
    ],
  );
  return result.rows[0];
}

/**
 * Find-or-create a supplier for an eBay seller. The partial unique index on
 * ebay_seller_id (WHERE NOT NULL) makes this safe under concurrent imports:
 * the INSERT ... ON CONFLICT reactivates / returns the existing seller row.
 * Returns { supplier, created }.
 */
export async function upsertEbaySupplier(params: {
  ebaySellerId: string;
  name?: string | null;
}, orgId: OrgId): Promise<{ supplier: SupplierRow; created: boolean }> {
  const sellerId = params.ebaySellerId.trim();
  const name = (params.name?.trim() || sellerId) || sellerId;
  const result = await tenantQuery<SupplierRow & { inserted: boolean }>(
    orgId,
    `INSERT INTO suppliers (name, supplier_type, ebay_seller_id)
       VALUES ($1, 'ebay_seller', $2)
     ON CONFLICT (ebay_seller_id) WHERE ebay_seller_id IS NOT NULL
       DO UPDATE SET is_active = true, updated_at = NOW()
     RETURNING *, (xmax = 0) AS inserted`,
    [name, sellerId],
  );
  const row = result.rows[0];
  const { inserted, ...supplier } = row;
  return { supplier: supplier as SupplierRow, created: Boolean(inserted) };
}

// ─── Update (dynamic SET) ────────────────────────────────────────────────────

export async function updateSupplier(
  id: number,
  updates: {
    name?: string;
    supplierType?: string;
    email?: string | null;
    phone?: string | null;
    url?: string | null;
    ebaySellerId?: string | null;
    rating?: number | null;
    leadTimeDays?: number | null;
    notes?: string | null;
    isActive?: boolean;
  },
  orgId: OrgId,
): Promise<SupplierRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  const push = (col: string, val: unknown) => {
    sets.push(`${col} = $${idx++}`);
    values.push(val);
  };

  if (updates.name !== undefined) push('name', updates.name.trim());
  if (updates.supplierType !== undefined) push('supplier_type', updates.supplierType.trim());
  if (updates.email !== undefined) push('email', updates.email?.trim() || null);
  if (updates.phone !== undefined) push('phone', updates.phone?.trim() || null);
  if (updates.url !== undefined) push('url', updates.url?.trim() || null);
  if (updates.ebaySellerId !== undefined) push('ebay_seller_id', updates.ebaySellerId?.trim() || null);
  if (updates.rating !== undefined) push('rating', updates.rating ?? null);
  if (updates.leadTimeDays !== undefined) push('lead_time_days', updates.leadTimeDays ?? null);
  if (updates.notes !== undefined) push('notes', updates.notes?.trim() || null);
  if (updates.isActive !== undefined) push('is_active', updates.isActive);

  if (sets.length === 0) return getSupplierById(id, orgId);
  sets.push(`updated_at = NOW()`);
  values.push(id);

  const result = await tenantQuery<SupplierRow>(
    orgId,
    `UPDATE suppliers SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return result.rows[0] ?? null;
}

export async function softDeleteSupplier(id: number, orgId: OrgId): Promise<SupplierRow | null> {
  const result = await tenantQuery<SupplierRow>(
    orgId,
    `UPDATE suppliers
        SET is_active = false, updated_at = NOW()
      WHERE id = $1 AND is_active = true
      RETURNING *`,
    [id],
  );
  return result.rows[0] ?? null;
}
