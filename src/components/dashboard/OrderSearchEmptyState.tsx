'use client';

import { motion } from 'framer-motion';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import {
  useMotionPresence,
  useMotionTransition,
} from '@/design-system/foundations/motion-framer-hooks';
import { Search } from '@/components/Icons';
import { sectionLabel } from '@/design-system';
import { Button } from '@/design-system/primitives';

interface OrderSearchEmptyStateProps {
  query: string;
  title?: string;
  resultLabel?: string;
  clearLabel?: string;
  onClear: () => void;
}

/**
 * Search "no-results" teaching box (Workbench empty state). A no-match is a
 * normal outcome, not an error — so this uses a neutral icon + the canonical
 * dashed teaching box, and routes entrance motion through the reduced-motion
 * hooks (never a raw spring). Reused by Unshipped + Shipped search-empty paths.
 */
export function OrderSearchEmptyState({
  query,
  title = 'Order not found',
  resultLabel = 'records',
  clearLabel = 'Show All Orders',
  onClear,
}: OrderSearchEmptyStateProps) {
  const presence = useMotionPresence(framerPresence.workbenchPane);
  const transition = useMotionTransition(framerTransition.workbenchPaneMount);

  return (
    <motion.div
      {...presence}
      transition={transition}
      className="mx-auto max-w-xs rounded-xl border border-dashed border-border-soft bg-surface-canvas px-4 py-6 text-center"
    >
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-sunken">
        <Search className="h-5 w-5 text-text-faint" />
      </div>
      <h3 className="mb-1 text-sm font-black uppercase tracking-tight text-text-default">{title}</h3>
      <p className="text-micro font-bold uppercase leading-relaxed tracking-widest text-text-muted">
        No {resultLabel} match &quot;{query}&quot;
      </p>
      <Button
        type="button"
        variant="brand"
        onClick={onClear}
        className={`mt-5 bg-none bg-surface-inverse px-6 ${sectionLabel} text-white hover:bg-surface-inverse-hover`}
      >
        {clearLabel}
      </Button>
    </motion.div>
  );
}
