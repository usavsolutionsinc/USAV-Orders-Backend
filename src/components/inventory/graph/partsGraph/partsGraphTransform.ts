import type { ElementDefinition } from 'cytoscape';
import { LOW_STOCK_THRESHOLD } from '../cytoscapeConfig';
import type { PartsBase, PartsLogicalPart } from './types';

/**
 * Detail-panel payload for a selected node, resolved by its numeric id.
 * The base/part split mirrors the two node tiers in the graph.
 */
export type PartsNodeMeta =
  | { kind: 'base'; base: PartsBase }
  | { kind: 'part'; part: PartsLogicalPart; base: PartsBase };

export interface PartsElementsResult {
  elements: ElementDefinition[];
  metaById: Record<number, PartsNodeMeta>;
}

/** Variant suffix without the redundant base prefix, e.g. "Part · Black · New". */
function variantLabel(part: PartsLogicalPart): string {
  return ['Part', part.colorLabel, part.conditionLabel, ...part.unknownTokens]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Build cytoscape elements for the derived parts graph. Node ids are sequential
 * integers (the shared `SkuGraphCanvas` resolves selection via `Number(id)`),
 * mapped back to their domain object through `metaById`.
 *
 * Topology: base (whole-unit, tier `system`) → logical part (tier `component`).
 * No part↔parent edges are asserted — base grouping is derived from the SKU
 * prefix only; true parent pairing is a later manual phase.
 */
export function toPartsElements(bases: PartsBase[]): PartsElementsResult {
  const elements: ElementDefinition[] = [];
  const metaById: Record<number, PartsNodeMeta> = {};
  let nextId = 1;

  for (const base of bases) {
    const baseId = nextId++;
    metaById[baseId] = { kind: 'base', base };
    elements.push({
      group: 'nodes',
      data: {
        id: String(baseId),
        label: `${base.base}\n${base.baseUnit?.name?.trim() || 'Base unit (unverified)'}`,
        sku: base.baseUnit?.sku ?? base.base,
        productTitle: base.baseUnit?.name ?? '',
        tier: 'system',
        stock: base.totalStockOnHand,
        // Base clusters are containers, not stock rows — never flag low-stock.
        lowStock: false,
        focused: 0,
      },
    });

    for (const part of base.parts) {
      const partId = nextId++;
      metaById[partId] = { kind: 'part', part, base };
      elements.push({
        group: 'nodes',
        data: {
          id: String(partId),
          label: variantLabel(part),
          sku: `${part.base} · ${variantLabel(part)}`,
          productTitle: variantLabel(part),
          tier: 'component',
          stock: part.stockOnHand,
          lowStock: part.stockOnHand <= LOW_STOCK_THRESHOLD,
          focused: 0,
          reviewState: part.reviewState,
        },
      });
      elements.push({
        group: 'edges',
        data: {
          id: `e-${baseId}-${partId}`,
          source: String(baseId),
          target: String(partId),
          qty: part.instanceCount,
        },
      });
    }
  }

  return { elements, metaById };
}
