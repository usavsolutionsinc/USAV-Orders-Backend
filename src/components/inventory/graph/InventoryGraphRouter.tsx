'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/utils/_cn';
import { SkuGraphWorkspace } from './SkuGraphWorkspace';
import { PartsGraphWorkspace } from './partsGraph/PartsGraphWorkspace';

/**
 * Top-level router for `/inventory/graph`. `?view=parts` renders the derived
 * (Zoho-items, `-P`-classified) parts overview; any other value renders the
 * existing sku_catalog relationship graph. The two surfaces are kept fully
 * separate — `items` and `sku_catalog` are independent SKU schemes.
 */
export function InventoryGraphRouter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isParts = searchParams.get('view') === 'parts';

  const switchTo = useCallback(
    (target: 'parts' | 'relationships') => {
      const sp = new URLSearchParams(searchParams.toString());
      if (target === 'parts') sp.set('view', 'parts');
      // Relationships graph owns parents/children/tree; default it to children.
      else sp.set('view', 'children');
      router.replace(`/inventory/graph?${sp.toString()}`);
    },
    [router, searchParams],
  );

  const TABS: Array<{ id: 'parts' | 'relationships'; label: string; active: boolean }> = [
    { id: 'parts', label: 'Parts (Zoho)', active: isParts },
    { id: 'relationships', label: 'Relationships', active: !isParts },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-2">
        <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => switchTo(t.id)}
              className={cn(
                'ds-raw-button rounded-lg px-3 py-1.5 text-label font-medium transition-colors',
                t.active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {isParts ? <PartsGraphWorkspace /> : <SkuGraphWorkspace />}
      </div>
    </div>
  );
}
