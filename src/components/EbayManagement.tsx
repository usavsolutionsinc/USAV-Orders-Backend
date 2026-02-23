'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from '@/components/Icons';
import { formatDateTimePST } from '@/lib/timezone';

interface EbayAccount {
  id: number;
  account_name: string;
  last_sync_date: string | null;
  is_active: boolean;
  token_expires_at: string;
}

export default function EbayManagement() {
  const queryClient = useQueryClient();

  const { data: accountsData, isLoading: accountsLoading } = useQuery({
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

  return (
    <div className="space-y-4 p-5 bg-white rounded-3xl border border-gray-200 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">eBay Integration</h2>
          <p className="text-[9px] font-bold text-gray-500 mt-1">Manual sync and account token health</p>
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

      {accountsLoading ? (
        <div className="text-sm text-gray-400">Loading accounts...</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {accounts.map((account) => {
            const lastSyncDate = account.last_sync_date ? new Date(account.last_sync_date) : null;
            const tokenExpiry = new Date(account.token_expires_at);
            const now = new Date();
            const isTokenExpired = tokenExpiry < now;
            const tokenExpiresInMinutes = Math.floor((tokenExpiry.getTime() - now.getTime()) / 1000 / 60);

            return (
              <div key={account.id} className="p-4 bg-gray-50 rounded-2xl border border-gray-200">
                <div className="flex items-start justify-between mb-2">
                  <div className="text-sm font-black text-gray-900">{account.account_name}</div>
                  <div
                    className={`px-2 py-1 rounded text-[8px] font-bold ${
                      account.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {account.is_active ? 'ACTIVE' : 'INACTIVE'}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-[9px] text-gray-500">
                    {lastSyncDate ? `Last sync: ${formatDateTimePST(lastSyncDate)}` : 'Never synced'}
                  </div>

                  <div className="text-[9px] text-gray-500">
                    Token expires:{' '}
                    {isTokenExpired ? (
                      <span className="text-red-600 font-bold">Expired</span>
                    ) : (
                      <span className={tokenExpiresInMinutes < 30 ? 'text-orange-600 font-bold' : ''}>
                        {tokenExpiresInMinutes < 60 ? `${tokenExpiresInMinutes}m` : `${Math.floor(tokenExpiresInMinutes / 60)}h`}
                      </span>
                    )}
                  </div>

                  {(isTokenExpired || tokenExpiresInMinutes < 30) && (
                    <button
                      onClick={() => refreshTokenMutation.mutate(account.account_name)}
                      disabled={refreshTokenMutation.isPending}
                      className="w-full text-[9px] font-bold px-2 py-1 rounded bg-orange-100 text-orange-700 hover:bg-orange-200 transition-colors disabled:opacity-50"
                    >
                      {refreshTokenMutation.isPending ? 'Refreshing...' : 'Refresh Token'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
