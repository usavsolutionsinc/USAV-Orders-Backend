'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ManualAssignmentTable, type ManualAssignmentRow } from './admin/ManualAssignmentTable';
import { InlineManualForm } from './admin/ManualAssignmentTab';
import { RefreshCw } from './Icons';

interface OrderWithoutManual {
  id: number | null;
  tsn_id: number;
  order_id: string;
  product_title: string;
  item_number: string | null;
  sku: string;
  quantity: string | null;
  condition: string | null;
  shipping_tracking_number: string | null;
  is_shipped?: boolean; // derived from shipping_tracking_numbers
  has_manual: boolean;
  test_date_time: string | null;
}

/** Stable row key: prefer DB order id, fall back to tracking number */
function rowKey(order: OrderWithoutManual) {
  return order.id != null ? String(order.id) : (order.shipping_tracking_number ?? String(order.tsn_id));
}

function buildRows(orders: OrderWithoutManual[]): ManualAssignmentRow[] {
  return orders.map((order) => ({
    itemNumber: order.item_number || '',
    productTitle: order.product_title || order.sku || '—',
    googleDocId:  '',
    orderId:      order.order_id,
    dbId:         order.id ?? undefined,
    trackingNumber: order.shipping_tracking_number,
    isShipped:    order.is_shipped,
  }));
}

function manualRowKey(row: ManualAssignmentRow, index?: number) {
  if (row.dbId != null) return String(row.dbId);
  return row.trackingNumber ?? row.orderId ?? `${row.itemNumber}-${index ?? 0}`;
}

interface UpdateManualsViewProps {
  techId: string;
  /** Rolling window in days — defaults to 365 (full history) */
  days?: number;
}

export default function UpdateManualsView({ techId, days = 365 }: UpdateManualsViewProps) {
  const [rows, setRows]               = useState<ManualAssignmentRow[]>([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<ManualAssignmentRow | null>(null);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(0);

  const fetchOrders = useCallback(async () => {
    if (!techId) return;
    setLoading(true);
    setError(null);
    try {
      const url = `/api/tech/orders-without-manual?techId=${encodeURIComponent(techId)}&days=${days}`;
      const res  = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data  = await res.json();
      const orders: OrderWithoutManual[] = Array.isArray(data?.orders) ? data.orders : [];
      setRows(buildRows(orders));
      setSelectedRow((prev) => {
        if (!prev) return prev;
        const stillExists = orders.some((order) => {
          const builtRow = {
            itemNumber: order.item_number || '',
            productTitle: order.product_title || order.sku || '—',
            googleDocId: '',
            orderId: order.order_id,
            dbId: order.id ?? undefined,
            trackingNumber: order.shipping_tracking_number,
            isShipped: order.is_shipped,
          };
          return (
            prev.dbId === builtRow.dbId &&
            prev.orderId === builtRow.orderId &&
            prev.trackingNumber === builtRow.trackingNumber
          );
        });
        return stillExists ? prev : null;
      });
      setSelectedRowKey((prev) => {
        if (!prev) return prev;
        return orders.some((order) => rowKey(order) === prev) ? prev : null;
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, [techId, days]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders, lastRefresh]);

  const handleRowClick = (row: ManualAssignmentRow) => {
    const key = manualRowKey(row);
    setSelectedRowKey((prevKey) => {
      const nextKey = prevKey === key ? null : key;
      setSelectedRow(nextKey ? row : null);
      return nextKey;
    });
  };

  const handleSaved = (itemNumber: string, googleDocId: string) => {
    // Optimistically update then remove rows once the manual is confirmed saved
    setRows((prev) =>
      prev.map((r) => (r.itemNumber === itemNumber ? { ...r, googleDocId } : r))
    );
    setSelectedRow((prev) =>
      prev?.itemNumber === itemNumber ? { ...prev, googleDocId } : prev
    );
    setTimeout(() => {
      setRows((prev) => prev.filter((r) => r.itemNumber !== itemNumber));
      setSelectedRow((prev) => {
        if (prev?.itemNumber === itemNumber) {
          setSelectedRowKey(null);
          return null;
        }
        return prev;
      });
    }, 1200);
  };

  const missingCount = useMemo(
    () => rows.filter((r) => !r.googleDocId.trim()).length,
    [rows]
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">

      {/* ── Header ── */}
      <div className="flex-shrink-0 flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-4">
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-0.5">
            Update Manuals
          </p>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-black text-gray-900">{missingCount}</p>
            <p className="text-sm font-semibold text-gray-400">
              {missingCount === 1 ? 'order' : 'orders'} without a manual
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setLastRefresh((n) => n + 1)}
          disabled={loading}
          className="p-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-500 transition-all disabled:opacity-40"
          title="Refresh"
        >
          <motion.div
            animate={loading ? { rotate: 360 } : { rotate: 0 }}
            transition={loading ? { repeat: Infinity, duration: 0.8, ease: 'linear' } : {}}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </motion.div>
        </button>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="flex-shrink-0 mx-6 mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-red-700">{error}</p>
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        <ManualAssignmentTable
          rows={rows}
          selectedItemNumber={selectedRow?.itemNumber}
          selectedRowKey={selectedRowKey ?? undefined}
          onRowClick={handleRowClick}
          loading={loading}
          emptyMessage="All your orders have manuals linked — great job!"
          getRowKey={manualRowKey}
          renderExpanded={(row) => (
            <InlineManualForm
              row={row}
              onSaved={handleSaved}
              onClose={() => {
                setSelectedRow(null);
                setSelectedRowKey(null);
              }}
            />
          )}
        />
      </div>

    </div>
  );
}
