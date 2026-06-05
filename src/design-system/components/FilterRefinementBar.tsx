'use client';

import { useState, useRef, useEffect, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Filter, X, ChevronDown } from '@/components/Icons';

export interface FilterRefinement {
  id: string;
  label: string;
  onRemove: () => void;
}

export interface FilterRefinementBarProps {
  /** Primary label shown on the bar (e.g., "Filters", "Shipment Filters") */
  label?: string;
  /** List of active refinements to show as pills below the bar */
  refinements?: FilterRefinement[];
  /** Optional count override for the badge (defaults to refinements.length) */
  activeCount?: number;
  /** Render function for the dropdown content */
  renderDropdown: (onClose: () => void) => ReactNode;
  /** Callback to clear all active filters */
  onClearAll?: () => void;
  /** Whether to use the compact sidebar styling (40px height, flush borders) */
  variant?: 'default' | 'sidebar';
  /**
   * Dim/blur the page behind the open popover. Defaults to false — the overlay
   * stays a transparent click-catcher so the rest of the page isn't grayed out.
   */
  dimBackdrop?: boolean;
  /** Additional styling for the container */
  className?: string;
  /** Additional styling for the trigger bar */
  barClassName?: string;
}

/**
 * FilterRefinementBar
 * 
 * A specialized 2026-standard filter component.
 * - Glassmorphic dropdown with backdrop-blur.
 * - Spring-driven interactions (scale/motion).
 * - "Plain" active refinements surfaced below the trigger.
 */
export function FilterRefinementBar({
  label = 'Filters',
  refinements = [],
  activeCount,
  renderDropdown,
  onClearAll,
  variant = 'default',
  dimBackdrop = false,
  className = '',
  barClassName = '',
}: FilterRefinementBarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const count = activeCount ?? refinements.length;
  const hasActive = count > 0;
  const isSidebar = variant === 'sidebar';

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  const triggerClasses = isSidebar
    ? `flex h-[40px] w-full items-center gap-2.5 bg-white px-3 transition-colors hover:bg-gray-50 ${
        isOpen || hasActive ? 'text-blue-600' : 'text-gray-500'
      }`
    : `flex w-full items-center gap-3 rounded-2xl border px-5 py-3 text-[13px] font-bold tracking-tight transition-all ${
        isOpen
          ? 'border-blue-500/50 bg-white shadow-[0_0_20px_rgba(59,130,246,0.12)] ring-1 ring-blue-500/20'
          : hasActive
          ? 'border-blue-200 bg-blue-50/50 text-blue-700 hover:border-blue-300 hover:bg-blue-50'
          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50 shadow-sm'
      }`;

  return (
    <div ref={containerRef} className={`relative ${isSidebar ? '' : 'space-y-4'} ${className}`}>
      {/* ── Trigger Bar ────────────────────────────────────────────── */}
      <motion.button
        type="button"
        whileTap={{ scale: isSidebar ? 1 : 0.985 }}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className={`${triggerClasses} ${barClassName}`}
      >
        <div className={isSidebar ? 'shrink-0' : `flex h-6 w-6 items-center justify-center rounded-lg transition-colors ${
          isOpen || hasActive ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'
        }`}>
          <Filter className={isSidebar ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
        </div>
        
        <span className={`flex-1 text-left ${isSidebar ? 'text-micro font-black uppercase tracking-wider' : 'font-black uppercase tracking-wider text-[11px]'}`}>
          {label}
        </span>

        {hasActive && (
          <motion.span 
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`flex items-center justify-center rounded-full bg-blue-600 font-black text-white shadow-sm shadow-blue-600/20 ${
              isSidebar ? 'h-4 min-w-[16px] px-1 text-[9px]' : 'h-5 min-w-[20px] px-1.5 text-[10px]'
            }`}
          >
            {count}
          </motion.span>
        )}

        <ChevronDown 
          className={`shrink-0 transition-transform duration-300 ease-[0.22,1,0.36,1] ${
            isSidebar ? 'h-3.5 w-3.5' : 'h-4 w-4'
          } ${isOpen ? 'rotate-180 text-blue-600' : 'text-gray-400'}`} 
        />
      </motion.button>

      {/* ── Dropdown Popover (Glassmorphic) ─────────────────────────── */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              // Transparent click-catcher by default: it isolates the dismiss
              // click (so an outside click closes the popover without also
              // triggering whatever sits underneath) but does NOT gray out the
              // page. Opt into the old dim/blur via `dimBackdrop`.
              className={`fixed inset-0 z-40 ${dimBackdrop ? 'bg-black/5 backdrop-blur-[2px]' : ''}`}
              onClick={() => setIsOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }}
              className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-3xl border border-white/40 bg-white/80 p-1 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.18)] backdrop-blur-xl ring-1 ring-black/[0.08]"
            >
              <div className="max-h-[70vh] overflow-y-auto px-5 py-6">
                {renderDropdown(() => setIsOpen(false))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Active Refinement Pills (Clean) ────────────────────────── */}
      <AnimatePresence mode="popLayout">
        {refinements.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="flex flex-wrap items-center gap-2 px-1"
          >
            {refinements.map((ref) => (
              <motion.button
                layout
                key={ref.id}
                type="button"
                onClick={ref.onRemove}
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="group inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-1.5 text-[12px] font-bold text-gray-900 shadow-sm ring-1 ring-gray-200 transition-all hover:ring-blue-300"
              >
                <span className="text-blue-600/60 transition-colors group-hover:text-blue-600">#</span>
                {ref.label}
                <X className="h-3 w-3 text-gray-300 transition-colors group-hover:text-gray-900" />
              </motion.button>
            ))}

            {onClearAll && (
              <motion.button
                layout
                type="button"
                onClick={onClearAll}
                className="ml-1 text-[11px] font-black uppercase tracking-widest text-gray-400 hover:text-red-500 transition-colors"
              >
                Clear all
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
