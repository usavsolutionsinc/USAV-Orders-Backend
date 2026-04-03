'use client';

import { motion } from 'framer-motion';
import { Search } from '@/components/Icons';
import { sectionLabel } from '@/design-system';

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
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
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
      <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight mb-1">{title}</h3>
      <p className="text-xs text-gray-500 font-bold uppercase tracking-widest leading-relaxed">
        No {resultLabel} match &quot;{query}&quot;
      </p>
      <button
        type="button"
        onClick={onClear}
        className={`mt-6 px-6 py-2 bg-gray-900 text-white ${sectionLabel} rounded-xl hover:bg-gray-800 transition-all active:scale-95 shadow-sm hover:shadow-md`}
      >
        {clearLabel}
      </button>
    </motion.div>
  );
}
