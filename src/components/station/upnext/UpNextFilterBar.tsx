'use client';

import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search } from '@/components/Icons';
import { SearchBar } from '@/components/ui/SearchBar';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';

interface UpNextFilterBarProps {
  searchText: string;
  onSearchChange: (value: string) => void;
  quickFilter: string;
  onQuickFilterChange: (value: string) => void;
  quickFilterItems: HorizontalSliderItem[];
  quickFilterVariant?: 'fba' | 'slate';
  placeholder?: string;
}

export function UpNextFilterBar({
  searchText,
  onSearchChange,
  quickFilter,
  onQuickFilterChange,
  quickFilterItems,
  quickFilterVariant = 'slate',
  placeholder = 'Search...',
}: UpNextFilterBarProps) {
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
    if (!searchText.trim()) {
      setSearchOpen(false);
    }
  };

  return (
    <div className="flex items-center gap-2 min-h-[36px]">
      <AnimatePresence mode="wait" initial={false}>
        {isExpanded ? (
          <motion.div
            key="search"
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
            key="pills"
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
              aria-label="Open search"
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
                  aria-label="Quick filters"
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
