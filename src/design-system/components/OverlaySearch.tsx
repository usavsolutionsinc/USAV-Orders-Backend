'use client';

import { useRef, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface OverlaySearchProps {
  /** Whether the search input is visible */
  isOpen: boolean;
  /** Toggle callback */
  onToggle: () => void;
  /** The trigger element shown when search is closed (e.g. a search icon button) */
  trigger: ReactNode;
  /** The search input element shown when open */
  children: ReactNode;
  /** Close callback when the input blurs and is empty */
  onBlurClose?: () => void;
  className?: string;
  /**
   * Optional slot rendered above `children` when the search is open.
   * Compose a HorizontalButtonSlider here for contextual mode switching.
   * Hidden automatically when search is closed — mode only changes on button click.
   */
  sliderSlot?: ReactNode;
}

/**
 * Animated toggle between a trigger element and a search input.
 * Use for inline search bars that expand on click and collapse on blur-when-empty.
 *
 * Pass `sliderSlot` to show a HorizontalButtonSlider above the input when open.
 * Uses: framerTransition.overlaySearchIn
 */
export function OverlaySearch({
  isOpen,
  onToggle,
  trigger,
  children,
  onBlurClose,
  className = '',
  sliderSlot,
}: OverlaySearchProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleBlur = () => {
    if (onBlurClose) {
      requestAnimationFrame(() => {
        if (containerRef.current && !containerRef.current.contains(document.activeElement)) {
          onBlurClose();
        }
      });
    }
  };

  return (
    <div ref={containerRef} className={`min-h-[36px] ${className}`.trim()} onBlur={handleBlur}>
      <AnimatePresence initial={false}>
        {!isOpen ? (
          <motion.div
            key="search-trigger"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            onClick={onToggle}
          >
            {trigger}
          </motion.div>
        ) : null}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {isOpen ? (
          <motion.div
            key="search-open"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col gap-2"
          >
            {sliderSlot ?? null}
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
