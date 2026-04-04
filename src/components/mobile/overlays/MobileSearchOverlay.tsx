'use client';

import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Search } from '@/components/Icons';
import { SearchBar } from '@/components/ui/SearchBar';
import {
  HorizontalButtonSlider,
  type HorizontalSliderItem,
} from '@/components/ui/HorizontalButtonSlider';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MobileSearchOverlayProps {
  /** Current quick-filter pill value */
  quickFilter: string;
  onQuickFilterChange: (value: string) => void;
  /** Filter items for the current active tab — changes dynamically */
  quickFilterItems: HorizontalSliderItem[];
  quickFilterVariant?: 'fba' | 'slate';
  /** Text search value (controlled by parent) */
  searchText: string;
  onSearchChange: (value: string) => void;
  placeholder?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * MobileSearchOverlay — pills + expandable text search for the current queue list (filter only).
 *
 * Use in `MobileQueueFilterSheet` or the bottom bar `pills` slot. Not for station tracking
 * submission — that uses `StationScanBar` / scan sheet + `MobileBottomActionBar` search mode when enabled.
 *
 * Interaction: collapsed → search icon + horizontal slider pills; expanded → full-width search field.
 */
export function MobileSearchOverlay({
  quickFilter,
  onQuickFilterChange,
  quickFilterItems,
  quickFilterVariant = 'fba',
  searchText,
  onSearchChange,
  placeholder = 'Search queue...',
}: MobileSearchOverlayProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isExpanded = searchOpen || !!searchText.trim();

  const openSearch = () => {
    setSearchOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const closeSearch = () => {
    onSearchChange('');
    setSearchOpen(false);
  };

  const handleBlur = () => {
    if (!searchText.trim()) setSearchOpen(false);
  };

  return (
    <div className="flex items-center gap-2 min-h-[36px]">
      <AnimatePresence mode="wait" initial={false}>
        {isExpanded ? (
          <motion.div
            key="search-input"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: '100%' }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="flex-1 min-w-0 overflow-hidden"
            onBlur={handleBlur}
          >
            <SearchBar
              value={searchText}
              onChange={onSearchChange}
              onClear={closeSearch}
              inputRef={inputRef}
              placeholder={placeholder}
              variant="gray"
              size="compact"
              autoFocus
            />
          </motion.div>
        ) : (
          <motion.div
            key="filter-pills"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center gap-2 flex-1 min-w-0"
          >
            <button
              type="button"
              onClick={openSearch}
              className="flex-shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600 transition-colors"
              aria-label="Search queue"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
            {quickFilterItems.length > 1 && (
              <div className="flex-1 min-w-0 overflow-hidden">
                <HorizontalButtonSlider
                  items={quickFilterItems}
                  value={quickFilter}
                  onChange={onQuickFilterChange}
                  variant={quickFilterVariant}
                  size="md"
                  aria-label="Filter queue"
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
