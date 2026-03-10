'use client';

import { motion } from 'framer-motion';
import { type ZohoPO, statusColor, fmtDate, fmtCurrency } from './zoho-po-types';

interface POListItemProps {
  po: ZohoPO;
  selected: boolean;
  onClick: () => void;
}

export function POListItem({ po, selected, onClick }: POListItemProps) {
  const lineCount = po.line_items?.length ?? 0;
  return (
    <motion.button
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-b border-gray-50/80 transition-colors group ${
        selected ? 'bg-blue-50/70' : 'bg-white hover:bg-gray-50/60'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-black text-gray-800 uppercase tracking-wide truncate">
          {po.purchaseorder_number || po.purchaseorder_id}
        </span>
        <span
          className={`shrink-0 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${statusColor(po.status)}`}
        >
          {po.status || '—'}
        </span>
      </div>
      <div className="flex items-center justify-between mt-0.5 gap-1">
        <span className="text-[10px] text-gray-500 truncate">{po.vendor_name || 'Unknown vendor'}</span>
        <span className="text-[10px] text-gray-400 shrink-0 tabular-nums">
          {fmtCurrency(po.total, po.currency_code)}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="text-[9px] text-gray-400">{fmtDate(po.date)}</span>
        {lineCount > 0 && (
          <span className="text-[9px] text-gray-400">
            {lineCount} item{lineCount !== 1 ? 's' : ''}
          </span>
        )}
        {po.delivery_date && (
          <span className="text-[9px] text-orange-400">Due {fmtDate(po.delivery_date)}</span>
        )}
      </div>
    </motion.button>
  );
}
