'use client';

import { Pencil } from '@/components/Icons';
import { Button } from '@/design-system/primitives/Button';
import { cn } from '@/utils/_cn';
import { useSkuChildren, useSkuParents } from './useSkuGraph';
import type { SkuRelationshipEdgeView, SkuTier } from './types';

export interface DetailNode {
  sku_id: number;
  sku: string;
  product_title: string;
  tier: SkuTier;
  stock: number;
}

const TIER_BADGE: Record<SkuTier, string> = {
  system: 'bg-purple-50 text-purple-700 ring-purple-200',
  assembly: 'bg-teal-50 text-teal-700 ring-teal-200',
  component: 'bg-amber-50 text-amber-700 ring-amber-200',
};

function RelationList({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: SkuRelationshipEdgeView[];
  onSelect: (skuId: number) => void;
}) {
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        {title} ({items.length})
      </h3>
      {items.length === 0 ? (
        <p className="text-[12px] text-gray-400">None</p>
      ) : (
        <ul className="space-y-1">
          {items.map((it) => (
            <li key={it.relationship_id}>
              <button
                type="button"
                onClick={() => onSelect(it.sku_id)}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left hover:bg-gray-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium text-gray-900">{it.sku}</span>
                  <span className="block truncate text-[11px] text-gray-500">{it.product_title}</span>
                </span>
                <span className="ml-2 shrink-0 text-[11px] tabular-nums text-gray-400">
                  {it.qty > 1 ? `×${it.qty}` : ''} · {it.stock}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface SkuGraphDetailPanelProps {
  node: DetailNode | null;
  onSelectRelated: (skuId: number) => void;
  onEditConnections: () => void;
}

export function SkuGraphDetailPanel({ node, onSelectRelated, onEditConnections }: SkuGraphDetailPanelProps) {
  const { data: parents = [] } = useSkuParents(node?.sku_id ?? null);
  const { data: children = [] } = useSkuChildren(node?.sku_id ?? null);

  if (!node) {
    return (
      <aside className="flex w-80 shrink-0 items-center justify-center border-l border-gray-200 bg-white p-6 text-center">
        <p className="text-[12px] text-gray-400">Select a node to inspect its stock and relationships.</p>
      </aside>
    );
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-gray-200 bg-white p-4">
      <div>
        <div className="flex items-center gap-2">
          <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1', TIER_BADGE[node.tier])}>
            {node.tier}
          </span>
        </div>
        <h2 className="mt-1.5 text-[15px] font-bold text-gray-900">{node.sku}</h2>
        <p className="text-[12px] text-gray-500">{node.product_title}</p>
      </div>

      <div className="rounded-xl bg-gray-50 p-3">
        <div className="text-[11px] uppercase tracking-wide text-gray-400">In stock</div>
        <div className="text-2xl font-bold tabular-nums text-gray-900">{node.stock}</div>
      </div>

      <RelationList title="Parents" items={parents} onSelect={onSelectRelated} />
      <RelationList title="Children" items={children} onSelect={onSelectRelated} />

      <div className="mt-auto pt-2">
        <Button size="sm" variant="secondary" icon={<Pencil />} onClick={onEditConnections} className="w-full">
          Edit Connections
        </Button>
      </div>
    </aside>
  );
}
