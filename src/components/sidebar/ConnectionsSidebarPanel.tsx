'use client';

import type { ReactNode } from 'react';
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from '@/components/Icons';

type LogStatus = 'success' | 'error' | 'info';

export interface ConnectionLogEntryInput {
  group: string;
  title: string;
  detail: string;
  status: LogStatus;
}

interface EbayAccount {
  id: number;
  account_name: string;
  token_expires_at: string;
}

function emitConnectionsLog(entry: ConnectionLogEntryInput) {
  window.dispatchEvent(new CustomEvent('admin-connections-log', { detail: entry }));
}

function SidebarSection({
  title,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-gray-200 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between border-b border-gray-200 px-0 py-0 text-left hover:bg-gray-50"
      >
        <span className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.24em] text-gray-500">{title}</span>
        <span className="inline-flex h-full w-12 items-center justify-center border-l border-gray-200 text-gray-600">
          <span className="relative h-3.5 w-3.5">
            <span className="absolute left-0 top-1/2 h-px w-3.5 -translate-y-1/2 bg-current" />
            <motion.span
              initial={false}
              animate={{ scaleY: expanded ? 0 : 1, opacity: expanded ? 0 : 1 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              className="absolute left-1/2 top-0 h-3.5 w-px -translate-x-1/2 bg-current origin-center"
            />
          </span>
        </span>
      </button>
      {expanded && <div className="bg-white">{children}</div>}
    </section>
  );
}

function LineItem({
  label,
  detail,
  right,
}: {
  label: string;
  detail?: string;
  right: ReactNode;
}) {
  return (
    <div className="flex items-stretch justify-between gap-3 border-b border-gray-200 bg-white">
      <div className="min-w-0 px-4 py-3">
        <p className="text-[11px] font-black tracking-widest text-gray-900">{label}</p>
        {detail ? <p className="mt-0.5 text-[10px] font-bold leading-relaxed text-gray-500">{detail}</p> : null}
      </div>
      <div className="flex shrink-0 items-stretch gap-0">{right}</div>
    </div>
  );
}

function ActionButton({
  onClick,
  loading,
  title,
  tone = 'default',
  disabled,
}: {
  onClick: () => void;
  loading?: boolean;
  title: string;
  tone?: 'default' | 'blue' | 'green' | 'indigo';
  disabled?: boolean;
}) {
  const toneClass =
    tone === 'blue'
      ? 'border-blue-300 bg-blue-50 text-blue-700'
      : tone === 'green'
        ? 'border-green-300 bg-green-50 text-green-700'
        : tone === 'indigo'
          ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
          : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex h-full w-12 items-center justify-center border-l transition-colors disabled:opacity-50 ${toneClass}`}
      title={title}
      aria-label={title}
    >
      <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
    </button>
  );
}

export function ConnectionsSidebarPanel() {
  const queryClient = useQueryClient();
  const [showOrders, setShowOrders] = useState(true);
  const [showZoho, setShowZoho] = useState(false);
  const [showBackfill, setShowBackfill] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [showShipping, setShowShipping] = useState(true);
  const [purchaseReceiveId, setPurchaseReceiveId] = useState('');
  const shipStationFileInputRef = useRef<HTMLInputElement>(null);

  const { data: accountsData } = useQuery({
    queryKey: ['ebay-accounts'],
    queryFn: async () => {
      const res = await fetch('/api/ebay/accounts');
      if (!res.ok) throw new Error('Failed to fetch accounts');
      return res.json();
    },
  });

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
      queryClient.invalidateQueries({ queryKey: ['ebay-accounts'] });
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
      queryClient.invalidateQueries({ queryKey: ['ebay-accounts'] });
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

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <input
        ref={shipStationFileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => handleShipStationFileChange(e.target.files?.[0] || null)}
      />
      <div className="flex-1 overflow-y-auto">
        <SidebarSection title="Orders" expanded={showOrders} onToggle={() => setShowOrders((v) => !v)}>
          <LineItem label="Run Full Order Sync" detail="Run eBay sync, Ecwid exception sync, then clear resolved exceptions" right={<ActionButton onClick={() => fullIntegrityMutation.mutate()} loading={fullIntegrityMutation.isPending} title="Run full order sync" tone="green" />} />
          <LineItem label="Sync eBay Orders" detail="Pull eBay changes and reconcile order exceptions" right={<ActionButton onClick={() => ebaySyncMutation.mutate()} loading={ebaySyncMutation.isPending} title="Sync eBay orders" tone="blue" />} />
          <LineItem label="Sync Ecwid Exceptions" detail="Copy tracking updates onto open Ecwid exceptions" right={<ActionButton onClick={() => ecwidExceptionTrackingMutation.mutate()} loading={ecwidExceptionTrackingMutation.isPending} title="Sync Ecwid exceptions" tone="blue" />} />
          <LineItem label="Clear Resolved Exceptions" detail="Remove exception rows that no longer need attention" right={<ActionButton onClick={() => exceptionsSyncMutation.mutate()} loading={exceptionsSyncMutation.isPending} title="Clear resolved exceptions" tone="green" />} />
          <LineItem label="Upload ShipStation CSV" detail="Import a local ShipStation export" right={<button type="button" onClick={() => shipStationFileInputRef.current?.click()} className="h-full w-12 border-l border-gray-200 text-[10px] font-black uppercase tracking-widest text-gray-700 hover:bg-gray-100">Up</button>} />
          {tokenAccounts.map((account) => {
            const minutesLeft = Math.floor((new Date(account.token_expires_at).getTime() - now.getTime()) / 60000);
            const isRefreshing = refreshTokenMutation.isPending && refreshTokenMutation.variables === account.account_name;
            return (
              <LineItem
                key={account.id}
                label={account.account_name}
                detail={minutesLeft <= 0 ? 'Token expired' : `Token expires in ${minutesLeft} min`}
                right={<ActionButton onClick={() => refreshTokenMutation.mutate(account.account_name)} loading={isRefreshing} title={`Refresh ${account.account_name}`} />}
              />
            );
          })}
        </SidebarSection>

        <SidebarSection title="Zoho" expanded={showZoho} onToggle={() => setShowZoho((v) => !v)}>
          <div className="border-b border-gray-200 bg-white px-4 py-3">
            <Link
              href="/admin?section=connections&page=zoho-management"
              className="inline-flex border-b border-gray-900 py-1 text-[10px] font-black uppercase tracking-widest text-gray-900"
            >
              Open Zoho Tools
            </Link>
          </div>
          <LineItem label="Refresh Token" detail="Refresh the Zoho auth token before syncing" right={<ActionButton onClick={() => zohoRefreshMutation.mutate()} loading={zohoRefreshMutation.isPending} title="Refresh Zoho token" />} />
          <LineItem label="Sync Expected POs" detail="Load expected inbound lines before receiving starts" right={<ActionButton onClick={() => zohoSyncMutation.mutate()} loading={zohoSyncMutation.isPending} title="Sync Zoho purchase orders" tone="green" />} />
          <div className="border-b border-gray-200 bg-white px-4 py-3">
            <p className="text-[11px] font-black tracking-widest text-gray-900">Import One Purchase Receive</p>
            <div className="mt-2 flex items-stretch gap-0 border border-gray-200">
              <input
                value={purchaseReceiveId}
                onChange={(e) => setPurchaseReceiveId(e.target.value)}
                placeholder="Paste purchase receive ID"
                className="flex-1 bg-gray-50 px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-900 outline-none"
              />
              <button
                type="button"
                onClick={() => zohoImportOneMutation.mutate(purchaseReceiveId.trim())}
                disabled={!purchaseReceiveId.trim() || zohoImportOneMutation.isPending}
                className="w-12 border-l border-blue-300 bg-blue-50 text-[10px] font-black uppercase tracking-widest text-blue-700 disabled:opacity-50"
              >
                {zohoImportOneMutation.isPending ? '...' : 'Run'}
              </button>
            </div>
          </div>
        </SidebarSection>

        <SidebarSection title="Backfill" expanded={showBackfill} onToggle={() => setShowBackfill((v) => !v)}>
          <LineItem label="Backfill eBay Orders" detail="Fill only missing order fields from eBay" right={<ActionButton onClick={() => ebayBackfillMutation.mutate()} loading={ebayBackfillMutation.isPending} title="Backfill eBay orders" tone="indigo" />} />
          <LineItem label="Backfill Ecwid Orders" detail="Fill only missing order fields from Ecwid" right={<ActionButton onClick={() => ecwidBackfillMutation.mutate()} loading={ecwidBackfillMutation.isPending} title="Backfill Ecwid orders" tone="indigo" />} />
        </SidebarSection>

        <SidebarSection title="Catalog" expanded={showCatalog} onToggle={() => setShowCatalog((v) => !v)}>
          <LineItem label="Preview Ecwid to Square Sync" detail="See what the enabled product sync would change" right={<ActionButton onClick={() => ecwidSquareSyncMutation.mutate({ dryRun: true })} loading={ecwidSquareSyncMutation.isPending && ecwidSquareSyncMutation.variables?.dryRun === true} title="Preview Ecwid to Square sync" />} />
          <LineItem label="Run Ecwid to Square Sync" detail="Push enabled Ecwid products into Square" right={<ActionButton onClick={() => ecwidSquareSyncMutation.mutate({ dryRun: false })} loading={ecwidSquareSyncMutation.isPending && ecwidSquareSyncMutation.variables?.dryRun === false} title="Run Ecwid to Square sync" tone="blue" />} />
        </SidebarSection>

        <SidebarSection title="Shipping Tracking" expanded={showShipping} onToggle={() => setShowShipping((v) => !v)}>
          {(['USPS', 'UPS', 'FEDEX'] as const).map((carrier) => {
            const isSyncing = carrierSyncMutation.isPending && carrierSyncMutation.variables === carrier;
            return (
              <LineItem
                key={carrier}
                label={carrier}
                detail="Run due tracking updates for this carrier"
                right={<ActionButton onClick={() => carrierSyncMutation.mutate(carrier)} loading={isSyncing} title={`Sync ${carrier}`} tone="blue" />}
              />
            );
          })}
        </SidebarSection>
      </div>
    </div>
  );
}
