'use client';

import { motion } from 'framer-motion';
import { Calendar, ExternalLink } from '@/components/Icons';
import { type FBAQueueItem, FBA_ITEM_STATUS_BADGE } from './upnext-types';

interface FbaItemCardProps {
  item: FBAQueueItem;
}

export function FbaItemCard({ item }: FbaItemCardProps) {
  const badgeCls = FBA_ITEM_STATUS_BADGE[item.status] || FBA_ITEM_STATUS_BADGE['PLANNED'];
  const dueDateStr = item.due_date
    ? new Date(item.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null;
  const qtyReady    = Number(item.actual_qty) || 0;
  const qtyExpected = Number(item.expected_qty) || 0;
  const qtyLabel = qtyExpected > 0 ? qtyExpected : qtyReady || 1;

  return (
    <motion.div
      key={`fba-item-${item.item_id}`}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="rounded-2xl p-3 border-2 transition-all relative shadow-sm hover:shadow-md mb-2 bg-white border-purple-300 hover:border-purple-500 cursor-default"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-[14px] font-black text-gray-900">
            <Calendar className="w-4 h-4 text-purple-600" />
            <span>{dueDateStr || 'No Due Date'}</span>
          </div>
        </div>
        <span className="inline-flex items-center rounded-lg border border-purple-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-900">
          FBA
        </span>
      </div>

      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[13px] font-black text-gray-900">{qtyLabel}</span>
            <span className="text-[13px] font-black uppercase tracking-wider text-gray-500">-</span>
            <span className="text-[13px] font-black uppercase truncate text-gray-900">
              {item.status.replaceAll('_', ' ')}
            </span>
          </div>
          <span className="text-[13px] font-mono font-black text-gray-900 px-1.5 py-0.5 rounded border border-gray-300">
            #{item.shipment_ref}
          </span>
        </div>
        <h4 className="text-base font-black text-gray-900 leading-tight">{item.product_title || item.fnsku}</h4>
      </div>

      {(item.asin || item.fnsku || item.sku) && (
        <div className="mb-4 rounded-xl border border-purple-200 px-3 py-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-purple-700 mb-1">
            FBA Details
          </div>
          <p className="text-sm text-gray-900 break-words whitespace-pre-wrap">
            {[
              item.asin ? `ASIN: ${item.asin}` : null,
              item.fnsku ? `FNSKU: ${item.fnsku}` : null,
              item.sku ? `SKU: ${item.sku}` : null,
            ].filter(Boolean).join(' • ')}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 pt-2 border-t border-purple-200">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-black text-gray-900 truncate">
            {item.assigned_tech_name || 'FBA Queue'}
          </div>
          <div className="text-[10px] text-gray-500 truncate">
            Ready {qtyReady} / {qtyExpected > 0 ? qtyExpected : '?'}
          </div>
        </div>
        <span className={`text-[9px] font-black uppercase tracking-widest border rounded-lg px-2 py-0.5 ${badgeCls}`}>
          {item.status.replace('_', ' ')}
        </span>
        <button
          type="button"
          className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="w-3 h-3" />
          Open
        </button>
      </div>
    </motion.div>
  );
}
