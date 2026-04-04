'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { FileText } from '@/components/Icons';
import { sectionLabel, tableHeader } from '@/design-system/tokens/typography/presets';
import { framerTransition } from '@/design-system/foundations/motion-framer';

export interface ManualAssignmentRow {
  /** orders.item_number — may be empty for orders imported without one */
  itemNumber: string;
  productTitle: string;
  googleDocId: string;
  manualDisplayName?: string;
  /** orders.order_id (string, e.g. eBay order number) */
  orderId?: string;
  /** orders.id (numeric DB primary key) — needed to back-fill item_number */
  dbId?: number;
  trackingNumber?: string | null;
  isShipped?: boolean;
}

interface ManualAssignmentTableProps {
  rows: ManualAssignmentRow[];
  selectedItemNumber?: string;
  selectedRowKey?: string;
  onRowClick: (row: ManualAssignmentRow) => void;
  /** Inline expansion rendered directly below the selected row */
  renderExpanded?: (row: ManualAssignmentRow) => React.ReactNode;
  loading?: boolean;
  emptyMessage?: string;
  getRowKey?: (row: ManualAssignmentRow, index: number) => string;
}

export function ManualAssignmentTable({
  rows,
  selectedItemNumber,
  selectedRowKey,
  onRowClick,
  renderExpanded,
  loading = false,
  emptyMessage = 'Choose a category or order from the sidebar.',
  getRowKey,
}: ManualAssignmentTableProps) {
  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <p className={sectionLabel}>Loading Manual Records...</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2">
        <FileText className="w-8 h-8 text-gray-500" />
        <p className={sectionLabel}>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Header */}
      <div className="sticky top-0 z-10 grid min-h-[44px] grid-cols-[1fr_2fr_auto] items-end gap-3 border-b border-gray-200 bg-gray-50/90 px-5 pb-2.5 pt-3 backdrop-blur-sm">
        <p className={tableHeader}>Item Number</p>
        <p className={tableHeader}>Product</p>
        <p className={tableHeader}>Manual Status</p>
      </div>

      {/* Rows with inline expansion */}
      <div>
        {rows.map((row, idx) => {
          const rowKey = getRowKey ? getRowKey(row, idx) : `${row.itemNumber}-${idx}`;
          const isSelected = selectedRowKey != null
            ? rowKey === selectedRowKey
            : row.itemNumber === selectedItemNumber;
          const hasManual = row.googleDocId.trim().length > 0;

          return (
            <div key={rowKey}>
              <motion.button
                type="button"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...framerTransition.tableRowMount, delay: Math.min(idx * 0.02, 0.3) }}
                onClick={() => onRowClick(row)}
                className={`w-full text-left grid grid-cols-[1fr_2fr_auto] items-center gap-3 px-5 py-3.5 border-b border-gray-100 transition-all ${
                  isSelected
                    ? 'bg-blue-50 border-l-2 border-l-blue-600'
                    : 'hover:bg-gray-50 border-l-2 border-l-transparent'
                }`}
              >
                {/* Item number */}
                <div className="min-w-0">
                  <p className={`text-xs font-black truncate leading-snug ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}>
                    {row.itemNumber || '—'}
                  </p>
                  {row.orderId && (
                    <p className="text-[10px] font-semibold text-gray-500 truncate mt-0.5">
                      {row.orderId}
                    </p>
                  )}
                </div>

                {/* Product title */}
                <p className={`text-xs font-semibold leading-snug line-clamp-2 ${isSelected ? 'text-blue-600' : 'text-gray-600'}`}>
                  {row.productTitle || '—'}
                </p>

                {/* Manual status badge */}
                <span
                  className={`${sectionLabel} inline-flex items-center rounded-full px-2.5 py-1 border whitespace-nowrap ${
                    hasManual
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}
                >
                  {hasManual ? 'Linked' : 'Needs Link'}
                </span>
              </motion.button>

              {/* Inline expansion */}
              <AnimatePresence>
                {isSelected && renderExpanded && (
                  <motion.div
                    key={`expand-${rowKey}`}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={framerTransition.workOrderSlideSpring}
                    className="overflow-hidden border-b border-blue-100"
                  >
                    {renderExpanded(row)}
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
