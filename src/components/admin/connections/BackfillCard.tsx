'use client';

import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { RefreshCw } from '@/components/Icons';

export function BackfillCard({ embedded = false }: { embedded?: boolean }) {
  const ebayBackfillMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/orders/backfill/ebay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookbackDays: 30, limitPerAccount: 200 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || data?.message || `Backfill failed (HTTP ${res.status})`);
      return data;
    },
  });

  const ecwidBackfillMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/orders/backfill/ecwid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxPages: 10 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || data?.message || `Backfill failed (HTTP ${res.status})`);
      return data;
    },
  });

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-4 border border-gray-200 bg-white p-5'}>
      <div className={`flex items-center justify-between gap-3 ${embedded ? 'border-b border-gray-200 pb-3' : ''}`}>
        <div>
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">Orders Backfill</h2>
          <p className="text-[9px] font-bold text-gray-500 mt-1">Backfill only empty columns in orders table from marketplace APIs</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => ebayBackfillMutation.mutate()}
            disabled={ebayBackfillMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-white shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${ebayBackfillMutation.isPending ? 'animate-spin' : ''}`} />
            {ebayBackfillMutation.isPending ? 'Backfilling...' : 'Backfill eBay'}
          </button>
          <button
            onClick={() => ecwidBackfillMutation.mutate()}
            disabled={ecwidBackfillMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-white shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${ecwidBackfillMutation.isPending ? 'animate-spin' : ''}`} />
            {ecwidBackfillMutation.isPending ? 'Backfilling...' : 'Backfill Ecwid'}
          </button>
        </div>
      </div>

      {ebayBackfillMutation.isSuccess && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="border-l-2 border-l-green-500 p-4 bg-green-50/70">
          <div className="text-[10px] font-black text-green-700 uppercase tracking-widest">
            eBay: Updated {ebayBackfillMutation.data?.totals?.updated || 0} • Matched {ebayBackfillMutation.data?.totals?.matched || 0} • Resolved {ebayBackfillMutation.data?.totals?.resolvedExceptions || 0} • Unmatched {ebayBackfillMutation.data?.totals?.unmatched || 0}
          </div>
        </motion.div>
      )}

      {ebayBackfillMutation.isError && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="border-l-2 border-l-red-500 p-4 bg-red-50/70">
          <div className="text-[10px] font-black text-red-700 uppercase tracking-widest">
            {(ebayBackfillMutation.error as Error)?.message || 'eBay backfill failed'}
          </div>
        </motion.div>
      )}

      {ecwidBackfillMutation.isSuccess && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="border-l-2 border-l-green-500 p-4 bg-green-50/70">
          <div className="text-[10px] font-black text-green-700 uppercase tracking-widest">
            Ecwid: Updated {ecwidBackfillMutation.data?.totals?.updated || 0} • Matched {ecwidBackfillMutation.data?.totals?.matched || 0} • Unmatched {ecwidBackfillMutation.data?.totals?.unmatched || 0}
          </div>
        </motion.div>
      )}

      {ecwidBackfillMutation.isError && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="border-l-2 border-l-red-500 p-4 bg-red-50/70">
          <div className="text-[10px] font-black text-red-700 uppercase tracking-widest">
            {(ecwidBackfillMutation.error as Error)?.message || 'Ecwid backfill failed'}
          </div>
        </motion.div>
      )}
    </div>
  );
}
