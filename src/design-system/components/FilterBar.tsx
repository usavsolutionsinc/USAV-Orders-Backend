'use client';

import { type ReactNode, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Filter, Search, SlidersHorizontal, X } from '@/components/Icons';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { OverlaySearch } from './OverlaySearch';
import { SearchField } from '@/design-system/primitives/SearchField';

export interface FilterBarProps {
  /** Search configuration */
  search?: {
    value: string;
    onChange: (val: string) => void;
    placeholder?: string;
    /** If true, the search input expands from a button and covers other content when open */
    expandable?: boolean;
    /** If true, the search is open by default (if expandable) */
    defaultOpen?: boolean;
  };

  /** Quick filter pills (HorizontalButtonSlider) */
  pills?: {
    items: HorizontalSliderItem[];
    value: string;
    onChange: (id: string) => void;
    variant?: 'fba' | 'slate' | 'nav' | 'floating' | 'segmented';
    label?: string;
  };

  /** Advanced filters popover configuration */
  advanced?: {
    /** The content of the popover */
    render: (onClose: () => void) => ReactNode;
    /** Number of active filters to show in a badge */
    activeCount?: number;
    /** Label for the advanced filter button */
    label?: string;
    /** Stretch the trigger button to fill the row (sidebar full-width layout). */
    fullWidth?: boolean;
  };

  /** Callback to clear all filters */
  onClear?: () => void;
  /** Whether to show a clear all button if filters are active */
  showClear?: boolean;

  /** Additional elements to render on the right */
  rightSlot?: ReactNode;

  className?: string;
}

/**
 * Unified FilterBar component.
 * Consolidates search, quick filters (pills), and advanced filters (popover) into a single row.
 * Uses OverlaySearch for collapsible search on mobile or tight desktop headers.
 */
export function FilterBar({
  search,
  pills,
  advanced,
  onClear,
  showClear,
  rightSlot,
  className = '',
}: FilterBarProps) {
  const [isSearchOpen, setIsSearchOpen] = useState(search?.defaultOpen ?? false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const advancedRef = useRef<HTMLDivElement>(null);

  const hasActiveFilters = (advanced?.activeCount ?? 0) > 0 || (search?.value.trim().length ?? 0) > 0;

  const handleToggleSearch = () => {
    setIsSearchOpen((prev) => !prev);
  };

  const handleBlurSearch = () => {
    if (!search?.value.trim()) {
      setIsSearchOpen(false);
    }
  };

  const renderAdvancedTrigger = () => {
    if (!advanced) return null;
    const active = (advanced.activeCount ?? 0) > 0;
    return (
      <button
        type="button"
        onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
        className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-label font-bold transition-all active:scale-95 ${
          advanced.fullWidth ? 'w-full justify-between' : ''
        } ${
          active
            ? 'border-blue-200 bg-blue-50 text-blue-700'
            : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900'
        }`}
      >
        <span className="flex items-center gap-2">
          <Filter className="h-4 w-4" />
          {advanced.label || 'Filters'}
        </span>
        {active && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-mini font-black text-white">
            {advanced.activeCount}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className={`relative flex items-center gap-2 min-h-[40px] ${className}`}>
      {/* 1. Search (Collapsible/Expandable) */}
      {search && search.expandable ? (
        <div className="flex-1 min-w-0">
          <OverlaySearch
            isOpen={isSearchOpen}
            onToggle={handleToggleSearch}
            onBlurClose={handleBlurSearch}
            trigger={
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600 transition-colors"
                aria-label="Open search"
              >
                <Search className="h-4 w-4" />
              </button>
            }
          >
            <SearchField
              value={search.value}
              onChange={search.onChange}
              onClear={() => {
                search.onChange('');
                setIsSearchOpen(false);
              }}
              placeholder={search.placeholder || 'Search...'}
              autoFocus
              hideUnderline
              className="bg-gray-100/50 rounded-lg px-2"
            />
          </OverlaySearch>
        </div>
      ) : search ? (
        <div className="flex-1 min-w-[200px] max-w-sm">
          <SearchField
            value={search.value}
            onChange={search.onChange}
            placeholder={search.placeholder || 'Search...'}
            hideUnderline
            className="bg-gray-100/50 rounded-lg px-2"
          />
        </div>
      ) : null}

      {/* 2. Quick Filters (Pills) - Hidden when search is expanded */}
      <AnimatePresence>
        {(!isSearchOpen || (search && !search.expandable)) && pills && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            className="flex-1 min-w-0 overflow-hidden"
          >
            <HorizontalButtonSlider
              items={pills.items}
              value={pills.value}
              onChange={pills.onChange}
              variant={pills.variant || 'slate'}
              aria-label={pills.label || 'Quick filters'}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 3. Advanced Filters & Clear */}
      <div className={`flex items-center gap-2 ${advanced?.fullWidth ? 'flex-1' : 'shrink-0'}`}>
        {renderAdvancedTrigger()}
        
        {showClear && hasActiveFilters && onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-bold text-gray-400 hover:text-gray-900 transition-colors flex items-center gap-1"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}

        {rightSlot}
      </div>

      {/* Advanced Filters Popover (simplistic implementation for now) */}
      <AnimatePresence>
        {isAdvancedOpen && advanced && (
          <>
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setIsAdvancedOpen(false)} 
            />
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className={`absolute top-full z-50 mt-2 max-h-[60vh] overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-xl ring-1 ring-black/5 ${
                advanced.fullWidth ? 'left-0 right-0' : 'right-0 w-72'
              }`}
            >
              {advanced.render(() => setIsAdvancedOpen(false))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
