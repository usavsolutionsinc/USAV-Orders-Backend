'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Package } from '@/components/Icons';
import { QA_BADGE, COND_LABEL } from './receiving-constants';
import { formatDateTimePST } from '@/lib/timezone';
import type { ReceivingDetailsLog } from './ReceivingDetailsStack';

interface FeedLog extends ReceivingDetailsLog {
  unboxed_at: string | null;
}

const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;

function isRecentlyUnboxed(log: FeedLog): boolean {
  if (!log.unboxed_at) return false;
  return Date.now() - new Date(log.unboxed_at).getTime() < FORTY_EIGHT_HOURS;
}

function TrackingChip({ tracking }: { tracking?: string }) {
  const display = tracking ? tracking.slice(-8) : '—';
  return (
    <span className="text-[9px] font-mono font-black text-blue-700 bg-blue-50 border border-blue-100 rounded-md px-1.5 py-0.5">
      {display}
    </span>
  );
}

function CarrierChip({ carrier }: { carrier?: string | null }) {
  if (!carrier || carrier === 'Unknown') return null;
  return (
    <span className="text-[8px] font-black uppercase tracking-widest text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">
      {carrier}
    </span>
  );
}

interface FeedRowProps {
  log: FeedLog;
  isSelected: boolean;
  onClick: () => void;
  idx: number;
}

function FeedRow({ log, isSelected, onClick, idx }: FeedRowProps) {
  const qaCls = QA_BADGE[log.qa_status ?? 'PENDING'] ?? QA_BADGE['PENDING'];
  const condLabel = COND_LABEL[log.condition_grade ?? ''] ?? log.condition_grade ?? '';

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, delay: Math.min(idx * 0.025, 0.4) }}
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-50 transition-all ${
        isSelected
          ? 'bg-blue-50 border-l-2 border-l-blue-600'
          : 'hover:bg-gray-50/60 border-l-2 border-l-transparent'
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <TrackingChip tracking={log.tracking} />
        <CarrierChip carrier={log.status} />
        {condLabel && (
          <span className="text-[8px] font-black uppercase tracking-widest text-gray-400">{condLabel}</span>
        )}
        <span className={`text-[8px] font-black uppercase tracking-widest rounded px-1.5 py-0.5 ml-auto ${qaCls}`}>
          {(log.qa_status ?? 'PENDING').replace(/_/g, ' ')}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        {log.needs_test && (
          <span className="text-[8px] font-black uppercase tracking-widest text-orange-700 bg-orange-50 border border-orange-100 rounded px-1.5 py-0.5">
            Needs Test
          </span>
        )}
        {log.unboxed_at && (
          <span className="text-[8px] text-gray-400 font-bold">
            Unboxed {formatDateTimePST(log.unboxed_at)}
          </span>
        )}
      </div>
    </motion.button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface ReceivingInboundFeedProps {
  /** Called when a row is clicked — parent should open ReceivingDetailsStack */
  onSelectLog?: (log: ReceivingDetailsLog) => void;
}

export function ReceivingInboundFeed({ onSelectLog }: ReceivingInboundFeedProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [section, setSection] = useState<'testing' | 'unboxed'>('testing');

  const { data: allLogs = [], isFetching, isLoading } = useQuery<FeedLog[]>({
    queryKey: ['receiving-inbound-feed'],
    queryFn: async () => {
      const res = await fetch('/api/receiving-logs?limit=100', { cache: 'no-store' });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const needsTesting = allLogs.filter((l) => l.needs_test);
  const recentlyUnboxed = allLogs.filter(isRecentlyUnboxed);

  const rows = section === 'testing' ? needsTesting : recentlyUnboxed;

  const handleRowClick = (log: FeedLog) => {
    const nextId = selectedId === log.id ? null : log.id;
    setSelectedId(nextId);
    if (nextId && onSelectLog) onSelectLog(log);
  };

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 bg-white sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600">
            <Package className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-[13px] font-black text-gray-900 leading-none">Inbound Feed</p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mt-0.5">
              Receiving Activity
            </p>
          </div>
        </div>
        {isFetching && !isLoading && (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
        )}
      </div>

      {/* Section pills */}
      <div className="flex gap-1.5 px-4 py-2.5 border-b border-gray-100 bg-gray-50/40">
        <button
          type="button"
          onClick={() => setSection('testing')}
          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all ${
            section === 'testing'
              ? 'bg-orange-500 text-white'
              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          }`}
        >
          Needs Testing
          {needsTesting.length > 0 && (
            <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-black ${
              section === 'testing' ? 'bg-white/30' : 'bg-orange-100 text-orange-700'
            }`}>
              {needsTesting.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setSection('unboxed')}
          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all ${
            section === 'unboxed'
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          }`}
        >
          Recently Unboxed
          {recentlyUnboxed.length > 0 && (
            <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-black ${
              section === 'unboxed' ? 'bg-white/30' : 'bg-indigo-100 text-indigo-700'
            }`}>
              {recentlyUnboxed.length}
            </span>
          )}
        </button>
      </div>

      {/* Feed rows */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Package className="w-10 h-10 text-gray-200" />
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-300">
              {section === 'testing' ? 'No items need testing' : 'Nothing unboxed in last 48h'}
            </p>
          </div>
        ) : (
          <AnimatePresence>
            {rows.map((log, idx) => (
              <FeedRow
                key={log.id}
                log={log}
                idx={idx}
                isSelected={selectedId === log.id}
                onClick={() => handleRowClick(log)}
              />
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Footer count */}
      <div className="border-t border-gray-100 px-4 py-2 bg-gray-50/60">
        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
          {rows.length} item{rows.length !== 1 ? 's' : ''} •{' '}
          {section === 'testing' ? 'sorted by recency' : 'last 48 hours'}
        </p>
      </div>
    </div>
  );
}
