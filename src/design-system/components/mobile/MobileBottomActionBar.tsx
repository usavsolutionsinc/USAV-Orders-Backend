'use client';

import { type FormEvent, type ReactNode, type Ref, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Camera, Loader2, SlidersHorizontal } from '@/components/Icons';
import {
  framerPresenceMobile,
  framerTransitionMobile,
} from '../../foundations/motion-framer';
import { useKeyboard } from '@/hooks/useKeyboard';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ActionBarMode = 'idle' | 'search' | 'filter';

export interface MobileBottomActionBarProps {
  mode?: ActionBarMode;
  onModeChange?: (mode: ActionBarMode) => void;

  // ── Search ──
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: (e?: FormEvent) => void;
  searchExpanded?: boolean;
  onSearchExpandedChange?: (expanded: boolean) => void;
  searchPlaceholder?: string;
  searchInputRef?: Ref<HTMLInputElement>;
  searchIcon?: ReactNode;

  // ── Filter (Slider) ──
  filterContent?: ReactNode;
  pills?: ReactNode;

  // ── Scan FAB ──
  onScanPress: () => void;
  scanTone?: 'primary' | 'success' | 'danger';

  /**
   * When set, the left Search button calls this instead of expanding the tracking / scan text field
   * (e.g. open a queue filter sheet — not the same as desktop `StationScanBar` entry).
   */
  onQueueFilterPress?: () => void;

  /** When false, hides the sliders button to the right of Search (queue filters live in the sheet). */
  showInlineFilterButton?: boolean;

  // ── State ──
  isLoading?: boolean;
  themeColor?: string;

  /**
   * `solid` — full-width white dock strip (default). `ghost` — no bar; only the circular controls
   * (use with `MobileShell` `bottomDockVariant="overlay"`).
   */
  chrome?: 'solid' | 'ghost';
}

const scanToneClasses = {
  primary: 'bg-blue-600 text-white shadow-lg shadow-blue-600/25 active:bg-blue-700',
  success: 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/25 active:bg-emerald-700',
  danger: 'bg-red-600 text-white shadow-lg shadow-red-600/25 active:bg-red-700',
} as const;

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * MobileBottomActionBar — extensible bottom dock shell.
 * Supports horizontal expansion into Search or Filter (Slider) modes.
 */
export function MobileBottomActionBar({
  mode,
  onModeChange,
  searchValue,
  onSearchChange,
  onSearchSubmit,
  searchExpanded,
  onSearchExpandedChange,
  searchPlaceholder = 'Search...',
  searchInputRef,
  searchIcon,
  filterContent,
  pills,
  onScanPress,
  scanTone = 'primary',
  isLoading = false,
  themeColor = 'blue',
  chrome = 'solid',
  onQueueFilterPress,
  showInlineFilterButton = true,
}: MobileBottomActionBarProps) {
  const internalInputRef = useRef<HTMLInputElement>(null);
  useKeyboard({ centerOnFocus: true });

  const controlledMode = mode ?? (searchExpanded ? 'search' : 'idle');
  const resolvedFilterContent = filterContent ?? pills ?? null;

  const handleSetMode = useCallback((next: ActionBarMode) => {
    onModeChange?.(next);
    onSearchExpandedChange?.(next === 'search');
    if (next === 'search') {
      requestAnimationFrame(() => internalInputRef.current?.focus());
    }
  }, [onModeChange, onSearchExpandedChange]);

  // Merge refs for search input
  const setInputRef = useCallback(
    (node: HTMLInputElement | null) => {
      (internalInputRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
      if (!searchInputRef) return;
      if (typeof searchInputRef === 'function') searchInputRef(node);
      else (searchInputRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
    },
    [searchInputRef],
  );

  const dockChromeClass =
    chrome === 'ghost'
      ? 'px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]'
      : 'bg-white border-t border-gray-100 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.03)]';

  return (
    <div className={dockChromeClass}>
      <div className="flex items-center gap-3 h-14">
        
        {/* ── Left/Center Expansion Zone ── */}
        <div className="flex flex-1 items-center gap-2 min-w-0 h-full">
          <AnimatePresence mode="wait" initial={false}>
            {controlledMode === 'search' ? (
              <motion.div
                key="search-mode"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-1 items-center gap-2 min-w-0"
              >
                <button
                  type="button"
                  onClick={() => handleSetMode('idle')}
                  className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600 active:scale-90 transition-all"
                >
                  <X className="h-5 w-5" />
                </button>
                <form onSubmit={(e) => { e.preventDefault(); onSearchSubmit(e); }} className="flex-1 min-w-0">
                  <div className="relative">
                    {searchIcon && <div className="absolute left-3.5 top-1/2 -translate-y-1/2">{searchIcon}</div>}
                    <input
                      ref={setInputRef}
                      type="text"
                      value={searchValue}
                      onChange={(e) => onSearchChange(e.target.value)}
                      placeholder={searchPlaceholder}
                      className={`w-full h-12 rounded-2xl bg-gray-50 text-sm font-bold text-gray-900 border border-gray-200 outline-none focus:ring-4 focus:ring-${themeColor}-500/10 ${searchIcon ? 'pl-11' : 'pl-4'} pr-4`}
                    />
                    {isLoading && <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-gray-400" />}
                  </div>
                </form>
              </motion.div>
            ) : controlledMode === 'filter' ? (
              <motion.div
                key="filter-mode"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.2 }}
                className="flex flex-1 items-center gap-2 min-w-0 h-full"
              >
                <button
                  type="button"
                  onClick={() => handleSetMode('idle')}
                  className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-gray-900 text-white active:scale-90 transition-all"
                >
                  <SlidersHorizontal className="h-5 w-5" />
                </button>
                <div className="flex-1 min-w-0">
                  {resolvedFilterContent}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="idle-mode"
                {...framerPresenceMobile.fab}
                className="flex items-center gap-3"
              >
                <button
                  type="button"
                  onClick={() => {
                    if (onQueueFilterPress) {
                      onQueueFilterPress();
                      return;
                    }
                    handleSetMode('search');
                  }}
                  aria-label={onQueueFilterPress ? 'Filter list' : 'Search'}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-700 shadow-sm active:bg-gray-200 transition-colors"
                >
                  <Search className="h-6 w-6" />
                </button>
                {showInlineFilterButton ? (
                  <button
                    type="button"
                    onClick={() => handleSetMode('filter')}
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-700 shadow-sm active:bg-gray-200 transition-colors"
                    aria-label="Quick filters"
                  >
                    <SlidersHorizontal className="h-6 w-6" />
                  </button>
                ) : null}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Right: Persistent Scan FAB ── */}
        <motion.button
          type="button"
          onClick={onScanPress}
          whileTap={{ scale: 0.92 }}
          className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full ${scanToneClasses[scanTone]} transition-colors`}
        >
          <Camera className="h-6 w-6" />
        </motion.button>
      </div>
    </div>
  );
}
