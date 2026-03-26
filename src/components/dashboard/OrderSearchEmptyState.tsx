'use client';

import { Search } from '@/components/Icons';

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
    <div className="max-w-xs mx-auto animate-in fade-in zoom-in duration-300">
      <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
        <Search className="w-8 h-8 text-red-400" />
      </div>
      <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight mb-1">{title}</h3>
      <p className="text-xs text-gray-500 font-bold uppercase tracking-widest leading-relaxed">
        No {resultLabel} match &quot;{query}&quot;
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-6 px-6 py-2 bg-gray-900 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-xl hover:bg-gray-800 transition-all active:scale-95"
      >
        {clearLabel}
      </button>
    </div>
  );
}
