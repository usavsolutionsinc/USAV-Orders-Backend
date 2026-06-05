import type { ElementDefinition } from 'cytoscape';
import { LOW_STOCK_THRESHOLD } from './cytoscapeConfig';
import type {
  SkuGraphMode,
  SkuGraphNode,
  SkuRelationshipEdgeView,
  SkuTier,
  SkuTreeResult,
} from './types';

/** Minimal info about the focused SKU (from the search selection). */
export interface FocusedSku {
  sku_id: number;
  sku: string;
  product_title: string;
  sku_type?: SkuTier | null;
  stock?: number;
}

function tierFor(node: { sku_type?: SkuTier | null }, fallback: SkuTier): SkuTier {
  return node.sku_type ?? fallback;
}

function nodeElement(
  node: SkuGraphNode | FocusedSku,
  opts: { focused?: boolean; tier: SkuTier },
): ElementDefinition {
  const stock = 'stock' in node && typeof node.stock === 'number' ? node.stock : 0;
  return {
    group: 'nodes',
    data: {
      id: String(node.sku_id),
      label: `${node.sku}\n${node.product_title}`,
      sku: node.sku,
      productTitle: node.product_title,
      tier: opts.tier,
      stock,
      lowStock: stock <= LOW_STOCK_THRESHOLD,
      focused: opts.focused ? 1 : 0,
    },
  };
}

function edgeElement(
  relationshipId: number,
  source: number,
  target: number,
  qty: number,
): ElementDefinition {
  return {
    group: 'edges',
    data: {
      id: `rel-${relationshipId}`,
      relationshipId,
      source: String(source),
      target: String(target),
      qty,
    },
  };
}

/**
 * Build cytoscape elements for the active mode. Edges are always directed
 * parent → child.
 *
 * - parents:  others are parents, edges other → focused
 * - children: others are children, edges focused → other
 * - tree:     full node/edge set from the recursive API result
 */
export function toElements(
  focused: FocusedSku,
  mode: SkuGraphMode,
  data: SkuRelationshipEdgeView[] | SkuTreeResult | undefined,
): ElementDefinition[] {
  if (!data) return [nodeElement(focused, { focused: true, tier: tierFor(focused, 'assembly') })];

  if (mode === 'tree') {
    const tree = data as SkuTreeResult;
    const childIds = new Set(tree.edges.map((e) => e.child_sku_id));
    const elements: ElementDefinition[] = tree.nodes.map((n) => {
      const isRoot = n.sku_id === tree.root_sku_id;
      const isLeaf = !tree.edges.some((e) => e.parent_sku_id === n.sku_id);
      const fallback: SkuTier = isRoot ? 'system' : isLeaf && childIds.has(n.sku_id) ? 'component' : 'assembly';
      return nodeElement(n, { focused: isRoot, tier: tierFor(n, fallback) });
    });
    for (const e of tree.edges) {
      elements.push(edgeElement(e.relationship_id, e.parent_sku_id, e.child_sku_id, e.qty));
    }
    return elements;
  }

  const others = data as SkuRelationshipEdgeView[];
  const focusedTier: SkuTier = tierFor(focused, mode === 'children' ? 'assembly' : 'component');
  const elements: ElementDefinition[] = [
    nodeElement(focused, { focused: true, tier: focusedTier }),
  ];

  for (const o of others) {
    const tier = tierFor(o, mode === 'parents' ? 'system' : 'component');
    elements.push(nodeElement(o, { tier }));
    if (mode === 'parents') {
      elements.push(edgeElement(o.relationship_id, o.sku_id, focused.sku_id, o.qty));
    } else {
      elements.push(edgeElement(o.relationship_id, focused.sku_id, o.sku_id, o.qty));
    }
  }
  return elements;
}
