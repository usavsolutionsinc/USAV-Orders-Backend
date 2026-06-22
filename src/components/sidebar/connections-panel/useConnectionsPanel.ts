'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import {
  emitConnectionsLog,
  type AmazonAccountRow,
  type EbayAccount,
} from './connections-shared';

/**
 * Owns the connections admin panel: the section expand/input state, the eBay +
 * Amazon account queries, and every integration mutation (eBay/Ecwid/exceptions
 * sync + full-integrity run, Zoho refresh/sync/import, eBay/Ecwid backfill,
 * Ecwid→Square catalog sync, carrier tracking, Amazon health/sync/connect/
 * disconnect, ShipStation CSV upload). Each fires an `admin-connections-log`
 * window event on success/failure. Returns a controller bag the sections render.
 */
export function useConnectionsPanel() {
  const queryClient = useQueryClient();
  const [showOrders, setShowOrders] = useState(true);
  const [showZoho, setShowZoho] = useState(false);
  const [showBackfill, setShowBackfill] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [showShipping, setShowShipping] = useState(true);
  const [showAmazon, setShowAmazon] = useState(false);
  const [purchaseReceiveId, setPurchaseReceiveId] = useState('');
  const [amazonRefreshToken, setAmazonRefreshToken] = useState('');
  const [amazonSellerId, setAmazonSellerId] = useState('');
  const [amazonRegion, setAmazonRegion] = useState<'NA' | 'EU' | 'FE'>('NA');
  const shipStationFileInputRef = useRef<HTMLInputElement>(null);

  const { data: accountsData } = useQuery({
    queryKey: qk.ebayAccounts,
    queryFn: async () => {
      const res = await fetch('/api/ebay/accounts');
      if (!res.ok) throw new Error('Failed to fetch accounts');
      return res.json();
    },
  });

  const { data: amazonAccountsData } = useQuery({
    queryKey: qk.amazonAccounts,
    queryFn: async () => {
      const res = await fetch('/api/amazon/accounts');
      if (!res.ok) throw new Error('Failed to fetch Amazon accounts');
      return res.json();
    },
  });
  const amazonAccounts: AmazonAccountRow[] = amazonAccountsData?.accounts || [];

  const now = useMemo(() => new Date(), []);
  const tokenAccounts: EbayAccount[] = (accountsData?.accounts || []).filter((account: EbayAccount) => {
    const minutesLeft = Math.floor((new Date(account.token_expires_at).getTime() - now.getTime()) / 60000);
    return minutesLeft < 30;
  });

  const logSuccess = (group: string, title: string, detail: string) => emitConnectionsLog({ group, title, detail, status: 'success' });
  const logError = (group: string, title: string, detail: string) => emitConnectionsLog({ group, title, detail, status: 'error' });

  const ebaySyncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/ebay/sync?reconcileExceptions=true', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || data?.message || `Sync failed (HTTP ${res.status})`);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: qk.ebayAccounts });
      logSuccess('Orders', 'eBay Sync', `Created ${data?.totals?.createdOrders || 0}, deleted exceptions ${data?.totals?.deletedExceptions || 0}.`);
    },
    onError: (error: any) => logError('Orders', 'eBay Sync', error?.message || 'eBay sync failed'),
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
      return { accountName, data };
    },
    onSuccess: ({ accountName, data }) => {
      queryClient.invalidateQueries({ queryKey: qk.ebayAccounts });
      logSuccess('Orders', `Token Refresh: ${accountName}`, data?.message || 'Token refreshed.');
    },
    onError: (error: any, accountName) => logError('Orders', `Token Refresh: ${accountName}`, error?.message || 'Token refresh failed'),
  });

  const exceptionsSyncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/orders-exceptions/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || data?.message || `Sync failed (HTTP ${res.status})`);
      return data;
    },
    onSuccess: (data) => logSuccess('Orders', 'Exceptions Sync', `Cleared ${data?.deleted || 0} exception record(s).`),
    onError: (error: any) => logError('Orders', 'Exceptions Sync', error?.message || 'Exceptions sync failed'),
  });

  const ecwidExceptionTrackingMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/ecwid/sync-exception-tracking', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || data?.message || `Sync failed (HTTP ${res.status})`);
      return data;
    },
    onSuccess: (data) => logSuccess('Orders', 'Ecwid Exception Sync', `Updated ${data?.updated || 0}, deleted ${data?.deleted || 0}.`),
    onError: (error: any) => logError('Orders', 'Ecwid Exception Sync', error?.message || 'Ecwid exception sync failed'),
  });

  const fullIntegrityMutation = useMutation({
    mutationFn: async () => {
      const ebayData = await ebaySyncMutation.mutateAsync();
      const ecwidData = await ecwidExceptionTrackingMutation.mutateAsync();
      const exceptionsData = await exceptionsSyncMutation.mutateAsync();
      return { ebayData, ecwidData, exceptionsData };
    },
    onSuccess: ({ ebayData, ecwidData, exceptionsData }) => {
      logSuccess('Orders', 'Full Integrity Run', `eBay created ${ebayData?.totals?.createdOrders || 0}, Ecwid updated ${ecwidData?.updated || 0}, exceptions cleared ${exceptionsData?.deleted || 0}.`);
    },
    onError: (error: any) => logError('Orders', 'Full Integrity Run', error?.message || 'Full integrity sync failed'),
  });

  const zohoRefreshMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/zoho/refresh-token', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || data?.message || `Zoho refresh failed (HTTP ${res.status})`);
      return data;
    },
    onSuccess: (data) => logSuccess('Zoho', 'Zoho Token Refresh', data?.message || 'Zoho token refreshed.'),
    onError: (error: any) => logError('Zoho', 'Zoho Token Refresh', error?.message || 'Zoho token refresh failed'),
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
    onSuccess: (data) => logSuccess('Zoho', 'Zoho Sync', `Processed ${data?.totals?.processed || 0}, line items ${data?.totals?.line_items_synced || 0}, failures ${data?.totals?.failed || 0}.`),
    onError: (error: any) => logError('Zoho', 'Zoho Sync', error?.message || 'Zoho sync failed'),
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
      return { id, data };
    },
    onSuccess: ({ id, data }) => logSuccess('Zoho', `Import ${id}`, `Receiving #${data?.receiving_id || '-'} with ${data?.line_items_imported || 0} line item(s).`),
    onError: (error: any, id) => logError('Zoho', `Import ${id}`, error?.message || 'Zoho import failed'),
  });

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
    onSuccess: (data) => logSuccess('Backfill', 'eBay Backfill', `Updated ${data?.totals?.updated || 0}, matched ${data?.totals?.matched || 0}.`),
    onError: (error: any) => logError('Backfill', 'eBay Backfill', error?.message || 'eBay backfill failed'),
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
    onSuccess: (data) => logSuccess('Backfill', 'Ecwid Backfill', `Updated ${data?.totals?.updated || 0}, matched ${data?.totals?.matched || 0}.`),
    onError: (error: any) => logError('Backfill', 'Ecwid Backfill', error?.message || 'Ecwid backfill failed'),
  });

  const ecwidSquareSyncMutation = useMutation({
    mutationFn: async ({ dryRun }: { dryRun: boolean }) => {
      const res = await fetch('/api/ecwid-square/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun, batchSize: dryRun ? undefined : 200 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || data?.message || `Sync failed (HTTP ${res.status})`);
      return { dryRun, data };
    },
    onSuccess: ({ dryRun, data }) => {
      const counts = data?.counts || {};
      logSuccess('Catalog', dryRun ? 'Ecwid -> Square Dry Run' : 'Ecwid -> Square Sync', `Ecwid total ${counts.ecwidTotal || 0}, enabled ${counts.ecwidEnabled || 0}, upserts ${counts.upsertedObjectCount || 0}.`);
    },
    onError: (error: any, vars) => logError('Catalog', vars?.dryRun ? 'Ecwid -> Square Dry Run' : 'Ecwid -> Square Sync', error?.message || 'Catalog sync failed'),
  });

  const carrierSyncMutation = useMutation({
    mutationFn: async (carrier: 'USPS' | 'UPS' | 'FEDEX') => {
      const res = await fetch('/api/shipping/track/sync-due', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carrier, limit: 100, concurrency: 5 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `Failed to sync ${carrier}`);
      return { carrier, data };
    },
    onSuccess: ({ carrier, data }) => logSuccess('Shipping', `${carrier} Sync`, `Synced ${data?.synced ?? 0}, terminal ${data?.terminal ?? 0}, errors ${data?.errors ?? 0}.`),
    onError: (error: any, carrier) => logError('Shipping', `${carrier} Sync`, error?.message || 'Carrier sync failed'),
  });

  const amazonHealthMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/amazon/health');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Health check failed (HTTP ${res.status})`);
      return data;
    },
    onSuccess: (data) => {
      const accounts = data?.accounts || [];
      if (accounts.length === 0) {
        logSuccess('Amazon', 'Connection Check', 'No Amazon accounts connected yet.');
      } else if (data?.ok) {
        logSuccess('Amazon', 'Connection Check', `All ${accounts.length} account(s) healthy.`);
      } else {
        const okCount = accounts.filter((a: any) => a.ok).length;
        const firstErr = accounts.find((a: any) => !a.ok)?.error || '';
        logError('Amazon', 'Connection Check', `${okCount}/${accounts.length} healthy. ${firstErr}`);
      }
    },
    onError: (error: any) => logError('Amazon', 'Connection Check', error?.message || 'Health check failed'),
  });

  const amazonSyncMutation = useMutation({
    mutationFn: async (all: boolean) => {
      const res = await fetch(`/api/amazon/sync${all ? '?all=1' : ''}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Sync failed (HTTP ${res.status})`);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: qk.amazonAccounts });
      const t = data?.totals || {};
      logSuccess('Amazon', 'Order Sync', `Imported ${t.imported || 0}, updated ${t.updated || 0}, FBA ${t.fbaReadOnly || 0}, skipped-untracked ${t.skippedUntracked || 0}.`);
    },
    onError: (error: any) => logError('Amazon', 'Order Sync', error?.message || 'Order sync failed'),
  });

  const amazonConnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/amazon/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refreshToken: amazonRefreshToken.trim(),
          sellerId: amazonSellerId.trim() || undefined,
          region: amazonRegion,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || data?.detail || `Connect failed (HTTP ${res.status})`);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: qk.amazonAccounts });
      setAmazonRefreshToken('');
      setAmazonSellerId('');
      logSuccess('Amazon', 'Connect', `Connected ${data?.accountName || 'account'} (${(data?.marketplaces || []).length} marketplace(s)).`);
    },
    onError: (error: any) => logError('Amazon', 'Connect', error?.message || 'Connect failed'),
  });

  const amazonDisconnectMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/amazon/accounts?id=${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Disconnect failed (HTTP ${res.status})`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.amazonAccounts });
      logSuccess('Amazon', 'Disconnect', 'Account disconnected.');
    },
    onError: (error: any) => logError('Amazon', 'Disconnect', error?.message || 'Disconnect failed'),
  });

  const handleShipStationFileChange = async (file: File | null) => {
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/google-sheets/sync-shipstation-orders', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || data?.message || 'ShipStation upload failed');
      logSuccess('Orders', 'ShipStation Upload', data?.message || 'ShipStation upload completed.');
    } catch (error: any) {
      logError('Orders', 'ShipStation Upload', error?.message || 'ShipStation upload failed');
    } finally {
      if (shipStationFileInputRef.current) shipStationFileInputRef.current.value = '';
    }
  };

  return {
    showOrders, setShowOrders,
    showZoho, setShowZoho,
    showBackfill, setShowBackfill,
    showCatalog, setShowCatalog,
    showShipping, setShowShipping,
    showAmazon, setShowAmazon,
    purchaseReceiveId, setPurchaseReceiveId,
    amazonRefreshToken, setAmazonRefreshToken,
    amazonSellerId, setAmazonSellerId,
    amazonRegion, setAmazonRegion,
    shipStationFileInputRef,
    now,
    tokenAccounts,
    amazonAccounts,
    fullIntegrityMutation,
    ebaySyncMutation,
    ecwidExceptionTrackingMutation,
    exceptionsSyncMutation,
    refreshTokenMutation,
    zohoRefreshMutation,
    zohoSyncMutation,
    zohoImportOneMutation,
    ebayBackfillMutation,
    ecwidBackfillMutation,
    ecwidSquareSyncMutation,
    carrierSyncMutation,
    amazonHealthMutation,
    amazonSyncMutation,
    amazonConnectMutation,
    amazonDisconnectMutation,
    handleShipStationFileChange,
  };
}

export type ConnectionsPanelController = ReturnType<typeof useConnectionsPanel>;
