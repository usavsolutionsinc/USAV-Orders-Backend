'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { RefreshCw, ShieldCheck } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { sectionLabel, fieldLabel } from '@/design-system/tokens/typography/presets';

interface EbayAccount {
  id: number;
  account_name: string;
  token_expires_at: string;
  platform?: string | null;
  is_active?: boolean;
}

type LogEntry = { id: number; text: string; type: 'success' | 'error'; ts: number };

export function AwaitingEbayPanel({ onRefresh }: { onRefresh?: () => void }) {
  const queryClient = useQueryClient();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);

  const addLog = (text: string, type: 'success' | 'error') => {
    const id = ++logIdRef.current;
    setLogs((prev) => [{ id, text, type, ts: Date.now() }, ...prev].slice(0, 12));
  };

  const { data: accountsData } = useQuery({
    queryKey: qk.ebayAccounts,
    queryFn: async () => {
      const res = await fetch('/api/ebay/accounts');
      if (!res.ok) throw new Error('Failed to fetch accounts');
      return res.json();
    },
  });

  const ebayAccounts: EbayAccount[] = (accountsData?.accounts || []).filter(
    (a: EbayAccount) => (a.platform === 'EBAY' || !a.platform) && a.is_active !== false
  );

  const now = new Date();
  const expiredAccounts = ebayAccounts.filter((a) => {
    const minutesLeft = Math.floor((new Date(a.token_expires_at).getTime() - now.getTime()) / 60000);
    return minutesLeft <= 0;
  });

  const refreshTokenMutation = useMutation({
    mutationFn: async (accountName: string) => {
      const res = await fetch('/api/ebay/refresh-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || data?.message || 'Refresh failed');
      return { accountName, data };
    },
    onSuccess: ({ accountName }) => {
      queryClient.invalidateQueries({ queryKey: qk.ebayAccounts });
      addLog(`Token refreshed: ${accountName}`, 'success');
      onRefresh?.();
    },
    onError: (error: Error, accountName) => {
      addLog(`${accountName}: ${error.message}`, 'error');
    },
  });

  const ebayBackfillMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/orders/backfill/ebay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 500 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || data?.message || 'Backfill failed');
      return data;
    },
    onSuccess: (data) => {
      const t = data?.totals || {};
      addLog(
        `eBay: ${t.updated ?? 0} updated, ${t.unchanged ?? 0} complete, ${t.deletedDuplicates ?? 0} dupes removed`,
        'success'
      );
      onRefresh?.();
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    },
    onError: (error: Error) => {
      addLog(`eBay sync: ${error.message}`, 'error');
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
      if (!res.ok) throw new Error(data?.error || data?.message || 'Backfill failed');
      return data;
    },
    onSuccess: (data) => {
      const t = data?.totals || {};
      addLog(`Ecwid: ${t.updated ?? 0} updated, ${t.matched ?? 0} matched`, 'success');
      onRefresh?.();
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    },
    onError: (error: Error) => {
      addLog(`Ecwid sync: ${error.message}`, 'error');
    },
  });

  const integrityCheckMutation = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const res = await fetch('/api/orders/integrity-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || data?.message || 'Integrity check failed');
      return data;
    },
    onSuccess: (data) => {
      const deleted = data?.deleted ?? data?.wouldDelete ?? 0;
      const groups = data?.duplicateGroups ?? 0;
      if (deleted > 0 || groups > 0) {
        addLog(
          data?.dryRun
            ? `Integrity: ${groups} duplicate group(s), ${deleted} row(s) would be removed`
            : `Integrity: removed ${deleted} duplicate(s) from ${groups} group(s)`,
          'success'
        );
      } else {
        addLog('Integrity: no duplicates found', 'success');
      }
      onRefresh?.();
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    },
    onError: (error: Error) => {
      addLog(`Integrity check: ${error.message}`, 'error');
    },
  });

  const hasValidEbayToken = ebayAccounts.length > 0 && expiredAccounts.length < ebayAccounts.length;
  const ebayDisabled = !hasValidEbayToken;

  return (
    <div className="mt-4 space-y-0">
      <p className={`${sectionLabel} mb-2`}>
        Sync & Backfill
      </p>

      {expiredAccounts.map((account) => {
        const isRefreshing =
          refreshTokenMutation.isPending && refreshTokenMutation.variables === account.account_name;
        return (
          <div
            key={account.id}
            className="flex items-center justify-between border-b border-border-hairline py-2.5"
          >
            <span className={`${fieldLabel} truncate pr-2`}>
              {account.account_name} (expired)
            </span>
            <Button
              variant="primary"
              size="sm"
              icon={<RefreshCw />}
              loading={isRefreshing}
              onClick={() => refreshTokenMutation.mutate(account.account_name)}
              className="shrink-0 bg-amber-600 hover:bg-amber-700"
            >
              Refresh
            </Button>
          </div>
        );
      })}

      <div className="flex items-center justify-between border-b border-border-hairline py-2.5">
        <span className={`${fieldLabel} truncate pr-2`}>Sync eBay orders</span>
        <Button
          variant="primary"
          size="sm"
          icon={<RefreshCw />}
          loading={ebayBackfillMutation.isPending}
          disabled={ebayDisabled}
          onClick={() => ebayBackfillMutation.mutate()}
          className="shrink-0 bg-amber-600 hover:bg-amber-700"
        >
          Run
        </Button>
      </div>

      <div className="flex items-center justify-between border-b border-border-hairline py-2.5">
        <span className={`${fieldLabel} truncate pr-2`}>Sync Ecwid orders</span>
        <Button
          variant="primary"
          size="sm"
          icon={<RefreshCw />}
          loading={ecwidBackfillMutation.isPending}
          onClick={() => ecwidBackfillMutation.mutate()}
          className="shrink-0 bg-indigo-600 hover:bg-indigo-700"
        >
          Run
        </Button>
      </div>

      <div className="flex items-center justify-between border-b border-border-hairline py-2.5">
        <span className={`${fieldLabel} truncate pr-2`}>Check Integrity</span>
        <HoverTooltip label="Deduplicate orders by unique (order_id, tracking). Keeps most complete row per group." asChild>
          <Button
            variant="primary"
            size="sm"
            icon={<ShieldCheck className={integrityCheckMutation.isPending ? 'animate-pulse' : ''} />}
            onClick={() => integrityCheckMutation.mutate(false)}
            disabled={integrityCheckMutation.isPending}
            className="shrink-0 bg-gray-600 hover:bg-gray-700"
          >
            Run
          </Button>
        </HoverTooltip>
      </div>

      {logs.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border-soft">
          <p className={`${sectionLabel} mb-1.5`}>
            Recent
          </p>
          <div className="space-y-1 max-h-24 overflow-y-auto">
            {logs.map((log) => (
              <p
                key={log.id}
                className={`text-micro font-medium leading-tight ${
                  log.type === 'success' ? 'text-emerald-700' : 'text-red-600'
                }`}
              >
                {log.text}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
