'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2 } from '@/components/Icons';
import { sectionLabel, fieldLabel, tableHeader } from '@/design-system/tokens/typography/presets';
import { mainStickyHeaderClass, mainStickyHeaderRowClass } from '@/components/layout/header-shell';
import { type ShippedFifoRow, statusPillClass, numText } from './replenish-types';

interface ReplenishmentShippedFifoTabProps {
  skuSearch: string;
}

export function ReplenishmentShippedFifoTab({ skuSearch }: ReplenishmentShippedFifoTabProps) {
  const queryKey = ['replenish-fifo', { skuSearch }] as const;

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ days: '30', limit: '100' });
      if (skuSearch) params.set('sku', skuSearch);
      const res = await fetch(`/api/replenish/shipped-fifo?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load FIFO data');
      const payload = await res.json();
      return (Array.isArray(payload.skus) ? payload.skus : []) as ShippedFifoRow[];
    },
    staleTime: 2 * 60_000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const rows = query.data || [];

  if (query.isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-600">Analyzing shipped SKU depletion...</p>
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
              <p className={`${sectionLabel} text-emerald-700`}>FIFO Restock · Shipped Depletion</p>
              <p className={`${fieldLabel} mt-0.5`}>
                {rows.length} SKU{rows.length !== 1 ? 's' : ''} shipped in last 30 days · sorted by depletion
              </p>
            </div>
            <div className="min-w-[18px] flex items-center justify-end">
              {(query.isFetching && !query.isLoading) && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto no-scrollbar">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-40 text-center">
              <div className="max-w-xs mx-auto animate-in fade-in zoom-in duration-300">
                <p className="text-gray-500 font-semibold italic opacity-40">
                  {skuSearch
                    ? `No shipped SKUs match "${skuSearch}"`
                    : 'No shipped SKU data in last 30 days'}
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {rows.map((row) => {
                const hasReplenishment = !!row.active_replenishment_id;
                const needsAttention = !hasReplenishment && Number(row.avg_units_per_week) > 0;
                const zohoLinked = !!row.zoho_item_id;

                return (
                  <div
                    key={row.sku}
                    className={`px-4 py-3 transition-colors ${
                      needsAttention ? 'bg-red-50/40 hover:bg-red-50/70' : 'hover:bg-gray-50/60'
                    }`}
                  >
                    <div className="grid grid-cols-[minmax(0,1.6fr)_70px_90px_90px_90px_90px_120px] gap-3 items-start">
                      {/* Item info */}
                      <div className="min-w-0">
                        <p className="text-[12px] font-black text-gray-900 truncate">
                          {row.product_title || row.sku}
                        </p>
                        <p className={`${fieldLabel} mt-0.5 truncate`}>
                          {row.sku}
                          {row.account_source && ` · ${row.account_source}`}
                        </p>
                        {!zohoLinked && (
                          <p className="text-[9px] font-bold text-amber-600 mt-0.5">Not linked to Zoho item</p>
                        )}
                      </div>

                      {/* Shipped qty */}
                      <div className="text-[10px] font-black text-gray-700">
                        <p className={`uppercase tracking-widest text-gray-500 ${tableHeader}`}>Shipped</p>
                        <p className="mt-1">{row.shipped_qty}</p>
                      </div>

                      {/* Units/week */}
                      <div className="text-[10px] font-black text-gray-700">
                        <p className={`uppercase tracking-widest text-gray-500 ${tableHeader}`}>Units/Wk</p>
                        <p className={`mt-1 ${Number(row.avg_units_per_week) >= 3 ? 'text-red-600' : ''}`}>
                          {row.avg_units_per_week}
                        </p>
                      </div>

                      {/* Zoho available */}
                      <div className="text-[10px] font-black text-gray-700">
                        <p className={`uppercase tracking-widest text-gray-500 ${tableHeader}`}>Avail</p>
                        <p className="mt-1">{zohoLinked ? numText(row.zoho_qty_available) : '—'}</p>
                      </div>

                      {/* Zoho incoming */}
                      <div className="text-[10px] font-black text-gray-700">
                        <p className={`uppercase tracking-widest text-gray-500 ${tableHeader}`}>Incoming</p>
                        <p className="mt-1">{zohoLinked ? numText(row.zoho_incoming_qty) : '—'}</p>
                      </div>

                      {/* Reorder level */}
                      <div className="text-[10px] font-black text-gray-700">
                        <p className={`uppercase tracking-widest text-gray-500 ${tableHeader}`}>Reorder Lvl</p>
                        <p className="mt-1">{row.reorder_level != null ? row.reorder_level : '—'}</p>
                      </div>

                      {/* Replenishment status */}
                      <div>
                        {hasReplenishment ? (
                          <div>
                            <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-wider ${statusPillClass(row.replenishment_status || '')}`}>
                              {(row.replenishment_status || '').replace(/_/g, ' ')}
                            </span>
                            {row.zoho_po_number && (
                              <p className="text-[9px] font-bold text-gray-500 mt-1">PO {row.zoho_po_number}</p>
                            )}
                          </div>
                        ) : (
                          <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-wider ${
                            needsAttention
                              ? 'bg-red-100 text-red-700 border-red-200'
                              : 'bg-gray-100 text-gray-500 border-gray-200'
                          }`}>
                            {needsAttention ? 'No coverage' : 'OK'}
                          </span>
                        )}
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
