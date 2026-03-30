'use client';

import { type FormEvent, type ReactNode, type Ref, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Camera, Loader2 } from '@/components/Icons';
import {
  framerPresenceMobile,
  framerTransitionMobile,
} from '../../foundations/motion-framer';
import { useKeyboard } from '@/hooks/useKeyboard';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MobileBottomActionBarProps {
  // ── Search ──
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: (e?: FormEvent) => void;
  searchPlaceholder?: string;
  searchExpanded: boolean;
  onSearchExpandedChange: (expanded: boolean) => void;
  searchInputRef?: Ref<HTMLInputElement>;
  /** Leading icon inside expanded search (e.g., mode badge). */
  searchIcon?: ReactNode;

  // ── Scan FAB ──
  onScanPress: () => void;
  scanTone?: 'primary' | 'success' | 'danger';

  // ── Optional pill row above buttons ──
  pills?: ReactNode;

  // ── State ──
  isLoading?: boolean;
  themeColor?: string;
}

// ─── Scan FAB tone classes ──────────────────────────────────────────────────

const scanToneClasses = {
  primary: 'bg-blue-600 text-white shadow-lg shadow-blue-600/25 active:bg-blue-700',
  success: 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/25 active:bg-emerald-700',
  danger: 'bg-red-600 text-white shadow-lg shadow-red-600/25 active:bg-red-700',
} as const;

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * MobileBottomActionBar — two-FAB bottom bar with expandable search.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────┐
 *   │  (optional pills row)                        │
 *   │  [🔍]                                  [⎊]  │  ← collapsed
 *   │  [✕] [═══════ Search ═══════]          [⎊]  │  ← expanded
 *   │  ─── safe-area-bottom ──────────────────     │
 *   └──────────────────────────────────────────────┘
 *
 * Sits in MobileShell.bottomDock. The scan FAB (right) is always visible.
 */
export function MobileBottomActionBar({
  searchValue,
  onSearchChange,
  onSearchSubmit,
  searchPlaceholder = 'Search or type…',
  searchExpanded,
  onSearchExpandedChange,
  searchInputRef,
  searchIcon,
  onScanPress,
  scanTone = 'primary',
  pills,
  isLoading = false,
  themeColor = 'blue',
}: MobileBottomActionBarProps) {
  const internalInputRef = useRef<HTMLInputElement>(null);
  useKeyboard({ centerOnFocus: true });

  const handleExpand = useCallback(() => {
    onSearchExpandedChange(true);
    // Focus after the spring animation begins
    requestAnimationFrame(() => {
      const ref = internalInputRef.current;
      if (ref) ref.focus();
    });
  }, [onSearchExpandedChange]);

  const handleCollapse = useCallback(() => {
    onSearchExpandedChange(false);
  }, [onSearchExpandedChange]);

  const handleSubmit = useCallback(
    (e?: FormEvent<HTMLFormElement>) => {
      e?.preventDefault();
      onSearchSubmit(e);
    },
    [onSearchSubmit],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') handleCollapse();
    },
    [handleCollapse],
  );

  // Merge refs
  const setInputRef = useCallback(
    (node: HTMLInputElement | null) => {
      (internalInputRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
      if (!searchInputRef) return;
      if (typeof searchInputRef === 'function') searchInputRef(node);
      else (searchInputRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
    },
    [searchInputRef],
  );

  return (
    <div className="bg-white px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {/* ── Optional pills row ── */}
      {pills && <div className="mb-2">{pills}</div>}

      {/* ── Action row ── */}
      <div className="flex items-center gap-3">
        {/* ── Left: Search FAB / Close + Input ── */}
        <div className="flex flex-1 items-center gap-2 min-w-0">
          <AnimatePresence mode="wait" initial={false}>
            {searchExpanded ? (
              <motion.div
                key="search-expanded"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex flex-1 items-center gap-2 min-w-0"
              >
                {/* Close button */}
                <button
                  type="button"
                  onClick={handleCollapse}
                  aria-label="Close search"
                  className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600 active:bg-gray-200 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>

                {/* Search input */}
                <form onSubmit={handleSubmit} className="flex-1 min-w-0">
                  <div className="relative">
                    {searchIcon && (
                      <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
                        {searchIcon}
                      </div>
                    )}
                    <input
                      ref={setInputRef}
                      type="text"
                      value={searchValue}
                      onChange={(e) => onSearchChange(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={searchPlaceholder}
                      autoFocus
                      className={`
                        w-full h-12 rounded-2xl bg-gray-50 text-sm font-bold text-gray-900
                        outline-none transition-all border border-gray-200
                        placeholder:font-medium placeholder:text-gray-400
                        focus:border-${themeColor}-500 focus:ring-4 focus:ring-${themeColor}-500/10
                        ${searchIcon ? 'pl-11' : 'pl-4'} pr-4
                      `.trim()}
                    />
                    {isLoading && (
                      <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                      </div>
                    )}
                  </div>
                </form>
              </motion.div>
            ) : (
              <motion.button
                key="search-fab"
                type="button"
                onClick={handleExpand}
                aria-label="Open search"
                initial={framerPresenceMobile.fab.initial}
                animate={framerPresenceMobile.fab.animate}
                exit={framerPresenceMobile.fab.exit}
                transition={framerTransitionMobile.fabMount}
                whileTap={{ scale: 0.92 }}
                className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-700 shadow-sm active:bg-gray-200 transition-colors"
              >
                <Search className="h-6 w-6" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* ── Right: Scan FAB (always visible) ── */}
        <motion.button
          type="button"
          onClick={onScanPress}
          aria-label="Open camera scanner"
          whileTap={{ scale: 0.92 }}
          className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full ${scanToneClasses[scanTone]} transition-colors`}
        >
          <Camera className="h-6 w-6" />
        </motion.button>
      </div>
    </div>
  );
}
