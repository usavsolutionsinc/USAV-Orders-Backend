'use client';

import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { framerTransition, framerPresence } from '../foundations/motion-framer';

export interface ExpandableSectionProps {
  isOpen: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Atomic expand/collapse wrapper — handles AnimatePresence + height:'auto' animation.
 * Pair with a chevron or toggle button in the parent to control `isOpen`.
 */
export function ExpandableSection({ isOpen, children, className = '' }: ExpandableSectionProps) {
  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div
          key="expandable-content"
          initial={framerPresence.sidebarSection.initial}
          animate={framerPresence.sidebarSection.animate}
          exit={framerPresence.sidebarSection.exit}
          transition={framerTransition.sidebarExpand}
          className={`overflow-hidden ${className}`.trim()}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
