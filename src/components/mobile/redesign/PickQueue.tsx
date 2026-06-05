'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShoppingCart,
  ChevronRight,
  Package,
  Clock,
  RefreshCw,
} from '@/components/Icons';
import {
  MobileCard,
  TOKENS,
  SectionHeader,
} from '@/components/mobile/redesign/DesignSystem';
import { MobileTopBar } from '@/components/mobile/redesign/MobileTopBar';
import { useRouter } from 'next/navigation';

/** One row of GET /api/pick/queue. */
interface QueueItem {
  orderId: number;
  orderLabel: string;
  customerInitials: string;
  customerName: string | null;
  accountSource: string | null;
  shipByDate: string | null;
  pendingCount: number;
  inProgressCount: number;
  totalCount: number;
  activePickerId: number | null;
}

/** Derive the visual status from the live allocation counts. */
function statusOf(item: QueueItem): 'pending' | 'picking' | 'overdue' {
  if (item.inProgressCount > 0) return 'picking';
  if (item.shipByDate && new Date(item.shipByDate).getTime() < Date.now()) return 'overdue';
  return 'pending';
}

function dueLabel(shipByDate: string | null): string {
  if (!shipByDate) return 'No deadline';
  const diffMs = new Date(shipByDate).getTime() - Date.now();
  const diffHr = Math.round(diffMs / 3_600_000);
  if (diffHr < 0) {
    const ago = Math.abs(diffHr);
    return ago >= 24 ? `${Math.round(ago / 24)}d ago` : `${ago}h ago`;
  }
  if (diffHr < 1) return 'Due now';
  if (diffHr < 24) return `in ${diffHr}h`;
  if (diffHr < 48) return 'Tomorrow';
  return `in ${Math.round(diffHr / 24)}d`;
}

export default function RedesignedMobilePickQueue() {
  const router = useRouter();
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/pick/queue', { credentials: 'include', cache: 'no-store' });
      const data = (await res.json()) as { ok?: boolean; queue?: QueueItem[] };
      setQueue(res.ok && Array.isArray(data.queue) ? data.queue : []);
    } catch {
      setQueue([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const count = queue?.length ?? 0;

  return (
    <div className={`min-h-screen ${TOKENS.colors.background} pb-32`}>
      <MobileTopBar
        eyebrow="Operations"
        title="Pick Queue"
        icon={ShoppingCart}
        actions={
          <button
            onClick={() => void load()}
            aria-label="Refresh"
            className={`flex h-10 w-10 items-center justify-center rounded-full border border-blue-100 bg-white text-blue-600 shadow-sm transition-all active:scale-90 ${refreshing ? 'animate-spin' : ''}`}
          >
            <RefreshCw className="h-5 w-5" />
          </button>
        }
      />

      <div className="px-4 pt-4">
      <p className="px-1 mb-4 text-sm font-medium text-blue-700/60">
        {queue === null
          ? 'Loading fulfillment queue…'
          : `${count} order${count === 1 ? '' : 's'} waiting for fulfillment`}
      </p>

      <SectionHeader title="Priority Queue" />

      <div className="flex flex-col gap-3.5 mt-2">
        {queue === null ? (
          [0, 1, 2].map((i) => (
            <MobileCard key={i} className="h-28 animate-pulse bg-blue-50/40" children={null} />
          ))
        ) : count === 0 ? (
          <MobileCard className="py-12 text-center">
            <Package className="mx-auto mb-3 h-10 w-10 text-blue-200" />
            <p className="text-xs font-black uppercase tracking-widest text-blue-300">Queue is clear</p>
            <p className="mt-1 text-xs font-medium text-blue-700/50">
              No orders are waiting to be picked right now.
            </p>
          </MobileCard>
        ) : (
          <AnimatePresence>
            {queue.map((item) => {
              const status = statusOf(item);
              return (
                <motion.div
                  key={item.orderId}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => router.push(`/m/orders/${item.orderId}`)}
                >
                  <MobileCard className="relative overflow-hidden group border-l-0">
                    {/* Status Indicator Bar */}
                    <div
                      className={`absolute top-0 left-0 bottom-0 w-1.5 ${
                        status === 'overdue'
                          ? 'bg-rose-500'
                          : status === 'picking'
                            ? 'bg-amber-500'
                            : 'bg-blue-600'
                      }`}
                    />

                    <div className="flex items-center gap-4">
                      <div
                        className={`h-14 w-14 rounded-2xl flex items-center justify-center font-black text-lg shadow-sm border ${
                          status === 'overdue'
                            ? 'bg-rose-50 border-rose-100 text-rose-600'
                            : status === 'picking'
                              ? 'bg-amber-50 border-amber-100 text-amber-600'
                              : 'bg-blue-50 border-blue-100 text-blue-600'
                        }`}
                      >
                        {item.customerInitials || '#'}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-base font-black text-blue-950 tracking-tight">{item.orderLabel}</p>
                          {item.accountSource && (
                            <span className="text-[9px] font-black uppercase tracking-[0.1em] bg-blue-50 text-blue-500 px-2 py-0.5 rounded-full border border-blue-100/50">
                              {item.accountSource}
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-medium text-blue-700/60 truncate">
                          {item.customerName || 'Unknown customer'}
                        </p>
                      </div>

                      <div className="h-8 w-8 rounded-full bg-blue-50 flex items-center justify-center group-active:bg-blue-100 transition-colors shrink-0">
                        <ChevronRight className="h-4 w-4 text-blue-200 group-active:text-blue-600 transition-colors" />
                      </div>
                    </div>

                    <div className="mt-5 flex items-center justify-between border-t border-blue-50 pt-4">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5">
                          <Package className="h-3.5 w-3.5 text-blue-200" />
                          <span className="text-[11px] font-black uppercase tracking-tight text-blue-700/70">
                            {item.totalCount} Unit{item.totalCount === 1 ? '' : 's'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-blue-200" />
                          <span
                            className={`text-[11px] font-black uppercase tracking-tight ${status === 'overdue' ? 'text-rose-600' : 'text-blue-700/70'}`}
                          >
                            {dueLabel(item.shipByDate)}
                          </span>
                        </div>
                      </div>

                      {status === 'picking' ? (
                        <div className="flex items-center gap-1.5 bg-amber-50 px-2 py-1 rounded-lg border border-amber-100">
                          <div className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                          <span className="text-[9px] font-black uppercase tracking-wider text-amber-700">In Progress</span>
                        </div>
                      ) : (
                        <span className="text-[9px] font-black uppercase tracking-widest text-blue-200">Ready to Pick</span>
                      )}
                    </div>
                  </MobileCard>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
      </div>
    </div>
  );
}
