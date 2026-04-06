'use client';

import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Loader2 } from '@/components/Icons';
import { sectionLabel, fieldLabel } from '@/design-system/tokens/typography/presets';
import { mainStickyHeaderClass, mainStickyHeaderRowClass } from '@/components/layout/header-shell';
import { CopyChip, HashIcon } from '@/components/ui/CopyChip';
import { PlatformChip } from '@/components/ui/CopyChip';
import { getExternalUrlByItemNumber } from '@/hooks/useExternalItemUrl';
import {
  type NeedToOrderRow,
  type ReplenishmentStatus,
  ACTIVE_STATUSES,
  numText,
} from './replenish-types';

interface ReplenishmentNeedTableProps {
  skuSearch: string;
  statusFilter: string | null;
}

/** SKU chip — gray / hash icon, same style as OrderIdChip but shows full SKU. */
function SkuChip({ sku }: { sku: string }) {
  const display = sku || '---';
  return (
    <CopyChip
      value={sku}
      display={display}
      icon={<HashIcon />}
      underlineClass="border-gray-500"
      iconClass="text-gray-500"
      truncateDisplay={false}
    />
  );
}

export function ReplenishmentNeedTable({ skuSearch, statusFilter }: ReplenishmentNeedTableProps) {
  const statuses = statusFilter && ACTIVE_STATUSES.includes(statusFilter as ReplenishmentStatus)
    ? statusFilter
    : ACTIVE_STATUSES.join(',');

  const queryKey = ['replenish-need', { statuses, skuSearch }] as const;

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        status: statuses,
        limit: '200',
        sort: 'fifo',
      });
      if (skuSearch) params.set('sku', skuSearch);
      const res = await fetch(`/api/need-to-order?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load replenishment requests');
      const payload = await res.json();
      return (Array.isArray(payload.items) ? payload.items : []) as NeedToOrderRow[];
    },
    staleTime: 60_000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const rows = query.data || [];

  if (query.isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-600">Loading...</p>
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
              <p className={`${sectionLabel} text-red-700`}>Need to Order</p>
              <p className={`${fieldLabel} mt-0.5`}>
                {rows.length} item{rows.length !== 1 ? 's' : ''} · oldest first
              </p>
            </div>
            <div className="min-w-[18px] flex items-center justify-end">
              {(query.isFetching && !query.isLoading) && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto no-scrollbar">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-40 text-center">
              <div className="max-w-xs mx-auto animate-in fade-in zoom-in duration-300">
                <p className="text-gray-500 font-semibold italic opacity-40">
                  {skuSearch ? `No items match "${skuSearch}"` : 'Nothing to order right now'}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col w-full">
              {rows.map((row, index) => {
                const waitingOrders = Array.isArray(row.orders_waiting) ? row.orders_waiting : [];
                const waitingCount = waitingOrders.length;
                const qtyToOrder = numText(row.quantity_to_order);
                const sku = String(row.sku || '').trim();

                return (
                  <motion.div
                    key={row.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 transition-all border-b border-gray-50 cursor-default hover:bg-blue-50/50 ${
                      index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
                    }`}
                  >
                    {/* Left: two-line info */}
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" title="Needs reorder" />
                        <div className="text-[12px] font-bold text-gray-900 truncate">
                          {row.item_name || 'Unknown Item'}
                        </div>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest truncate min-w-0 flex-1 pl-4">
                          <span className="text-red-600">{qtyToOrder}</span>
                          {' • '}
                          {row.vendor_name || 'No Vendor'}
                          {waitingCount > 0 && (
                            <>
                              {' • '}
                              <span className="text-amber-600">{waitingCount} order{waitingCount !== 1 ? 's' : ''}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: SKU chip + Ecwid link */}
                    <div className="flex items-center shrink-0">
                      {sku && (
                        <PlatformChip
                          label={sku}
                          underlineClass="border-gray-400"
                          iconClass="text-gray-500"
                          onClick={(e) => {
                            e.stopPropagation();
                            const url = getExternalUrlByItemNumber(sku);
                            if (url) window.open(url, '_blank', 'noopener,noreferrer');
                          }}
                        />
                      )}
                      <SkuChip sku={sku} />
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
