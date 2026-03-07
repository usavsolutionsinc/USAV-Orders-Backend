'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SearchBar } from '@/components/ui/SearchBar';
import { FileText, ExternalLink } from '@/components/Icons';

interface ProductManual {
  id: number;
  sku: string | null;
  item_number: string | null;
  product_title: string | null;
  google_doc_id: string;
  type: string | null;
  updated_at: string | null;
}

function ManualRow({
  manual,
  isSelected,
  onSelect,
}: {
  manual: ProductManual;
  isSelected: boolean;
  onSelect: (manual: ProductManual) => void;
}) {
  const title = manual.product_title || manual.sku || manual.item_number || `Manual #${manual.id}`;
  const subtitle = [manual.sku, manual.item_number].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      onClick={() => onSelect(manual)}
      className={`w-full text-left px-3 py-2.5 rounded-2xl transition-all duration-150 group ${
        isSelected
          ? 'bg-blue-50 border border-blue-200'
          : 'hover:bg-gray-50 border border-transparent'
      }`}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <div className={`mt-0.5 flex-shrink-0 w-7 h-7 rounded-xl flex items-center justify-center ${
          isSelected ? 'bg-blue-100' : 'bg-gray-100 group-hover:bg-blue-50'
        }`}>
          <FileText className={`w-3.5 h-3.5 ${isSelected ? 'text-blue-600' : 'text-gray-400 group-hover:text-blue-500'}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-[11px] font-black tracking-tight truncate leading-tight ${
            isSelected ? 'text-blue-900' : 'text-gray-900'
          }`}>
            {title}
          </p>
          {subtitle && (
            <p className={`mt-0.5 text-[9px] font-bold uppercase tracking-wider truncate ${
              isSelected ? 'text-blue-500' : 'text-gray-400'
            }`}>
              {subtitle}
            </p>
          )}
        </div>
        {manual.google_doc_id && (
          <a
            href={`https://docs.google.com/document/d/${manual.google_doc_id}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`flex-shrink-0 mt-0.5 p-1 rounded-lg transition-colors ${
              isSelected ? 'text-blue-400 hover:text-blue-700' : 'text-gray-300 hover:text-gray-600'
            }`}
            title="Open manual"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </button>
  );
}

export function ManualsSidebar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [localSearch, setLocalSearch] = useState(searchParams.get('q') || '');
  const [manuals, setManuals] = useState<ProductManual[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(
    searchParams.get('id') ? Number(searchParams.get('id')) : null
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchManuals = async (query: string) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      params.set('limit', '60');
      const res = await fetch(`/api/product-manuals/search?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && Array.isArray(data.manuals)) {
        setManuals(data.manuals);
      }
    } catch (_error) {
      // no-op
    } finally {
      setIsLoading(false);
    }
  };

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchManuals(localSearch);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [localSearch]);

  // Sync URL search param → local state
  const urlQ = searchParams.get('q') || '';
  useEffect(() => {
    setLocalSearch(urlQ);
  }, [urlQ]);

  const handleSelect = (manual: ProductManual) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('id', String(manual.id));
    if (localSearch.trim()) params.set('q', localSearch.trim());
    else params.delete('q');
    router.replace(`/manuals?${params.toString()}`);
    setSelectedId(manual.id);
  };

  const handleSearchChange = (value: string) => {
    setLocalSearch(value);
    const params = new URLSearchParams(searchParams.toString());
    if (value.trim()) params.set('q', value.trim());
    else params.delete('q');
    router.replace(`/manuals?${params.toString()}`);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="border-b border-gray-200 bg-white px-3 py-2">
        <SearchBar
          value={localSearch}
          onChange={handleSearchChange}
          onClear={() => handleSearchChange('')}
          placeholder="Search product name..."
          variant="blue"
          isSearching={isLoading}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {isLoading && manuals.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center space-y-2">
              <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Searching…</p>
            </div>
          </div>
        ) : manuals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mb-3">
              <FileText className="w-5 h-5 text-gray-400" />
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
              {localSearch.trim() ? 'No results found' : 'No manuals yet'}
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {manuals.map((manual) => (
              <ManualRow
                key={manual.id}
                manual={manual}
                isSelected={selectedId === manual.id}
                onSelect={handleSelect}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 px-3 py-2 bg-white">
        <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-gray-400">
          {manuals.length} manual{manuals.length !== 1 ? 's' : ''}
          {localSearch.trim() ? ` for "${localSearch.trim()}"` : ' total'}
        </p>
      </div>
    </div>
  );
}
