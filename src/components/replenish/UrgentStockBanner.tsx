'use client';

import { useQuery } from '@tanstack/react-query';
import { ACTIVE_STATUSES, type NeedToOrderRow } from './replenish-types';

const URGENT_STATUSES = ['detected', 'pending_review'].join(',');

export function UrgentStockBanner() {
  const query = useQuery({
    queryKey: ['replenish-urgent-banner'],
    queryFn: async () => {
      const params = new URLSearchParams({
        status: URGENT_STATUSES,
        limit: '200',
        sort: 'fifo',
      });
      const res = await fetch(`/api/need-to-order?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) return [];
      const payload = await res.json();
      return (Array.isArray(payload.items) ? payload.items : []) as NeedToOrderRow[];
    },
    staleTime: 60_000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const urgentCount = query.data?.length ?? 0;
  if (urgentCount === 0) return null;

  const totalOrdersWaiting = (query.data || []).reduce((sum, row) => {
    return sum + (Array.isArray(row.orders_waiting) ? row.orders_waiting.length : 0);
  }, 0);

  return (
    <div className="mx-4 mt-3 mb-1 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-wider text-red-700">
            Urgent: {urgentCount} item{urgentCount !== 1 ? 's' : ''} need ordering
          </p>
          <p className="text-[10px] font-bold text-red-600/70 mt-0.5">
            {totalOrdersWaiting} order{totalOrdersWaiting !== 1 ? 's' : ''} blocked waiting on stock
          </p>
        </div>
        <div className="text-2xl font-black text-red-700 tabular-nums">
          {urgentCount}
        </div>
      </div>
    </div>
  );
}
