'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { RefreshCw } from '@/components/Icons';

export function ZohoSyncCard({ embedded = false }: { embedded?: boolean }) {
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [purchaseReceiveId, setPurchaseReceiveId] = useState('');

  const zohoRefreshMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/zoho/refresh-token', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || data?.message || `Zoho refresh failed (HTTP ${res.status})`);
      return data;
    },
  });

  const zohoSyncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/zoho/purchase-orders/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ per_page: 200, max_pages: 5, max_items: 800, days_back: 30 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || data?.message || `Zoho sync failed (HTTP ${res.status})`);
      return data;
    },
  });

  const zohoImportOneMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch('/api/zoho/purchase-receives/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchase_receive_id: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || data?.message || `Zoho import failed (HTTP ${res.status})`);
      return data;
    },
  });

  const handleRefresh = async () => {
    setStatus(null);
    try {
      const data = await zohoRefreshMutation.mutateAsync();
      setStatus({ type: 'success', message: data?.message || 'Zoho token refresh completed successfully.' });
    } catch (error: any) {
      setStatus({ type: 'error', message: error?.message || 'Zoho token refresh failed' });
    }
  };

  const handleSync = async () => {
    setStatus(null);
    try {
      const data = await zohoSyncMutation.mutateAsync();
      setStatus({
        type: 'success',
        message: `Zoho sync completed. Processed ${data?.totals?.processed || 0}, line items ${data?.totals?.line_items_synced || 0}, created ${data?.totals?.created || 0}, updated ${data?.totals?.updated || 0}, failed ${data?.totals?.failed || 0}.`,
      });
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch (error: any) {
      setStatus({ type: 'error', message: error?.message || 'Zoho sync failed' });
    }
  };

  const handleImportOne = async () => {
    const id = purchaseReceiveId.trim();
    if (!id) return;
    setStatus(null);
    try {
      const data = await zohoImportOneMutation.mutateAsync(id);
      setStatus({
        type: 'success',
        message: `Zoho receive ${data?.purchase_receive_id || id} imported. Receiving #${data?.receiving_id || '-'} with ${data?.line_items_imported || 0} line item(s).`,
      });
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch (error: any) {
      setStatus({ type: 'error', message: error?.message || 'Zoho single import failed' });
    }
  };

  const anyPending = zohoRefreshMutation.isPending || zohoSyncMutation.isPending || zohoImportOneMutation.isPending;

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-4 border border-gray-200 bg-white p-5'}>
      <div className={`flex items-center justify-between gap-3 ${embedded ? 'border-b border-gray-200 pb-3' : ''}`}>
        <div>
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">Zoho Receiving Sync</h2>
          <p className="text-[9px] font-bold text-gray-500 mt-1">Refresh Zoho token, then sync expected PO lines into receiving_lines before physical scans link them</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleRefresh()}
            disabled={anyPending}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-gray-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${zohoRefreshMutation.isPending ? 'animate-spin' : ''}`} />
            {zohoRefreshMutation.isPending ? 'Refreshing...' : 'Refresh Token'}
          </button>
          <button
            onClick={() => void handleSync()}
            disabled={anyPending}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-white shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${zohoSyncMutation.isPending ? 'animate-spin' : ''}`} />
            {zohoSyncMutation.isPending ? 'Syncing...' : 'Sync Expected POs'}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={purchaseReceiveId}
          onChange={(e) => setPurchaseReceiveId(e.target.value)}
          placeholder="Purchase Receive ID"
          className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-900 outline-none focus:border-emerald-500"
        />
        <button
          onClick={() => void handleImportOne()}
          disabled={!purchaseReceiveId.trim() || anyPending}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-white shadow-sm disabled:opacity-50"
        >
          {zohoImportOneMutation.isPending ? 'Importing...' : 'Import One'}
        </button>
      </div>

      {status && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`border-l-2 px-4 py-3 text-[10px] font-black uppercase tracking-widest ${
            status.type === 'success' ? 'border-l-green-500 bg-green-50/70 text-green-700' : 'border-l-red-500 bg-red-50/70 text-red-700'
          }`}
        >
          {status.message}
        </motion.div>
      )}
    </div>
  );
}
