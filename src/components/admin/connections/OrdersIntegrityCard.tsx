'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { RefreshCw } from '@/components/Icons';

interface EbayAccount {
  id: number;
  account_name: string;
  token_expires_at: string;
}

function StatusBanner({ status }: { status: { type: 'success' | 'error'; message: string } }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border px-4 py-3 text-[10px] font-black uppercase tracking-widest ${
        status.type === 'success'
          ? 'bg-green-50 border-green-200 text-green-700'
          : 'bg-red-50 border-red-200 text-red-700'
      }`}
    >
      {status.message}
    </motion.div>
  );
}

export function OrdersIntegrityCard() {
  const queryClient = useQueryClient();
  const [isShipStationSyncing, setIsShipStationSyncing] = useState(false);
  const [isShipStationInfoOpen, setIsShipStationInfoOpen] = useState(false);
  const [isFullSyncRunning, setIsFullSyncRunning] = useState(false);
  const [integrityStatus, setIntegrityStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [shipStationStatus, setShipStationStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const shipStationFileInputRef = useRef<HTMLInputElement>(null);

  const { data: accountsData } = useQuery({
    queryKey: ['ebay-accounts'],
    queryFn: async () => {
      const res = await fetch('/api/ebay/accounts');
      if (!res.ok) throw new Error('Failed to fetch accounts');
      return res.json();
    },
  });

  const ebaySyncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/ebay/sync?reconcileExceptions=true', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || data?.message || `Sync failed (HTTP ${res.status})`);
      return data;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ebay-accounts'] }); },
  });

  const refreshTokenMutation = useMutation({
    mutationFn: async (accountName: string) => {
      const res = await fetch('/api/ebay/refresh-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || data?.message || `Refresh failed (HTTP ${res.status})`);
      return data;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ebay-accounts'] }); },
  });

  const exceptionsSyncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/orders-exceptions/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || data?.message || `Sync failed (HTTP ${res.status})`);
      return data;
    },
  });

  const ecwidExceptionTrackingMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/ecwid/sync-exception-tracking', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || data?.message || `Sync failed (HTTP ${res.status})`);
      return data;
    },
  });

  const handleRunFullIntegrity = async () => {
    setIsFullSyncRunning(true);
    setIntegrityStatus(null);
    try {
      const ebayData = await ebaySyncMutation.mutateAsync();
      const ecwidData = await ecwidExceptionTrackingMutation.mutateAsync();
      const exceptionsData = await exceptionsSyncMutation.mutateAsync();
      setIntegrityStatus({
        type: 'success',
        message: `Full integrity sync completed. eBay created ${ebayData?.totals?.createdOrders || 0} order(s), deleted ${ebayData?.totals?.deletedExceptions || 0} exception(s). Ecwid updated ${ecwidData?.updated || 0} and deleted ${ecwidData?.deleted || 0}. Exceptions sync cleared ${exceptionsData?.deleted || 0}.`,
      });
    } catch (error: any) {
      setIntegrityStatus({ type: 'error', message: error?.message || 'Full integrity sync failed' });
    } finally {
      setIsFullSyncRunning(false);
    }
  };

  const uploadShipStationFile = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/google-sheets/sync-shipstation-orders', { method: 'POST', body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) throw new Error(data?.error || data?.message || 'ShipStation upload failed');
    window.dispatchEvent(new CustomEvent('dashboard-refresh'));
    return data;
  };

  const handleShipStationFileChange = async (file: File | null) => {
    if (!file) return;
    setIsShipStationSyncing(true);
    setShipStationStatus(null);
    try {
      const data = await uploadShipStationFile(file);
      setShipStationStatus({ type: 'success', message: data.message || 'ShipStation upload completed successfully' });
    } catch (error: any) {
      setShipStationStatus({ type: 'error', message: error?.message || 'ShipStation upload failed' });
    } finally {
      if (shipStationFileInputRef.current) shipStationFileInputRef.current.value = '';
      setIsShipStationSyncing(false);
    }
  };

  const accounts: EbayAccount[] = accountsData?.accounts || [];
  const now = new Date();
  const tokenAccounts = accounts.filter((account) => {
    const minutesLeft = Math.floor((new Date(account.token_expires_at).getTime() - now.getTime()) / 60000);
    return minutesLeft < 30;
  });
  const anyPending = isFullSyncRunning || ebaySyncMutation.isPending || exceptionsSyncMutation.isPending || isShipStationSyncing || ecwidExceptionTrackingMutation.isPending;

  return (
    <div className="space-y-4 px-5 pb-5 pt-0 bg-white rounded-3xl border border-gray-200 shadow-sm">
      <input
        ref={shipStationFileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => handleShipStationFileChange(e.target.files?.[0] || null)}
      />

      <div>
        <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">Orders Integrity</h2>
        <p className="text-[9px] font-bold text-gray-500 mt-1">Primary flow: eBay tracking-match sync, Ecwid exception sync, then exception reconciliation</p>
      </div>

      <div className="overflow-x-auto">
        <div className="flex items-center gap-2 whitespace-nowrap min-w-max w-full">
          <button
            onClick={() => void handleRunFullIntegrity()}
            disabled={anyPending}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-black rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-white shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFullSyncRunning ? 'animate-spin' : ''}`} />
            {isFullSyncRunning ? 'Running...' : 'Run Full Integrity'}
          </button>
          <button
            onClick={() => ebaySyncMutation.mutate()}
            disabled={ebaySyncMutation.isPending || isFullSyncRunning}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-white shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${ebaySyncMutation.isPending ? 'animate-spin' : ''}`} />
            {ebaySyncMutation.isPending ? 'Running...' : 'eBay'}
          </button>
          <button
            onClick={() => ecwidExceptionTrackingMutation.mutate()}
            disabled={ecwidExceptionTrackingMutation.isPending || isFullSyncRunning}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-white shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${ecwidExceptionTrackingMutation.isPending ? 'animate-spin' : ''}`} />
            {ecwidExceptionTrackingMutation.isPending ? 'Running...' : 'Ecwid'}
          </button>
          <button
            onClick={() => exceptionsSyncMutation.mutate()}
            disabled={exceptionsSyncMutation.isPending || isFullSyncRunning}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-white shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${exceptionsSyncMutation.isPending ? 'animate-spin' : ''}`} />
            {exceptionsSyncMutation.isPending ? 'Checking...' : 'Exceptions'}
          </button>
          <button
            onClick={() => setIsShipStationInfoOpen(true)}
            disabled={isShipStationSyncing || isFullSyncRunning}
            className="inline-flex items-center justify-center w-9 h-9 ml-auto border border-green-300 bg-green-50 text-green-700 hover:bg-green-100 rounded-xl transition-all disabled:opacity-50"
            title="ShipStation CSV Upload"
          >
            {isShipStationSyncing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M12 4v12m0-12l-4 4m4-4l4 4" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Token refresh row */}
      <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap">
        <div className="text-[9px] font-bold uppercase tracking-widest text-gray-500">Token Refresh</div>
        {tokenAccounts.length === 0 ? (
          <div className="text-[9px] font-bold uppercase tracking-widest text-green-700 bg-green-50 border border-green-200 rounded-lg px-2 py-1">
            All Tokens Healthy
          </div>
        ) : (
          tokenAccounts.map((account) => {
            const minutesLeft = Math.floor((new Date(account.token_expires_at).getTime() - now.getTime()) / 60000);
            const isExpired = minutesLeft <= 0;
            const isRefreshing = refreshTokenMutation.isPending && refreshTokenMutation.variables === account.account_name;
            return (
              <button
                key={account.id}
                onClick={() => refreshTokenMutation.mutate(account.account_name)}
                disabled={refreshTokenMutation.isPending}
                className="inline-flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-lg border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                {account.account_name}
                <span className="opacity-80">{isExpired ? 'Expired' : `${minutesLeft}m`}</span>
              </button>
            );
          })
        )}
      </div>

      {/* ShipStation modal */}
      {isShipStationInfoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button className="absolute inset-0 bg-black/30" onClick={() => setIsShipStationInfoOpen(false)} aria-label="Close" />
          <div className="relative w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-xl p-5 space-y-4">
            <div>
              <h3 className="text-xs font-black uppercase tracking-widest text-gray-900">ShipStation CSV Upload</h3>
              <p className="text-[10px] font-bold text-gray-600 mt-2">Upload a ShipStation CSV export to import orders and update tracking data. This action requires selecting a local CSV file.</p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setIsShipStationInfoOpen(false)} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-600 bg-gray-100 hover:bg-gray-200">Cancel</button>
              <button
                onClick={() => { setIsShipStationInfoOpen(false); shipStationFileInputRef.current?.click(); }}
                disabled={anyPending}
                className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
              >
                {isShipStationSyncing ? 'Uploading...' : 'Choose CSV'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Result banners */}
      {integrityStatus && <StatusBanner status={integrityStatus} />}

      {ebaySyncMutation.isSuccess && !isFullSyncRunning && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-3 bg-green-50 border border-green-200 rounded-2xl">
          <div className="text-[10px] font-black text-green-700 uppercase tracking-widest">
            eBay: Created {ebaySyncMutation.data?.totals?.createdOrders || 0} • Deleted Exceptions {ebaySyncMutation.data?.totals?.deletedExceptions || 0} • Skipped Existing {ebaySyncMutation.data?.totals?.skippedExistingOrders || 0}
          </div>
        </motion.div>
      )}

      {shipStationStatus && <StatusBanner status={shipStationStatus} />}

      {exceptionsSyncMutation.isSuccess && !isFullSyncRunning && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-3 bg-green-50 border border-green-200 rounded-2xl">
          <div className="text-[10px] font-black text-green-700 uppercase tracking-widest">
            Exceptions: Scanned {exceptionsSyncMutation.data?.scanned || 0} • Matched {exceptionsSyncMutation.data?.matched || 0} • Cleared {exceptionsSyncMutation.data?.deleted || 0}
          </div>
        </motion.div>
      )}

      {ecwidExceptionTrackingMutation.isSuccess && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-3 bg-green-50 border border-green-200 rounded-2xl">
          <div className="text-[10px] font-black text-green-700 uppercase tracking-widest">
            Ecwid Tracking: Scanned {ecwidExceptionTrackingMutation.data?.scanned || 0} • Matched {ecwidExceptionTrackingMutation.data?.matched || 0} • Updated {ecwidExceptionTrackingMutation.data?.updated || 0} • Deleted {ecwidExceptionTrackingMutation.data?.deleted || 0}
          </div>
        </motion.div>
      )}
    </div>
  );
}
