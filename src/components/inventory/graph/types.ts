/** Shared types for the SKU relationship graph module. */

export type SkuGraphMode = 'parents' | 'children' | 'tree';

export type SkuTier = 'system' | 'assembly' | 'component';

/** A catalog node enriched with the stock figure (mirrors the API SkuGraphNode). */
export interface SkuGraphNode {
  sku_id: number;
  sku: string;
  product_title: string;
  category: string | null;
  sku_type: SkuTier | null;
  image_url: string | null;
  stock: number;
}

/** One side of a relationship as seen from a focused SKU (the "other" node). */
export interface SkuRelationshipEdgeView extends SkuGraphNode {
  relationship_id: number;
  qty: number;
  notes: string | null;
}

export interface SkuTreeEdge {
  relationship_id: number;
  parent_sku_id: number;
  child_sku_id: number;
  qty: number;
  depth: number;
}

export interface SkuTreeResult {
  root_sku_id: number;
  edges: SkuTreeEdge[];
  nodes: SkuGraphNode[];
}

/** Direction of a new edge relative to the focused SKU, used by the CRUD modal. */
export type RelationshipDirection = 'parent' | 'child';
