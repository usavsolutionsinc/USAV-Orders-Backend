'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from '@/components/Icons';

interface EbayAccount {
  id: number;
  account_name: string;
  token_expires_at: string;
}

export default function EbayManagement() {
  const queryClient = useQueryClient();
  const { data: accountsData } = useQuery({
    queryKey: ['ebay-accounts'],
    queryFn: async () => {
      const res = await fetch('/api/ebay/accounts');
      if (!res.ok) throw new Error('Failed to fetch accounts');
      return res.json();
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/ebay/sync', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to sync');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ebay-accounts'] });
    },
  });
  const refreshTokenMutation = useMutation({
    mutationFn: async (accountName: string) => {
      const res = await fetch('/api/ebay/refresh-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountName }),
      });
      if (!res.ok) throw new Error('Failed to refresh token');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ebay-accounts'] });
    },
  });

  const accounts: EbayAccount[] = accountsData?.accounts || [];
  const now = new Date();
  const tokenAccounts = accounts.filter((account) => {
    const expiresAt = new Date(account.token_expires_at);
    const minutesLeft = Math.floor((expiresAt.getTime() - now.getTime()) / 1000 / 60);
    return minutesLeft < 30;
  });
  const activeRefreshAccount = refreshTokenMutation.isPending ? (refreshTokenMutation.variables as string | undefined) : undefined;

  return (
    <div className="space-y-4 p-5 bg-white rounded-3xl border border-gray-200 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">eBay Integration</h2>
        </div>
        <button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-white shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
          {syncMutation.isPending ? 'Syncing...' : 'Sync eBay'}
        </button>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap">
        <div className="text-[9px] font-bold uppercase tracking-widest text-gray-500">Token Refresh</div>
        {tokenAccounts.length === 0 ? (
          <div className="text-[9px] font-bold uppercase tracking-widest text-green-700 bg-green-50 border border-green-200 rounded-lg px-2 py-1">
            All Tokens Healthy
          </div>
        ) : (
          tokenAccounts.map((account) => {
            const expiresAt = new Date(account.token_expires_at);
            const minutesLeft = Math.floor((expiresAt.getTime() - now.getTime()) / 1000 / 60);
            const isExpired = minutesLeft <= 0;
            const isRefreshing = activeRefreshAccount === account.account_name;

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

      {syncMutation.isSuccess && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-2xl">
          <div className="text-[10px] font-black text-green-700 uppercase tracking-widest">
            {syncMutation.data?.message || 'Sync completed'}
          </div>
        </div>
      )}

      {syncMutation.isError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl">
          <div className="text-[10px] font-black text-red-700 uppercase tracking-widest">Sync failed</div>
        </div>
      )}

      {refreshTokenMutation.isSuccess && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-2xl">
          <div className="text-[10px] font-black text-green-700 uppercase tracking-widest">
            {refreshTokenMutation.data?.message || 'Token refreshed'}
          </div>
        </div>
      )}

      {refreshTokenMutation.isError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-2xl">
          <div className="text-[10px] font-black text-red-700 uppercase tracking-widest">Token refresh failed</div>
        </div>
      )}
    </div>
  );
}
