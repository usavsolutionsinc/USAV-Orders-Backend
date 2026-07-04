'use client';

import { motion } from 'framer-motion';
import { motionBezier } from '@/design-system/foundations/motion-framer';
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

export function OrderSearchEmptyState({
  query,
  title = 'Order not found',
  resultLabel = 'records',
  clearLabel = 'Show All Orders',
  onClear,
}: OrderSearchEmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.3, ease: motionBezier.easeOut }}
      className="max-w-xs mx-auto text-center"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1, duration: 0.4, type: 'spring', stiffness: 300, damping: 20 }}
        className="h-16 w-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4"
      >
        <Search className="h-8 w-8 text-red-400" />
      </motion.div>
      <h3 className="text-lg font-black text-text-default uppercase tracking-tight mb-1">{title}</h3>
      <p className="text-xs text-text-soft font-bold uppercase tracking-widest leading-relaxed">
        No {resultLabel} match &quot;{query}&quot;
      </p>
      <Button
        type="button"
        variant="brand"
        onClick={onClear}
        className={`mt-6 bg-none bg-surface-inverse px-6 ${sectionLabel} text-white hover:bg-surface-inverse-hover`}
      >
        {clearLabel}
      </Button>
    </motion.div>
  );
}
