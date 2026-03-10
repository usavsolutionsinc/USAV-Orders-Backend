'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Package } from '@/components/Icons';
import { WORKFLOW_BADGE, QA_BADGE } from './receiving-constants';
import type { ReceivingQueueItem } from './upnext/upnext-types';

export type { ReceivingQueueItem as ReceivingTestRow };

interface ReceivingTestTableProps {
  rows: ReceivingQueueItem[];
  selectedId?: number | null;
  onRowClick: (item: ReceivingQueueItem) => void;
  renderExpanded?: (item: ReceivingQueueItem) => React.ReactNode;
  loading?: boolean;
  emptyMessage?: string;
}

export function ReceivingTestTable({
  rows,
  selectedId,
  onRowClick,
  renderExpanded,
  loading = false,
  emptyMessage = 'No receiving items assigned for testing.',
}: ReceivingTestTableProps): React.ReactElement {
  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <p className="text-[10px] font-black uppercase tracking-widest text-teal-400">Loading…</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2">
        <Package className="w-8 h-8 text-teal-200" />
        <p className="text-[10px] font-black uppercase tracking-widest text-teal-400">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 grid grid-cols-[40px_1fr_auto] gap-2 bg-teal-50/90 backdrop-blur-sm border-b border-teal-100 px-4 py-2.5">
        <p className="text-[9px] font-black uppercase tracking-widest text-teal-600">ID</p>
        <p className="text-[9px] font-black uppercase tracking-widest text-teal-600">Tracking / SKUs</p>
        <p className="text-[9px] font-black uppercase tracking-widest text-teal-600">Status</p>
      </div>

      <div>
        {rows.map((item, idx) => {
          const isSelected = item.receiving_id === selectedId;
          const workflowCls = WORKFLOW_BADGE[item.workflow_status ?? ''] ?? 'bg-gray-100 text-gray-500';
          const qaCls = QA_BADGE[item.qa_status ?? ''] ?? 'bg-gray-100 text-gray-500';
          const trackingShort = item.tracking_number ? item.tracking_number.slice(-6) : '——';

          return (
            <div key={item.assignment_id}>
              <motion.button
                type="button"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15, delay: Math.min(idx * 0.025, 0.35) }}
                onClick={() => onRowClick(item)}
                className={`w-full text-left grid grid-cols-[40px_1fr_auto] items-center gap-2 px-4 py-3.5 border-b border-teal-50 transition-all ${
                  isSelected
                    ? 'bg-teal-50 border-l-2 border-l-teal-600'
                    : 'hover:bg-gray-50/60 border-l-2 border-l-transparent'
                }`}
              >
                {/* Receiving ID chip */}
                <span className={`text-[10px] font-black font-mono rounded-lg px-1.5 py-0.5 text-center whitespace-nowrap ${
                  isSelected ? 'bg-teal-600 text-white' : 'bg-teal-100 text-teal-700'
                }`}>
                  #{item.receiving_id}
                </span>

                {/* Tracking + SKUs */}
                <div className="min-w-0">
                  <p className={`text-[11px] font-black font-mono truncate leading-snug ${isSelected ? 'text-teal-700' : 'text-gray-700'}`}>
                    {item.carrier && (
                      <span className="text-gray-400 mr-1 font-bold not-italic">{item.carrier}</span>
                    )}
                    {trackingShort}
                  </p>
                  {item.line_skus.length > 0 ? (
                    <p className="text-[9px] font-semibold text-gray-400 truncate mt-0.5">
                      {item.line_skus.slice(0, 3).join(', ')}
                      {item.line_count > item.line_skus.length
                        ? ` +${item.line_count - item.line_skus.length}`
                        : ''}
                    </p>
                  ) : item.line_count > 0 ? (
                    <p className="text-[9px] font-semibold text-gray-400 mt-0.5">
                      {item.line_count} line{item.line_count !== 1 ? 's' : ''}
                    </p>
                  ) : null}
                </div>

                {/* Status badges */}
                <div className="flex flex-col items-end gap-1">
                  <span className={`text-[8px] font-black uppercase tracking-widest rounded-md px-1.5 py-0.5 whitespace-nowrap ${workflowCls}`}>
                    {(item.workflow_status ?? 'EXPECTED').replace(/_/g, ' ')}
                  </span>
                  {item.qa_status && item.qa_status !== 'PENDING' && (
                    <span className={`text-[8px] font-black uppercase tracking-widest rounded-md px-1.5 py-0.5 whitespace-nowrap ${qaCls}`}>
                      {item.qa_status.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
              </motion.button>

              {/* Inline expansion */}
              <AnimatePresence>
                {isSelected && renderExpanded && (
                  <motion.div
                    key={`expand-${item.assignment_id}`}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ type: 'spring', damping: 28, stiffness: 300, mass: 0.6 }}
                    className="overflow-hidden border-b border-teal-100"
                  >
                    {renderExpanded(item)}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
