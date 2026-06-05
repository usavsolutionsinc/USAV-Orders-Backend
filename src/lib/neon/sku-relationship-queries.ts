import pool from '../db';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface SkuRelationshipRow {
  id: number;
  parent_sku_id: number;
  child_sku_id: number;
  qty: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** A catalog node enriched with the stock figure the graph/detail panel needs. */
export interface SkuGraphNode {
  sku_id: number;
  sku: string;
  product_title: string;
  category: string | null;
  sku_type: 'system' | 'assembly' | 'component' | null;
  image_url: string | null;
  stock: number;
}

/** One side of a relationship as seen from a focused SKU (the "other" node). */
export interface SkuRelationshipEdgeView extends SkuGraphNode {
  relationship_id: number;
  qty: number;
  notes: string | null;
}

/** A single edge in a tree response (ids only; nodes are returned separately). */
export interface SkuTreeEdge {
  relationship_id: number;
  parent_sku_id: number;
  child_sku_id: number;
  qty: number;
  depth: number;
}

const NODE_SELECT = `
  c.id   AS sku_id,
  c.sku,
  c.product_title,
  c.category,
  c.sku_type,
  c.image_url,
  COALESCE(st.stock, 0)::int AS stock
`;

// sku_stock is keyed by text `sku` and may hold 0..n rows per SKU (per
// dimension), so aggregate defensively rather than assuming one row.
const NODE_STOCK_JOIN = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(s.stock), 0) AS stock
    FROM sku_stock s
    WHERE s.sku = c.sku
  ) st ON TRUE
`;

// ─── Reads ───────────────────────────────────────────────────────────────────

/** All direct PARENTS of a SKU ("what systems does this part belong to?"). */
export async function getParents(skuId: number): Promise<SkuRelationshipEdgeView[]> {
  const result = await pool.query(
    `SELECT r.id AS relationship_id, r.qty, r.notes, ${NODE_SELECT}
       FROM sku_relationships r
       JOIN sku_catalog c ON c.id = r.parent_sku_id
       ${NODE_STOCK_JOIN}
      WHERE r.child_sku_id = $1
      ORDER BY c.product_title, c.sku`,
    [skuId],
  );
  return result.rows;
}

/** All direct CHILDREN of a SKU ("what parts make up this item?"). */
export async function getChildren(skuId: number): Promise<SkuRelationshipEdgeView[]> {
  const result = await pool.query(
    `SELECT r.id AS relationship_id, r.qty, r.notes, ${NODE_SELECT}
       FROM sku_relationships r
       JOIN sku_catalog c ON c.id = r.child_sku_id
       ${NODE_STOCK_JOIN}
      WHERE r.parent_sku_id = $1
      ORDER BY c.product_title, c.sku`,
    [skuId],
  );
  return result.rows;
}

/** Fetch enriched catalog nodes for a set of ids (one query). */
export async function getGraphNodes(skuIds: number[]): Promise<SkuGraphNode[]> {
  if (skuIds.length === 0) return [];
  const result = await pool.query(
    `SELECT ${NODE_SELECT}
       FROM sku_catalog c
       ${NODE_STOCK_JOIN}
      WHERE c.id = ANY($1::int[])`,
    [skuIds],
  );
  return result.rows;
}

export interface SkuTreeResult {
  root_sku_id: number;
  edges: SkuTreeEdge[];
  nodes: SkuGraphNode[];
}

/**
 * Full descendant tree below a root SKU. Depth-capped to guard against any
 * accidental cycle. Returns edges (ids) plus the deduped set of catalog nodes
 * that appear anywhere in the tree (root included), so the client can render
 * without N round-trips.
 */
export async function getTree(rootSkuId: number, maxDepth = 10): Promise<SkuTreeResult> {
  const edgeResult = await pool.query(
    `WITH RECURSIVE tree AS (
       SELECT r.id, r.parent_sku_id, r.child_sku_id, r.qty, 0 AS depth
         FROM sku_relationships r
        WHERE r.parent_sku_id = $1
       UNION ALL
       SELECT r.id, r.parent_sku_id, r.child_sku_id, r.qty, t.depth + 1
         FROM sku_relationships r
         JOIN tree t ON r.parent_sku_id = t.child_sku_id
        WHERE t.depth < $2
     )
     SELECT DISTINCT t.id AS relationship_id, t.parent_sku_id, t.child_sku_id, t.qty, t.depth
       FROM tree t
      ORDER BY depth`,
    [rootSkuId, maxDepth],
  );
  const edges: SkuTreeEdge[] = edgeResult.rows;

  const nodeIds = new Set<number>([rootSkuId]);
  for (const e of edges) {
    nodeIds.add(e.parent_sku_id);
    nodeIds.add(e.child_sku_id);
  }
  const nodes = await getGraphNodes([...nodeIds]);

  return { root_sku_id: rootSkuId, edges, nodes };
}

export async function getRelationshipById(id: number): Promise<SkuRelationshipRow | null> {
  const result = await pool.query(
    `SELECT * FROM sku_relationships WHERE id = $1 LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function findRelationship(
  parentSkuId: number,
  childSkuId: number,
): Promise<SkuRelationshipRow | null> {
  const result = await pool.query(
    `SELECT * FROM sku_relationships WHERE parent_sku_id = $1 AND child_sku_id = $2 LIMIT 1`,
    [parentSkuId, childSkuId],
  );
  return result.rows[0] ?? null;
}

/**
 * Is `targetId` reachable by walking DOWN (parent→child) from `rootId`?
 * Used for cycle prevention: before inserting parent→child, reject if `parent`
 * is already a descendant of `child` (i.e. isDescendant(childId, parentId)),
 * which would otherwise close a loop. UNION (not UNION ALL) terminates even if
 * a cycle somehow already exists.
 */
export async function isDescendant(rootId: number, targetId: number): Promise<boolean> {
  const result = await pool.query(
    `WITH RECURSIVE down AS (
       SELECT child_sku_id FROM sku_relationships WHERE parent_sku_id = $1
       UNION
       SELECT r.child_sku_id
         FROM sku_relationships r
         JOIN down d ON r.parent_sku_id = d.child_sku_id
     )
     SELECT 1 FROM down WHERE child_sku_id = $2 LIMIT 1`,
    [rootId, targetId],
  );
  return result.rows.length > 0;
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export async function createRelationship(params: {
  parentSkuId: number;
  childSkuId: number;
  qty?: number;
  notes?: string | null;
}): Promise<SkuRelationshipRow> {
  const result = await pool.query(
    `INSERT INTO sku_relationships (parent_sku_id, child_sku_id, qty, notes)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [
      params.parentSkuId,
      params.childSkuId,
      params.qty ?? 1,
      params.notes?.trim() || null,
    ],
  );
  return result.rows[0];
}

export async function updateRelationship(
  id: number,
  updates: { qty?: number; notes?: string | null },
): Promise<SkuRelationshipRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.qty !== undefined) {
    sets.push(`qty = $${idx++}`);
    values.push(updates.qty);
  }
  if (updates.notes !== undefined) {
    sets.push(`notes = $${idx++}`);
    values.push(updates.notes?.trim() || null);
  }

  if (sets.length === 0) return getRelationshipById(id);
  sets.push(`updated_at = NOW()`);
  values.push(id);

  const result = await pool.query(
    `UPDATE sku_relationships SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return result.rows[0] ?? null;
}

/**
 * Hard-delete an edge. Unlike sku_catalog (soft-deleted because everything
 * joins on it), a relationship is just an edge — removing it is the intended,
 * fully reversible operation and nothing references the edge id.
 */
export async function deleteRelationship(id: number): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM sku_relationships WHERE id = $1`,
    [id],
  );
  return (result.rowCount || 0) > 0;
}
