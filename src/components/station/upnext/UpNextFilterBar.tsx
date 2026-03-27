'use client';

import { Clipboard, Search, X } from '@/components/Icons';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';

interface UpNextFilterBarProps {
  searchText: string;
  onSearchChange: (value: string) => void;
  quickFilter: string;
  onQuickFilterChange: (value: string) => void;
  quickFilterItems: HorizontalSliderItem[];
  placeholder?: string;
}

export function UpNextFilterBar({
  searchText,
  onSearchChange,
  quickFilter,
  onQuickFilterChange,
  quickFilterItems,
  placeholder = 'Search...',
}: UpNextFilterBarProps) {
  const handlePaste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) onSearchChange(text);
    } catch { /* clipboard denied */ }
  };

  return (
    <div className="flex flex-col gap-1.5">
      {quickFilterItems.length > 1 && (
        <div className="overflow-hidden px-1">
          <HorizontalButtonSlider
            items={quickFilterItems}
            value={quickFilter}
            onChange={onQuickFilterChange}
            variant="slate"
            size="md"
            aria-label="Quick filters"
          />
        </div>
      )}
      <div className="relative">
        <div className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400">
          <Search className="h-3.5 w-3.5" />
        </div>
        <input
          type="text"
          value={searchText}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={placeholder}
          className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-16 text-[12px] font-bold text-gray-900 outline-none placeholder:font-semibold placeholder:text-gray-400 focus:border-gray-300"
        />
        <button
          type="button"
          onClick={searchText ? () => onSearchChange('') : handlePaste}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          aria-label={searchText ? 'Clear search' : 'Paste from clipboard'}
        >
          {searchText
            ? <X className="h-3.5 w-3.5" />
            : <Clipboard className="h-3.5 w-3.5" />
          }
        </button>
      </div>
    </div>
  );
}
