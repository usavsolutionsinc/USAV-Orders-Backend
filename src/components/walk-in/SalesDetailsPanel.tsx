'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ShoppingCart, ExternalLink } from '../Icons';
import { PanelActionBar } from '@/components/shipped/details-panel/PanelActionBar';
import { usePanelActions } from '@/hooks/usePanelActions';
import { SlideOverBackdrop } from '@/components/ui/SlideOverBackdrop';
import DeleteButton from '@/components/ui/DeleteButton';
import { formatCentsToDollars } from '@/lib/square/client';
import type { SquareTransactionRecord } from '@/lib/neon/square-transaction-queries';

interface SalesDetailsPanelProps {
  sale: SquareTransactionRecord;
  onClose: () => void;
  /** Called after a successful soft-delete so the parent can refetch. */
  onDeleted?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  disableMoveUp?: boolean;
  disableMoveDown?: boolean;
}

export function SalesDetailsPanel({
  sale,
  onClose,
  onDeleted,
  onMoveUp = () => {},
  onMoveDown = () => {},
  disableMoveUp = false,
  disableMoveDown = false,
}: SalesDetailsPanelProps) {
  const panelActions = usePanelActions(
    { entityType: 'walk_in_sale', entityId: sale.id },
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Soft-delete = hide the local mirror row only (Square stays the record of
  // truth). Throws on failure so DeleteButton skips its onDeleted (close).
  const handleDelete = async () => {
    setDeleteError(null);
    const res = await fetch(`/api/walk-in/sales?id=${encodeURIComponent(sale.id)}`, {
      method: 'DELETE',
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) {
      const msg = body?.error || `Delete failed (${res.status})`;
      setDeleteError(msg);
      throw new Error(msg);
    }
  };

  const lineItems = Array.isArray(sale.line_items) ? sale.line_items : [];

  return (
    <>
      <SlideOverBackdrop onClose={onClose} />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 120 }}
        className="fixed right-0 top-0 h-screen w-[420px] bg-white border-l border-gray-200 shadow-2xl z-panel flex flex-col overflow-hidden"
      >
      {/* Header */}
      <div className="shrink-0 border-b border-gray-100 bg-white p-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0">
            <ShoppingCart className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xl font-black text-gray-900 tracking-tight leading-none truncate">
              {sale.customer_name || 'Walk-In Customer'}
            </p>
            <p className="text-micro font-bold text-emerald-600 uppercase tracking-widest mt-1">
              {sale.status === 'completed' ? 'Sale Complete' : sale.status}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xl font-black text-emerald-600 tracking-tight">
              {formatCentsToDollars(sale.total)}
            </p>
          </div>
        </div>
      </div>

      <PanelActionBar
        onClose={onClose}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        disableMoveUp={disableMoveUp}
        disableMoveDown={disableMoveDown}
        actions={panelActions}
      />

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Line Items */}
        <section>
          <h3 className="text-micro font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
            Items
          </h3>
          {lineItems.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No line items</p>
          ) : (
            <div className="space-y-2">
              {lineItems.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-label font-bold text-gray-900 truncate">
                      {item.name || 'Item'}
                    </p>
                    {item.sku && (
                      <p className="text-micro font-mono text-gray-500">{item.sku}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-caption font-black text-gray-900">
                      {formatCentsToDollars(item.price)}
                    </p>
                    <p className="text-eyebrow font-bold text-gray-400">
                      Qty: {item.quantity}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Order Summary */}
        <section>
          <h3 className="text-micro font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
            Order Summary
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-xs text-gray-500 font-semibold">Subtotal</span>
              <span className="text-sm font-bold text-gray-900">{formatCentsToDollars(sale.subtotal)}</span>
            </div>
            {(sale.discount ?? 0) > 0 && (
              <div className="flex justify-between">
                <span className="text-xs text-gray-500 font-semibold">Discount</span>
                <span className="text-sm font-bold text-red-600">-{formatCentsToDollars(sale.discount)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-xs text-gray-500 font-semibold">Tax</span>
              <span className="text-sm font-bold text-gray-900">{formatCentsToDollars(sale.tax)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-200 pt-2">
              <span className="text-xs font-black uppercase text-gray-900">Total</span>
              <span className="text-sm font-black text-emerald-600">{formatCentsToDollars(sale.total)}</span>
            </div>
          </div>
        </section>

        {/* Customer Info */}
        <section>
          <h3 className="text-micro font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
            Customer
          </h3>
          <div className="space-y-3">
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Name</span>
              <p className="font-bold text-sm text-gray-900">{sale.customer_name || 'Walk-In'}</p>
            </div>
            {sale.customer_phone && (
              <div>
                <span className="text-xs text-gray-500 font-semibold block mb-1">Phone</span>
                <p className="font-semibold text-sm text-gray-900">{sale.customer_phone}</p>
              </div>
            )}
            {sale.customer_email && (
              <div>
                <span className="text-xs text-gray-500 font-semibold block mb-1">Email</span>
                <p className="font-semibold text-sm text-gray-900 lowercase">{sale.customer_email}</p>
              </div>
            )}
          </div>
        </section>

        {/* Payment Info */}
        <section>
          <h3 className="text-micro font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
            Payment
          </h3>
          <div className="space-y-3">
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Method</span>
              <p className="font-bold text-sm text-gray-900 uppercase">{sale.payment_method || 'Card'}</p>
            </div>
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Square Order ID</span>
              <p className="font-mono text-sm text-gray-700">{sale.square_order_id}</p>
            </div>
            {sale.receipt_url && (
              <a
                href={sale.receipt_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-bold text-blue-600 hover:text-blue-700 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View Square Receipt
              </a>
            )}
          </div>
        </section>

        {/* Record */}
        <section>
          <h3 className="text-micro font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
            Record
          </h3>
          <div className="space-y-3">
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Date</span>
              <p className="font-semibold text-sm text-gray-900">
                {sale.created_at ? new Date(sale.created_at).toLocaleString() : 'Unknown'}
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* Footer — soft-delete (hide) this sale. Square stays the record of truth. */}
      <div className="shrink-0 border-t border-gray-200 bg-white px-6 py-3">
        {deleteError ? (
          <p className="mb-2 text-xs font-semibold text-rose-600">{deleteError}</p>
        ) : null}
        <DeleteButton
          onConfirm={handleDelete}
          onDeleted={() => {
            onDeleted?.();
            onClose();
          }}
          label="Delete sale"
          armedLabel="Click again to hide this sale"
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm font-black uppercase tracking-wider transition-all hover:bg-rose-100 hover:border-rose-300 disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>
      </motion.div>
    </>
  );
}
