import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { Button } from '@/design-system/primitives/Button';
import { Star } from '@/components/Icons';
import { jsonFetch, formatCents } from '../sourcing-shared';
import type { WatchCandidate } from './sourcing-workspace-types';
import { Centered, Empty } from './WorkspaceShared';

/** Watchlist — saved secondary-market candidates with import/reject. */
export function WatchlistPane() {
  const searchParams = useSearchParams();
  const status = searchParams.get('status') ?? '';
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ items: WatchCandidate[] }>({
    queryKey: ['sourcing', 'watchlist', status || 'all'],
    queryFn: () => jsonFetch(`/api/sourcing/candidates${status ? `?status=${status}` : ''}`),
  });

  const patch = useMutation({
    mutationFn: (vars: { id: number; status: string }) =>
      jsonFetch(`/api/sourcing/candidates/${vars.id}`, { method: 'PATCH', body: JSON.stringify({ status: vars.status }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.sourcing.all }),
  });

  const importCandidate = useMutation({
    mutationFn: (vars: { id: number; skuId: number; reason: string }) =>
      jsonFetch(`/api/sourcing/candidates/${vars.id}/import`, { method: 'POST', body: JSON.stringify({ skuId: vars.skuId, reason: vars.reason }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.sourcing.all }),
  });

  const rows = useMemo(() => data?.items ?? [], [data]);
  if (isLoading) return <Centered>Loading watchlist…</Centered>;
  if (rows.length === 0) return <Empty icon={<Star className="h-6 w-6" />} title="Watchlist is empty" hint="Save results from the Scout tab to track candidates here, then import them into inventory." />;

  const doImport = (c: WatchCandidate) => {
    if (!c.sku_id) { window.alert('This candidate has no linked SKU — link one before importing.'); return; }
    const reason = window.prompt('Reason / note for this import?');
    if (reason?.trim()) importCandidate.mutate({ id: c.id, skuId: c.sku_id, reason: reason.trim() });
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-xl font-bold text-text-default">Watchlist <span className="text-text-faint">({rows.length})</span></h1>
      <ul className="space-y-2">
        {rows.map((c) => (
          <li key={c.id} className="flex items-center gap-3 rounded-xl border border-border-soft bg-surface-card p-3">
            {c.image_url ? <img src={c.image_url} alt="" className="h-10 w-10 rounded object-cover" /> : <div className="h-10 w-10 rounded bg-surface-sunken" />}
            <div className="min-w-0 flex-1">
              <a href={c.url ?? '#'} target="_blank" rel="noreferrer" className="truncate text-sm font-semibold text-blue-700 hover:underline">{c.title}</a>
              <p className="truncate text-caption text-text-soft">{c.seller_name ?? 'eBay'}{c.condition ? ` · ${c.condition.replace('_', ' ')}` : ''}</p>
            </div>
            <span className="w-16 text-right text-caption font-semibold text-text-muted">{formatCents(c.price_cents, c.currency)}</span>
            <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-micro font-semibold text-text-muted">{c.status}</span>
            <Button variant="primary" size="sm" loading={importCandidate.isPending} disabled={c.status === 'imported'} onClick={() => doImport(c)}>Import</Button>
            <Button variant="ghost" size="sm" type="button" onClick={() => patch.mutate({ id: c.id, status: 'rejected' })}>Reject</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
