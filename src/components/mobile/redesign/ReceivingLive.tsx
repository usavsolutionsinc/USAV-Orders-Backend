'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  PackageCheck,
  Package,
  Clock,
  RefreshCw,
  Plus,
  Camera,
} from '@/components/Icons';
import {
  MobileCard,
  TOKENS,
} from '@/components/mobile/redesign/DesignSystem';
import { MobileTopBar } from '@/components/mobile/redesign/MobileTopBar';
import { useRouter } from 'next/navigation';

/** One row of GET /api/receiving-logs. */
interface ReceivingLog {
  id: number;
  timestamp: string;
  tracking: string | null;
  status: string | null;
  count: number | string;
  qa_status: string | null;
  condition_grade: string | null;
  is_return: boolean;
  return_platform: string | null;
  needs_test: boolean;
  received_at: string | null;
  unboxed_at: string | null;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'In transit';
  const then = new Date(dateStr.replace(' ', 'T')).getTime();
  if (Number.isNaN(then)) return '—';
  const diffMin = Math.floor((Date.now() - then) / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export default function RedesignedMobileReceivingLive() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'live' | 'history'>('live');
  const [logs, setLogs] = useState<ReceivingLog[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Once the user taps a tab we stop auto-selecting one for them.
  const userPickedTab = useRef(false);

  const pickTab = useCallback((tab: 'live' | 'history') => {
    userPickedTab.current = true;
    setActiveTab(tab);
  }, []);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/receiving-logs?limit=50', {
        credentials: 'include',
        cache: 'no-store',
      });
      const data = await res.json().catch(() => null);
      setLogs(res.ok && Array.isArray(data) ? (data as ReceivingLog[]) : []);
    } catch {
      setLogs([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Live = still inbound (not yet unboxed); History = completed unboxing.
  const liveCount = useMemo(
    () => (logs ? logs.filter((l) => !l.unboxed_at).length : 0),
    [logs],
  );

  const shown = useMemo(() => {
    if (!logs) return null;
    return logs.filter((l) => (activeTab === 'live' ? !l.unboxed_at : !!l.unboxed_at));
  }, [logs, activeTab]);

  // The Live feed is empty whenever nothing is mid-receipt, which made tapping
  // "Receiving" land on a blank screen. If the user hasn't picked a tab yet and
  // there's nothing live but there IS history, open on History so there's
  // always something to see.
  useEffect(() => {
    if (userPickedTab.current || !logs || logs.length === 0) return;
    if (liveCount === 0 && logs.length > 0) setActiveTab('history');
  }, [logs, liveCount]);

  return (
    <div className={`min-h-screen ${TOKENS.colors.background} pb-32`}>
      <MobileTopBar
        eyebrow="Inventory"
        title="Receiving"
        icon={PackageCheck}
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
      {/* Tabs */}
      <div className="flex bg-slate-100 rounded-2xl p-1 mb-6">
        <button
          onClick={() => pickTab('live')}
          className={`flex-1 py-2 text-xs font-black uppercase tracking-widest rounded-xl transition-all ${activeTab === 'live' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}
        >
          Live Feed
        </button>
        <button
          onClick={() => pickTab('history')}
          className={`flex-1 py-2 text-xs font-black uppercase tracking-widest rounded-xl transition-all ${activeTab === 'history' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}
        >
          History
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {shown === null ? (
          [0, 1, 2].map((i) => (
            <MobileCard key={i} className="h-28 animate-pulse bg-slate-100/60">{null}</MobileCard>
          ))
        ) : shown.length === 0 ? (
          <MobileCard className="py-12 text-center">
            <Package className="mx-auto mb-3 h-10 w-10 text-slate-200" />
            <p className="text-xs font-black uppercase tracking-widest text-slate-300">
              {activeTab === 'live' ? 'Nothing inbound right now' : 'No receiving history yet'}
            </p>
          </MobileCard>
        ) : (
          shown.map((item) => {
            const qty = Number(item.count) || 0;
            const statusLabel = item.qa_status || item.status || 'Received';
            return (
              <motion.div key={item.id} layout>
                <MobileCard
                  onClick={() => router.push(`/m/r/${item.id}/photos`)}
                  className="relative group"
                >
                  {item.is_return && (
                    <div className="absolute top-0 right-0 px-3 py-1 bg-rose-500 text-white text-[10px] font-black uppercase tracking-widest rounded-bl-xl rounded-tr-2xl">
                      Return
                    </div>
                  )}

                  <div className="flex gap-4">
                    <div className="h-14 w-14 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0">
                      <Package className="h-7 w-7 text-slate-300" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-black text-blue-600 font-mono truncate">
                        {item.tracking || `Receiving #${item.id}`}
                      </p>
                      <p className="text-sm font-bold text-slate-900 truncate mt-0.5">
                        {statusLabel}
                        {item.condition_grade ? ` · ${item.condition_grade}` : ''}
                      </p>

                      <div className="mt-3 flex items-center gap-4">
                        <div className="flex items-center gap-1.5">
                          <div className={`h-1.5 w-1.5 rounded-full ${item.unboxed_at ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                          <span className="text-[10px] font-black uppercase text-slate-500">{qty} Unit{qty === 1 ? '' : 's'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-slate-400" />
                          <span className="text-[10px] font-black uppercase text-slate-400">
                            {timeAgo(item.unboxed_at || item.received_at || item.timestamp)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {item.needs_test ? (
                        <span className="inline-flex items-center rounded-md bg-amber-50 border border-amber-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-700">
                          Needs test
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-slate-500">
                          {item.unboxed_at ? 'Unboxed' : 'Inbound'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/m/r/${item.id}`);
                        }}
                        className="text-[11px] font-black uppercase tracking-wider text-slate-400 active:text-slate-600"
                      >
                        Details
                      </button>
                      <span className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-600">
                        <Camera className="h-3.5 w-3.5" /> Add photos
                      </span>
                    </div>
                  </div>
                </MobileCard>
              </motion.div>
            );
          })
        )}
      </div>
      </div>

      {/* FAB → start a new receive */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={() => router.push('/m/receive')}
        className="fixed bottom-24 right-6 h-14 w-14 bg-blue-600 text-white rounded-full shadow-2xl flex items-center justify-center z-40"
      >
        <Plus className="h-6 w-6" />
      </motion.button>
    </div>
  );
}
