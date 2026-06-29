import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { Button } from '@/design-system/primitives/Button';
import { AlertCircle, Sparkles } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import {
  jsonFetch,
  formatCents,
  severityTone,
  ALERT_TYPE_LABEL,
  DEMAND_SOURCE_LABEL,
  demandSourceTone,
} from '../sourcing-shared';
import type { AlertRow, Candidate, SourcingResearchResponse } from './sourcing-workspace-types';
import { ResearchPanel } from './ResearchPanel';
import { Centered, Empty } from './WorkspaceShared';

/** Queue — prioritized demand list (EOL/low-stock/replenish) with resolve/dismiss. */
export function QueuePane() {
  const searchParams = useSearchParams();
  const status = searchParams.get('status') ?? '';
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ items: AlertRow[] }>({
    queryKey: qk.sourcing.alerts(status || 'live'),
    queryFn: () => jsonFetch(`/api/sourcing/alerts${status ? `?status=${status}` : ''}`),
  });

  const patch = useMutation({
    mutationFn: (vars: { id: number; status: string; reason?: string }) =>
      jsonFetch('/api/sourcing/alerts', { method: 'PATCH', body: JSON.stringify(vars) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.sourcing.all }),
  });

  // Set the per-SKU replenish price point (the watcher alerts below it).
  const setTargetMut = useMutation({
    mutationFn: (vars: { skuId: number; cents: number | null }) =>
      jsonFetch(`/api/sku-catalog/${vars.skuId}`, { method: 'PATCH', body: JSON.stringify({ replenishTargetCents: vars.cents }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.sourcing.all }),
  });
  const setTarget = (a: AlertRow) => {
    if (a.sku_id == null) return; // replenish rows always have a SKU; guard for the nullable type
    const cur = a.replenish_target_cents != null ? (a.replenish_target_cents / 100).toFixed(2) : '';
    const input = window.prompt(`Target price (USD) for ${a.product_title ?? a.sku ?? 'this SKU'} — alert when a listing lands below this:`, cur);
    if (input == null) return;
    const dollars = Number(input.trim());
    if (!Number.isFinite(dollars) || dollars < 0) return;
    setTargetMut.mutate({ skuId: a.sku_id, cents: Math.round(dollars * 100) });
  };

  const rows = useMemo(() => data?.items ?? [], [data]);
  if (isLoading) return <Centered>Loading queue…</Centered>;
  if (rows.length === 0) return <Empty icon={<AlertCircle className="h-6 w-6" />} title="Nothing to source" hint="The nightly scan queues EOL / low-stock / no-stock items, plus anything sold that needs replenishing. The queue is clear right now." />;

  const close = (id: number, next: 'resolved' | 'dismissed') => {
    const reason = window.prompt(`Reason to ${next === 'resolved' ? 'resolve' : 'dismiss'} this alert?`);
    if (reason?.trim()) patch.mutate({ id, status: next, reason: reason.trim() });
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-xl font-bold text-gray-900">Sourcing queue <span className="text-gray-400">({rows.length})</span></h1>
      <ul className="space-y-2">
        {rows.map((a) => (
          <QueueAlertRow key={a.id} alert={a} patchStatus={(status) => patch.mutate({ id: a.id, status })} setTarget={setTarget} close={close} />
        ))}
      </ul>
    </div>
  );
}

function QueueAlertRow({
  alert,
  patchStatus,
  setTarget,
  close,
}: {
  alert: AlertRow;
  patchStatus: (status: string) => void;
  setTarget: (alert: AlertRow) => void;
  close: (id: number, next: 'resolved' | 'dismissed') => void;
}) {
  const queryClient = useQueryClient();
  const [researchResult, setResearchResult] = useState<SourcingResearchResponse | null>(null);
  const query = alert.search_query ?? alert.product_title ?? alert.sku ?? '';

  const research = useMutation({
    mutationFn: () =>
      jsonFetch('/api/sourcing/research', {
        method: 'POST',
        body: JSON.stringify({ query, skuId: alert.sku_id ?? undefined, sourcingAlertId: alert.id, maxPriceCents: alert.replenish_target_cents ?? undefined, limit: 12 }),
      }) as Promise<SourcingResearchResponse>,
    onSuccess: (body) => setResearchResult(body),
  });

  const save = useMutation({
    mutationFn: (c: Candidate) =>
      jsonFetch('/api/sourcing/candidates', {
        method: 'POST',
        body: JSON.stringify({
          source: 'ebay', externalId: c.externalId, title: c.title, url: c.url, imageUrl: c.imageUrl,
          condition: c.condition, priceCents: c.priceCents, shippingCents: c.shippingCents,
          currency: c.currency, sellerName: c.sellerName, skuId: alert.sku_id ?? null, sourcingAlertId: alert.id,
          raw: (c.raw as Record<string, unknown>) ?? null,
        }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.sourcing.all }),
  });

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-center gap-3">
        <span className={`rounded-full px-2 py-0.5 text-micro font-bold uppercase ring-1 ${severityTone[alert.severity] ?? severityTone.info}`}>{alert.severity}</span>
        <span className={`rounded-full px-2 py-0.5 text-micro font-semibold ${demandSourceTone[alert.demand_source] ?? demandSourceTone.scan}`}>{DEMAND_SOURCE_LABEL[alert.demand_source] ?? alert.demand_source}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">
            {alert.product_title ?? alert.sku ?? alert.search_query ?? (alert.sku_id ? `SKU #${alert.sku_id}` : 'Untitled demand')}
            {alert.target_qty && alert.target_qty > 1 ? <span className="ml-1 text-caption font-normal text-gray-400">× {alert.target_qty}</span> : null}
          </p>
          <p className="truncate text-caption text-gray-500">
            {ALERT_TYPE_LABEL[alert.alert_type] ?? alert.alert_type}{alert.model_name ? ` · ${alert.model_name}` : ''}{alert.reason ? ` · ${alert.reason}` : ''}
          </p>
        </div>
        {alert.alert_type === 'replenish' ? (
          <HoverTooltip label="Set the replenish price point for this SKU" asChild>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setTarget(alert)}
              className="rounded-full bg-indigo-50 text-micro font-semibold text-indigo-700 hover:bg-indigo-100"
            >
              {alert.replenish_target_cents != null ? `Target ${formatCents(alert.replenish_target_cents)}` : 'Set target'}
            </Button>
          </HoverTooltip>
        ) : null}
        <Button variant="secondary" size="sm" icon={<Sparkles className="h-3.5 w-3.5" />} loading={research.isPending} disabled={!query.trim()} onClick={() => research.mutate()}>
          Research
        </Button>
        {alert.status === 'open' ? (
          <Button variant="secondary" size="sm" onClick={() => patchStatus('sourcing')}>Start sourcing</Button>
        ) : <span className="rounded-full bg-blue-50 px-2 py-0.5 text-micro font-semibold text-blue-700">{alert.status}</span>}
        <button type="button" onClick={() => close(alert.id, 'resolved')} className="ds-raw-button rounded-md px-2 py-1 text-caption font-semibold text-emerald-700 hover:bg-emerald-50">Resolve</button>
        <Button variant="ghost" size="sm" onClick={() => close(alert.id, 'dismissed')} className="text-caption font-semibold text-gray-500">Dismiss</Button>
      </div>

      {researchResult ? (
        <ResearchPanel research={researchResult.research} candidates={researchResult.results} onSave={(candidate) => save.mutate(candidate)} saving={save.isPending} />
      ) : null}
      {research.isError ? <p className="mt-2 text-caption text-red-600">{(research.error as Error).message}</p> : null}
    </li>
  );
}
