'use client';

import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { RefreshCw } from '@/components/Icons';
import EbayManagement from '@/components/EbayManagement';

export function ConnectionsManagementTab() {
  const ebayBackfillMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/orders/backfill/ebay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookbackDays: 30, limitPerAccount: 200 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || data?.message || `Backfill failed (HTTP ${res.status})`);
      }
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
      if (!res.ok) {
        throw new Error(data?.error || data?.message || `Backfill failed (HTTP ${res.status})`);
      }
      return data;
    },
  });
  const ecwidSquareSyncMutation = useMutation({
    mutationFn: async ({ dryRun = false, batchSize }: { dryRun?: boolean; batchSize?: number }) => {
      const res = await fetch('/api/ecwid-square/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun, batchSize }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || data?.message || `Sync failed (HTTP ${res.status})`);
      }

      return data;
    },
  });
  const exceptionsSyncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/orders-exceptions/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || data?.message || `Sync failed (HTTP ${res.status})`);
      }
      return data;
    },
  });

  const counts = ecwidSquareSyncMutation.data?.counts;

  return (
    <div className="space-y-6">
      <div className="space-y-4 p-5 bg-white rounded-3xl border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">Orders Integrity Backfill</h2>
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
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-green-50 border border-green-200 rounded-2xl">
            <div className="text-[10px] font-black text-green-700 uppercase tracking-widest">
              eBay: Updated {ebayBackfillMutation.data?.totals?.updated || 0} • Matched {ebayBackfillMutation.data?.totals?.matched || 0} • Resolved {ebayBackfillMutation.data?.totals?.resolvedExceptions || 0} • Unmatched {ebayBackfillMutation.data?.totals?.unmatched || 0}
            </div>
          </motion.div>
        )}

        {ebayBackfillMutation.isError && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-red-50 border border-red-200 rounded-2xl">
            <div className="text-[10px] font-black text-red-700 uppercase tracking-widest">
              {(ebayBackfillMutation.error as Error)?.message || 'eBay backfill failed'}
            </div>
          </motion.div>
        )}

        {ecwidBackfillMutation.isSuccess && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-green-50 border border-green-200 rounded-2xl">
            <div className="text-[10px] font-black text-green-700 uppercase tracking-widest">
              Ecwid: Updated {ecwidBackfillMutation.data?.totals?.updated || 0} • Matched {ecwidBackfillMutation.data?.totals?.matched || 0} • Unmatched {ecwidBackfillMutation.data?.totals?.unmatched || 0}
            </div>
          </motion.div>
        )}

        {ecwidBackfillMutation.isError && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-red-50 border border-red-200 rounded-2xl">
            <div className="text-[10px] font-black text-red-700 uppercase tracking-widest">
              {(ecwidBackfillMutation.error as Error)?.message || 'Ecwid backfill failed'}
            </div>
          </motion.div>
        )}
      </div>

      <div className="space-y-4 p-5 bg-white rounded-3xl border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">Ecwid → Square Catalog</h2>
            <p className="text-[9px] font-bold text-gray-500 mt-1">One-way sync for enabled Ecwid products only</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => ecwidSquareSyncMutation.mutate({ dryRun: true })}
              disabled={ecwidSquareSyncMutation.isPending}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-gray-700 disabled:opacity-50"
            >
              Dry Run
            </button>
            <button
              onClick={() => ecwidSquareSyncMutation.mutate({ dryRun: false, batchSize: 200 })}
              disabled={ecwidSquareSyncMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-white shadow-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${ecwidSquareSyncMutation.isPending ? 'animate-spin' : ''}`} />
              {ecwidSquareSyncMutation.isPending ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
        </div>

        {ecwidSquareSyncMutation.isSuccess && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-green-50 border border-green-200 rounded-2xl space-y-2">
            <div className="text-[10px] font-black text-green-700 uppercase tracking-widest">
              {ecwidSquareSyncMutation.data?.dryRun ? 'Dry run completed' : 'Sync completed'}
            </div>
            {counts && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[9px] font-bold text-green-800 uppercase tracking-wide">
                <div>Ecwid total: {counts.ecwidTotal}</div>
                <div>Enabled: {counts.ecwidEnabled}</div>
                <div>Skipped disabled: {counts.skippedDisabled}</div>
                <div>Square upserts: {counts.upsertedObjectCount}</div>
              </div>
            )}
            {typeof ecwidSquareSyncMutation.data?.batchSizeUsed === 'number' && (
              <div className="text-[9px] font-bold text-green-800 uppercase tracking-wide">Batch size used: {ecwidSquareSyncMutation.data.batchSizeUsed}</div>
            )}
          </motion.div>
        )}

        {ecwidSquareSyncMutation.isError && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-red-50 border border-red-200 rounded-2xl">
            <div className="text-[10px] font-black text-red-700 uppercase tracking-widest">
              {(ecwidSquareSyncMutation.error as Error)?.message || 'Sync failed'}
            </div>
          </motion.div>
        )}
      </div>

      <div className="space-y-4 p-5 bg-white rounded-3xl border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">Orders Exceptions Integrity</h2>
            <p className="text-[9px] font-bold text-gray-500 mt-1">Match exceptions to orders by shipping tracking and clear resolved exceptions</p>
          </div>
          <button
            onClick={() => exceptionsSyncMutation.mutate()}
            disabled={exceptionsSyncMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-white shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${exceptionsSyncMutation.isPending ? 'animate-spin' : ''}`} />
            {exceptionsSyncMutation.isPending ? 'Checking...' : 'Sync Exceptions'}
          </button>
        </div>

        {exceptionsSyncMutation.isSuccess && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-green-50 border border-green-200 rounded-2xl">
            <div className="text-[10px] font-black text-green-700 uppercase tracking-widest">
              Scanned: {exceptionsSyncMutation.data?.scanned || 0} • Matched: {exceptionsSyncMutation.data?.matched || 0} • Cleared: {exceptionsSyncMutation.data?.deleted || 0}
            </div>
          </motion.div>
        )}

        {exceptionsSyncMutation.isError && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-red-50 border border-red-200 rounded-2xl">
            <div className="text-[10px] font-black text-red-700 uppercase tracking-widest">
              {(exceptionsSyncMutation.error as Error)?.message || 'Exceptions sync failed'}
            </div>
          </motion.div>
        )}
      </div>

      <EbayManagement />
    </div>
  );
}
