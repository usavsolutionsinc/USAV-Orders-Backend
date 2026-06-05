'use client';

import { useState } from 'react';
import { Plus, Search } from '@/components/Icons';
import { Button } from '@/design-system/primitives/Button';
import { cn } from '@/utils/_cn';
import { useSkuCatalogSearch, type SkuCatalogItem } from '@/hooks/useSkuCatalogSearch';
import type { SkuGraphMode } from './types';

const MODES: Array<{ id: SkuGraphMode; label: string }> = [
  { id: 'parents', label: 'Item → Parents' },
  { id: 'children', label: 'Item → Children' },
  { id: 'tree', label: 'Full Tree' },
];

interface SkuGraphToolbarProps {
  mode: SkuGraphMode;
  onModeChange: (mode: SkuGraphMode) => void;
  focusedLabel: string | null;
  onFocusSku: (item: SkuCatalogItem) => void;
  onAddConnection: () => void;
  canAdd: boolean;
}

export function SkuGraphToolbar({
  mode,
  onModeChange,
  focusedLabel,
  onFocusSku,
  onAddConnection,
  canAdd,
}: SkuGraphToolbarProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const { data: results = [] } = useSkuCatalogSearch(open ? query : '', { limit: 12 });

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
      {/* Search */}
      <div className="relative w-64">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={focusedLabel ? focusedLabel : 'Search SKU…'}
          className="h-9 w-full rounded-xl border border-gray-200 bg-gray-50 pl-8 pr-3 text-[13px] outline-none focus:border-blue-400 focus:bg-white"
        />
        {open && query.trim().length > 0 && results.length > 0 && (
          <ul className="absolute z-20 mt-1 max-h-72 w-80 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
            {results.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onFocusSku(item);
                    setQuery('');
                    setOpen(false);
                  }}
                  className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-gray-50"
                >
                  <span className="text-[13px] font-semibold text-gray-900">{item.sku}</span>
                  <span className="line-clamp-1 text-[11px] text-gray-500">{item.product_title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Mode toggle */}
      <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-0.5">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onModeChange(m.id)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors',
              mode === m.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="ml-auto">
        <Button size="sm" variant="primary" icon={<Plus />} onClick={onAddConnection} disabled={!canAdd}>
          Add Connection
        </Button>
      </div>
    </div>
  );
}
