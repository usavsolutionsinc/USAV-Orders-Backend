'use client';

import { useRef, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { framerTransition } from '../foundations/motion-framer';

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
}

/**
 * Animated toggle between a trigger element and a search input.
 * Use for inline search bars that expand on click and collapse on blur-when-empty.
 *
 * Uses: framerTransition.overlaySearchIn
 */
export function OverlaySearch({
  isOpen,
  onToggle,
  trigger,
  children,
  onBlurClose,
  className = '',
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
      <AnimatePresence mode="wait" initial={false}>
        {isOpen ? (
          <motion.div
            key="search-input"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: '100%' }}
            exit={{ opacity: 0, width: 0 }}
            transition={framerTransition.overlaySearchIn}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        ) : (
          <motion.div
            key="search-trigger"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onToggle}
          >
            {trigger}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
