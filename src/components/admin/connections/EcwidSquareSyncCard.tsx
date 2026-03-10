'use client';

import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { RefreshCw } from '@/components/Icons';

export function EcwidSquareSyncCard() {
  const syncMutation = useMutation({
    mutationFn: async ({ dryRun = false, batchSize }: { dryRun?: boolean; batchSize?: number }) => {
      const res = await fetch('/api/ecwid-square/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun, batchSize }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || data?.message || `Sync failed (HTTP ${res.status})`);
      return data;
    },
  });

  const counts = syncMutation.data?.counts;

  return (
    <div className="space-y-4 p-5 bg-white rounded-3xl border border-gray-200 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">Ecwid to Square Catalog</h2>
          <p className="text-[9px] font-bold text-gray-500 mt-1">One-way sync for enabled Ecwid products only</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => syncMutation.mutate({ dryRun: true })}
            disabled={syncMutation.isPending}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-gray-700 disabled:opacity-50"
          >
            Dry Run
          </button>
          <button
            onClick={() => syncMutation.mutate({ dryRun: false, batchSize: 200 })}
            disabled={syncMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-white shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
            {syncMutation.isPending ? 'Running...' : 'Run Now'}
          </button>
        </div>
      </div>

      {syncMutation.isSuccess && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-green-50 border border-green-200 rounded-2xl space-y-2">
          <div className="text-[10px] font-black text-green-700 uppercase tracking-widest">
            {syncMutation.data?.dryRun ? 'Dry run completed' : 'Sync completed'}
          </div>
          {counts && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[9px] font-bold text-green-800 uppercase tracking-wide">
              <div>Ecwid total: {counts.ecwidTotal}</div>
              <div>Enabled: {counts.ecwidEnabled}</div>
              <div>Skipped disabled: {counts.skippedDisabled}</div>
              <div>Square upserts: {counts.upsertedObjectCount}</div>
            </div>
          )}
          {typeof syncMutation.data?.batchSizeUsed === 'number' && (
            <div className="text-[9px] font-bold text-green-800 uppercase tracking-wide">Batch size used: {syncMutation.data.batchSizeUsed}</div>
          )}
        </motion.div>
      )}

      {syncMutation.isError && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-red-50 border border-red-200 rounded-2xl">
          <div className="text-[10px] font-black text-red-700 uppercase tracking-widest">
            {(syncMutation.error as Error)?.message || 'Sync failed'}
          </div>
        </motion.div>
      )}
    </div>
  );
}
