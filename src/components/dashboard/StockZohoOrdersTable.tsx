'use client';

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search } from '@/components/Icons';
import { sectionLabel, fieldLabel, tableHeader } from '@/design-system/tokens/typography/presets';
import { mainStickyHeaderClass, mainStickyHeaderRowClass } from '@/components/layout/header-shell';

type NeedToOrderStatus =
  | 'detected'
  | 'pending_review'
  | 'planned_for_po'
  | 'po_created'
  | 'waiting_for_receipt'
  | 'fulfilled'
  | 'cancelled';

interface NeedToOrderWaitingOrder {
  order_id?: number;
  channel_order_id?: string | null;
  quantity?: string | number;
}

interface NeedToOrderRow {
  id: string;
  sku: string | null;
  item_name: string;
  vendor_name: string | null;
  status: NeedToOrderStatus;
  quantity_needed: string | null;
  quantity_to_order: string | null;
  zoho_quantity_available: string | null;
  zoho_incoming_quantity: string | null;
  zoho_po_number: string | null;
  notes: string | null;
  orders_waiting?: NeedToOrderWaitingOrder[] | null;
}

interface NeedToOrderResponse {
  items?: NeedToOrderRow[];
  total?: number;
  page?: number;
  limit?: number;
}

interface StockZohoOrdersTableProps {
  searchValue: string;
  onClearSearch: () => void;
}

const STOCK_STATUSES = ['detected', 'pending_review', 'planned_for_po', 'po_created', 'waiting_for_receipt'].join(',');

function statusPillClass(status: string) {
  switch (status) {
    case 'waiting_for_receipt':
      return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'po_created':
      return 'bg-indigo-100 text-indigo-700 border-indigo-200';
    case 'planned_for_po':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'pending_review':
      return 'bg-orange-100 text-orange-700 border-orange-200';
    case 'detected':
      return 'bg-red-100 text-red-700 border-red-200';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-200';
  }
}

function normalizeNumberText(value: string | null | undefined) {
  const text = String(value ?? '').trim();
  return text || '0';
}

export default function StockZohoOrdersTable({ searchValue, onClearSearch }: StockZohoOrdersTableProps) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-stock-zoho'] });
    };
    window.addEventListener('usav-refresh-data', refresh);
    window.addEventListener('dashboard-refresh', refresh);
    return () => {
      window.removeEventListener('usav-refresh-data', refresh);
      window.removeEventListener('dashboard-refresh', refresh);
    };
  }, [queryClient]);

  const query = useQuery({
    queryKey: ['dashboard-stock-zoho', STOCK_STATUSES],
    queryFn: async () => {
      const params = new URLSearchParams({
        status: STOCK_STATUSES,
        page: '1',
        limit: '200',
      });
      const response = await fetch(`/api/need-to-order?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text || 'Failed to load Zoho stock rows');
      }
      const payload = (await response.json()) as NeedToOrderResponse;
      return Array.isArray(payload.items) ? payload.items : [];
    },
    staleTime: 60_000,
    gcTime: 10 * 60 * 1000,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  const filteredRows = useMemo(() => {
    const allRows = query.data || [];
    const term = searchValue.trim().toLowerCase();
    if (!term) {
      return [...allRows].sort((a, b) => {
        const aCount = Array.isArray(a.orders_waiting) ? a.orders_waiting.length : 0;
        const bCount = Array.isArray(b.orders_waiting) ? b.orders_waiting.length : 0;
        return bCount - aCount;
      });
    }

    return allRows.filter((row) => {
      const waitingOrders = Array.isArray(row.orders_waiting) ? row.orders_waiting : [];
      const haystack = [
        row.item_name,
        row.sku,
        row.vendor_name,
        row.zoho_po_number,
        row.status,
        row.notes,
        ...waitingOrders.map((order) => String(order.channel_order_id || order.order_id || '')),
      ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');

      return haystack.includes(term);
    });
  }, [query.data, searchValue]);

  if (query.isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-600">Loading Zoho stock records...</p>
        </div>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 px-6">
        <div className="max-w-xl text-center space-y-3">
          <p className="text-sm font-black uppercase tracking-wider text-red-600">Failed to load stock data</p>
          <p className="text-xs font-semibold text-gray-500">
            {query.error instanceof Error ? query.error.message : 'Unknown API error'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 bg-white relative">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className={mainStickyHeaderClass}>
          <div className={mainStickyHeaderRowClass}>
            <div>
              <p className={`${sectionLabel} text-blue-700`}>Stock • Zoho</p>
              <p className={`${fieldLabel} mt-0.5`}>
                {filteredRows.length} out-of-stock replenishment rows
              </p>
            </div>
            <div className="min-w-[18px] flex items-center justify-end">
              {query.isFetching && !query.isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" /> : null}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto no-scrollbar">
          {filteredRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-40 text-center">
              {searchValue ? (
                <div className="max-w-xs mx-auto animate-in fade-in zoom-in duration-300">
                  <div className="h-16 w-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Search className="h-8 w-8 text-red-400" />
                  </div>
                  <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight mb-1">No stock rows found</h3>
                  <p className="text-xs text-gray-500 font-bold uppercase tracking-widest leading-relaxed">
                    No Zoho rows match &quot;{searchValue}&quot;
                  </p>
                  <button
                    type="button"
                    onClick={onClearSearch}
                    className={`mt-6 px-6 py-2 bg-gray-900 text-white ${sectionLabel} rounded-xl hover:bg-gray-800 transition-all active:scale-95`}
                  >
                    Show All Stock Rows
                  </button>
                </div>
              ) : (
                <div className="max-w-xs mx-auto animate-in fade-in zoom-in duration-300">
                  <p className="text-gray-500 font-semibold italic opacity-40">No out-of-stock Zoho replenishment rows found</p>
                </div>
              )}
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredRows.map((row) => {
                const waitingOrders = Array.isArray(row.orders_waiting) ? row.orders_waiting : [];
                const waitingOrdersLabel = waitingOrders
                  .slice(0, 4)
                  .map((item) => String(item.channel_order_id || item.order_id || '').trim())
                  .filter(Boolean)
                  .join(', ');

                return (
                  <div key={row.id} className="px-4 py-3 hover:bg-gray-50/60 transition-colors">
                    <div className="grid grid-cols-[minmax(0,1.6fr)_90px_90px_130px_120px_minmax(0,1fr)] gap-3 items-start">
                      <div className="min-w-0">
                        <p className="text-[12px] font-black text-gray-900 truncate">{row.item_name || 'Unknown Item'}</p>
                        <p className={`${fieldLabel} mt-0.5 truncate`}>
                          {row.sku || 'No SKU'} • {row.vendor_name || 'No Vendor'}
                        </p>
                        <p className="text-[10px] font-bold text-gray-500 mt-1 truncate">
                          Avail {normalizeNumberText(row.zoho_quantity_available)} • Incoming {normalizeNumberText(row.zoho_incoming_quantity)}
                        </p>
                      </div>

                      <div className="text-[10px] font-black text-gray-700">
                        <p className="uppercase tracking-widest text-gray-500">Need</p>
                        <p className="mt-1">{normalizeNumberText(row.quantity_needed)}</p>
                      </div>

                      <div className="text-[10px] font-black text-gray-700">
                        <p className="uppercase tracking-widest text-gray-500">Order</p>
                        <p className="mt-1">{normalizeNumberText(row.quantity_to_order)}</p>
                      </div>

                      <div className="text-[10px] font-black text-gray-700 min-w-0">
                        <p className="uppercase tracking-widest text-gray-500">PO #</p>
                        <p className="mt-1 truncate">{row.zoho_po_number || 'Not created'}</p>
                      </div>

                      <div>
                        <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-wider ${statusPillClass(String(row.status || ''))}`}>
                          {String(row.status || 'unknown').replace(/_/g, ' ')}
                        </span>
                      </div>

                      <div className="min-w-0">
                        <p className={`${tableHeader} text-[9px]`}>Orders Waiting</p>
                        <p className="text-[10px] font-bold text-gray-600 mt-1 truncate">
                          {waitingOrdersLabel || '—'}
                        </p>
                        {row.notes ? (
                          <p className="text-[10px] font-semibold text-amber-700 mt-1 truncate">{row.notes}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
