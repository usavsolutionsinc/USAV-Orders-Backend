'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ElementDefinition } from 'cytoscape';
import { useSkuCatalogSearch, type SkuCatalogItem } from '@/hooks/useSkuCatalogSearch';
import { SkuGraphToolbar } from './SkuGraphToolbar';
import { SkuGraphCanvas } from './SkuGraphCanvas';
import { SkuGraphDetailPanel, type DetailNode } from './SkuGraphDetailPanel';
import { SkuGraphCrudModal } from './SkuGraphCrudModal';
import { useSkuGraphData } from './useSkuGraph';
import { toElements, type FocusedSku } from './graphTransform';
import type { SkuGraphMode, SkuTier } from './types';

const MODES: SkuGraphMode[] = ['parents', 'children', 'tree'];

interface FocusedItem {
  id: number;
  sku: string;
  product_title: string;
}

export function SkuGraphWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlSku = searchParams.get('sku');
  // `view` (not `mode`) — `mode` is reserved by the inventory sidebar's mode rail.
  const urlMode = (searchParams.get('view') as SkuGraphMode) || 'children';
  const mode = MODES.includes(urlMode) ? urlMode : 'children';

  const [focused, setFocused] = useState<FocusedItem | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Resolve a shared link's `?sku=<code>` to a catalog row when we don't yet
  // hold the focused item in state (e.g. fresh navigation).
  const needsResolve = !!urlSku && focused?.sku !== urlSku;
  const { data: resolved = [] } = useSkuCatalogSearch(needsResolve ? urlSku : '', { limit: 5 });
  useEffect(() => {
    if (!needsResolve) return;
    const exact = resolved.find((r) => r.sku === urlSku);
    if (exact) setFocused({ id: exact.id, sku: exact.sku, product_title: exact.product_title });
  }, [needsResolve, resolved, urlSku]);

  // Default the detail selection to the focused node.
  useEffect(() => {
    if (focused) setSelectedId((prev) => prev ?? focused.id);
  }, [focused]);

  const writeUrl = useCallback(
    (next: { sku?: string; view?: SkuGraphMode }) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (next.sku !== undefined) sp.set('sku', next.sku);
      if (next.view !== undefined) sp.set('view', next.view);
      router.replace(`/inventory/graph?${sp.toString()}`);
    },
    [router, searchParams],
  );

  const onFocusSku = useCallback(
    (item: Pick<SkuCatalogItem, 'id' | 'sku' | 'product_title'>) => {
      setFocused({ id: item.id, sku: item.sku, product_title: item.product_title });
      setSelectedId(item.id);
      writeUrl({ sku: item.sku });
    },
    [writeUrl],
  );

  const { data, isLoading } = useSkuGraphData(focused?.id ?? null, mode);

  const focusedSku: FocusedSku | null = focused
    ? { sku_id: focused.id, sku: focused.sku, product_title: focused.product_title }
    : null;

  const elements: ElementDefinition[] = useMemo(
    () => (focusedSku ? toElements(focusedSku, mode, data as any) : []),
    [focusedSku, mode, data],
  );

  // Look up a node's display data from the rendered elements for the detail panel.
  const detailNode: DetailNode | null = useMemo(() => {
    if (selectedId == null) return null;
    const el = elements.find((e) => e.group === 'nodes' && e.data.id === String(selectedId));
    if (!el) return null;
    return {
      sku_id: selectedId,
      sku: el.data.sku as string,
      product_title: el.data.productTitle as string,
      tier: (el.data.tier as SkuTier) ?? 'component',
      stock: (el.data.stock as number) ?? 0,
    };
  }, [elements, selectedId]);

  const onNodeRecenter = useCallback(
    (skuId: number) => {
      const el = elements.find((e) => e.group === 'nodes' && e.data.id === String(skuId));
      if (!el) return;
      onFocusSku({ id: skuId, sku: el.data.sku as string, product_title: el.data.productTitle as string });
    },
    [elements, onFocusSku],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-50">
      <SkuGraphToolbar
        mode={mode}
        onModeChange={(m) => writeUrl({ view: m })}
        focusedLabel={focused ? `${focused.sku}` : null}
        onAddConnection={() => setModalOpen(true)}
        canAdd={!!focused}
      />

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {!focused ? (
            <div className="flex h-full items-center justify-center text-center">
              <p className="max-w-xs text-[13px] text-gray-400">
                Search for a SKU in the sidebar to explore its parents, children, or full BOM tree.
              </p>
            </div>
          ) : (
            <>
              <SkuGraphCanvas
                elements={elements}
                mode={mode}
                selectedId={selectedId != null ? String(selectedId) : null}
                onNodeSelect={setSelectedId}
                onNodeRecenter={onNodeRecenter}
              />
              {isLoading && (
                <div className="pointer-events-none absolute right-3 top-3 rounded-md bg-white/90 px-2 py-1 text-[11px] text-gray-400 shadow-sm">
                  Loading…
                </div>
              )}
            </>
          )}
        </div>

        <SkuGraphDetailPanel
          node={detailNode}
          onSelectRelated={onNodeRecenter}
          onEditConnections={() => setModalOpen(true)}
        />
      </div>

      {modalOpen && focused && (
        <SkuGraphCrudModal
          focused={{ sku_id: focused.id, sku: focused.sku, product_title: focused.product_title }}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
