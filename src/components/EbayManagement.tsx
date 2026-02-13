'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Search } from '@/components/Icons';
import { useState } from 'react';

interface EbayAccount {
  id: number;
  account_name: string;
  last_sync_date: string | null;
  is_active: boolean;
  token_expires_at: string;
}

interface EbayOrder {
  id: number;
  order_id: string;
  product_title: string;
  sku: string;
  account_source: string;
  order_date: string;
  shipping_tracking_number: string | null;
}

export default function EbayManagement() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAccount, setSelectedAccount] = useState<string>('');

  // Fetch accounts
  const { data: accountsData, isLoading: accountsLoading } = useQuery({
    queryKey: ['ebay-accounts'],
    queryFn: async () => {
      const res = await fetch('/api/ebay/accounts');
      if (!res.ok) throw new Error('Failed to fetch accounts');
      return res.json();
    },
  });

  // Fetch eBay orders with search
  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ['ebay-orders', searchQuery, selectedAccount],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.append('q', searchQuery);
      if (selectedAccount) params.append('account', selectedAccount);
      
      const res = await fetch(`/api/ebay/search?${params}`);
      if (!res.ok) throw new Error('Failed to fetch orders');
      return res.json();
    },
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/ebay/sync', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to sync');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ebay-orders'] });
      queryClient.invalidateQueries({ queryKey: ['ebay-accounts'] });
    },
  });

  // Token refresh mutation
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
  const orders: EbayOrder[] = ordersData?.orders || [];

  return (
    <div className="space-y-6">
      {/* Header with Sync Button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">
            eBay Orders Management
          </h2>
          <p className="text-[9px] font-bold text-gray-500 mt-1">
            Multi-account order synchronization
          </p>
        </div>
        <button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest text-white shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
          {syncMutation.isPending ? 'Syncing...' : 'Sync All'}
        </button>
      </div>

      {/* Sync Results */}
      {syncMutation.isSuccess && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-2xl">
          <div className="text-[10px] font-black text-green-700 uppercase tracking-widest">
            {syncMutation.data.message}
          </div>
        </div>
      )}

      {syncMutation.isError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl">
          <div className="text-[10px] font-black text-red-700 uppercase tracking-widest">
            Sync failed - check console for details
          </div>
        </div>
      )}

      {/* Account Status Cards */}
      {accountsLoading ? (
        <div className="text-sm text-gray-400">Loading accounts...</div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-1 no-scrollbar">
          {accounts.map((account) => {
            const lastSyncDate = account.last_sync_date 
              ? new Date(account.last_sync_date)
              : null;
            const tokenExpiry = new Date(account.token_expires_at);
            const now = new Date();
            const isTokenExpired = tokenExpiry < now;
            const tokenExpiresInMinutes = Math.floor((tokenExpiry.getTime() - now.getTime()) / 1000 / 60);

            return (
              <div key={account.id} className="p-4 bg-white rounded-2xl border border-gray-200 min-w-[280px] flex-shrink-0">
                <div className="flex items-start justify-between mb-2">
                  <div className="text-sm font-black text-gray-900">{account.account_name}</div>
                  <div className={`px-2 py-1 rounded text-[8px] font-bold ${
                    account.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {account.is_active ? 'ACTIVE' : 'INACTIVE'}
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="text-[9px] text-gray-500">
                    {lastSyncDate
                      ? `Last sync: ${lastSyncDate.toLocaleString()}`
                      : 'Never synced'}
                  </div>
                  
                  <div className="text-[9px] text-gray-500">
                    Token expires: {isTokenExpired ? (
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
                      {refreshTokenMutation.isPending ? '⟳ Refreshing...' : '🔄 Refresh Token'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Search Bar */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by order ID, SKU, product, tracking..."
            className="w-full pl-11 pr-4 py-3 bg-white border border-gray-200 rounded-2xl text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        <select
          value={selectedAccount}
          onChange={(e) => setSelectedAccount(e.target.value)}
          className="px-4 py-3 bg-white border border-gray-200 rounded-2xl text-sm font-bold outline-none focus:border-blue-500"
        >
          <option value="">All Accounts</option>
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.account_name}>{acc.account_name}</option>
          ))}
        </select>
      </div>

      {/* Orders List */}
      <div className="grid gap-3">
        {ordersLoading ? (
          <div className="p-8 text-center bg-white rounded-3xl border border-gray-200">
            <p className="text-sm text-gray-400">Loading orders...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center bg-white rounded-3xl border border-gray-200">
            <p className="text-sm font-bold text-gray-400 uppercase">
              {searchQuery || selectedAccount ? 'No matching orders found' : 'No eBay orders yet - click "Sync All" to start'}
            </p>
          </div>
        ) : (
          <>
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-2">
              {orders.length} order{orders.length !== 1 ? 's' : ''} found
            </div>
            {orders.map((order) => (
              <div key={order.id} className="p-5 rounded-3xl bg-white border border-gray-200 hover:shadow-sm transition-all">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-base font-black text-gray-900">{order.product_title}</h3>
                      <span className="px-2 py-1 rounded-lg text-[8px] font-bold bg-purple-100 text-purple-700">
                        {order.account_source}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-[9px] font-bold text-gray-500 uppercase">
                      <div>
                        <span className="text-gray-400">Order ID:</span>{' '}
                        <a 
                          href={`https://www.ebay.com/sh/ord/details?orderid=${order.order_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 underline"
                        >
                          {order.order_id}
                        </a>
                      </div>
                      <div>
                        <span className="text-gray-400">SKU:</span> {order.sku || 'N/A'}
                      </div>
                      <div>
                        <span className="text-gray-400">Date:</span>{' '}
                        {order.order_date ? new Date(order.order_date).toLocaleDateString() : 'N/A'}
                      </div>
                      {order.shipping_tracking_number && (
                        <div>
                          <span className="text-gray-400">Tracking:</span>{' '}
                          <span className="font-mono">{order.shipping_tracking_number}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 items-end">
                    <a
                      href={`https://www.ebay.com/sh/ord/details?orderid=${order.order_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1 rounded-xl text-[8px] font-black uppercase bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                    >
                      View on eBay →
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
