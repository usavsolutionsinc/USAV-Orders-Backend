/**
 * Data access for `part_links` — the SaaS-owned part → parent pairing (see the
 * 2026-06-28g migration). Mirrors the sibling `sku-relationship-queries` style:
 * plain org-scoped functions over `tenantQuery` / `withTenantTransaction`.
 *
 * Keyed on the LOGICAL part (base + color + condition; `parsePartSku().logicalKey`)
 * and the Zoho `items` scheme (FK `items.id`) — never the colliding SKU string.
 */
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';

export type PartLinkStatus = 'confirmed' | 'not_a_part';

export interface PartLinkRow {
  id: number;
  child_logical_key: string;
  child_base: string;
  status: PartLinkStatus;
  parent_item_id: string | null;
  parent_zoho_item_id: string | null;
  qty: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** A link enriched with its parent item's display fields (for the graph join). */
export interface PartLinkWithParent extends PartLinkRow {
  parent_sku: string | null;
  parent_name: string | null;
}

export interface AssignParentInput {
  childLogicalKey: string;
  childBase: string;
  parentItemId: string;
  qty?: number;
  notes?: string | null;
  createdByStaffId?: number | null;
}

/** All links for the org, each LEFT JOINed to its parent item. Small table. */
export async function listPartLinks(orgId: string): Promise<PartLinkWithParent[]> {
  const res = await tenantQuery<PartLinkWithParent>(
    orgId,
    `SELECT pl.*, i.sku AS parent_sku, i.name AS parent_name
       FROM part_links pl
       LEFT JOIN items i ON i.id = pl.parent_item_id AND i.organization_id = $1
      WHERE pl.organization_id = $1
      ORDER BY pl.child_base, pl.child_logical_key, pl.id`,
    [orgId],
  );
  return res.rows;
}

export async function getPartLinkById(orgId: string, id: number): Promise<PartLinkRow | null> {
  const res = await tenantQuery<PartLinkRow>(
    orgId,
    `SELECT * FROM part_links WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [id, orgId],
  );
  return res.rows[0] ?? null;
}

/**
 * Assign a parent to a logical part. Assigning a parent implies the child IS a
 * part, so any prior `not_a_part` acknowledgement for that child is cleared.
 * Re-assigning the same (child, parent) updates qty/notes rather than erroring.
 */
export async function assignParent(orgId: string, input: AssignParentInput): Promise<PartLinkRow> {
  return withTenantTransaction(orgId, async (client) => {
    await client.query(
      `DELETE FROM part_links
        WHERE organization_id = $1 AND child_logical_key = $2 AND status = 'not_a_part'`,
      [orgId, input.childLogicalKey],
    );

    const res = await client.query<PartLinkRow>(
      `INSERT INTO part_links
         (organization_id, child_logical_key, child_base, status, parent_item_id,
          parent_zoho_item_id, qty, notes, created_by_staff_id)
       SELECT $1, $2, $3, 'confirmed', i.id, i.zoho_item_id, $5, $6, $7
         FROM items i
        WHERE i.id = $4 AND i.organization_id = $1
       ON CONFLICT (organization_id, child_logical_key, parent_item_id)
         DO UPDATE SET qty = EXCLUDED.qty, notes = EXCLUDED.notes, updated_at = now()
       RETURNING *`,
      [
        orgId,
        input.childLogicalKey,
        input.childBase,
        input.parentItemId,
        input.qty ?? 1,
        input.notes ?? null,
        input.createdByStaffId ?? null,
      ],
    );
    // No row → the parent item id didn't resolve for this org.
    return res.rows[0];
  });
}

/**
 * Acknowledge a logical part as "not actually a part". Clears any confirmed
 * parent edges for that child (they contradict the acknowledgement) and writes
 * the single `not_a_part` row.
 */
export async function markNotAPart(
  orgId: string,
  childLogicalKey: string,
  childBase: string,
  createdByStaffId?: number | null,
): Promise<PartLinkRow> {
  return withTenantTransaction(orgId, async (client) => {
    await client.query(
      `DELETE FROM part_links
        WHERE organization_id = $1 AND child_logical_key = $2 AND status = 'confirmed'`,
      [orgId, childLogicalKey],
    );

    const res = await client.query<PartLinkRow>(
      `INSERT INTO part_links
         (organization_id, child_logical_key, child_base, status, created_by_staff_id)
       VALUES ($1, $2, $3, 'not_a_part', $4)
       ON CONFLICT (organization_id, child_logical_key) WHERE status = 'not_a_part'
         DO UPDATE SET updated_at = now()
       RETURNING *`,
      [orgId, childLogicalKey, childBase, createdByStaffId ?? null],
    );
    return res.rows[0];
  });
}

/** Delete a link by id. Returns the deleted row (for audit), or null if absent. */
export async function removeLinkById(orgId: string, id: number): Promise<PartLinkRow | null> {
  const res = await tenantQuery<PartLinkRow>(
    orgId,
    `DELETE FROM part_links WHERE id = $1 AND organization_id = $2 RETURNING *`,
    [id, orgId],
  );
  return res.rows[0] ?? null;
}
