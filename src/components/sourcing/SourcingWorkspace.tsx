'use client';

/**
 * Right pane for /sourcing. Reads ?mode= and renders one of:
 *   - Lookup    — resolve a Bose model (serial/model) → compatible parts with
 *                 live stock + lifecycle badges + one-click eBay search.
 *   - Alerts    — the open sourcing-alert queue with resolve/dismiss/sourcing.
 *   - Watchlist — saved secondary-market candidates with import/reject.
 *
 * The sidebar (SourcingSidebarPanel) owns the search/filter inputs; this pane
 * is the visual display, per the sidebar-mode architecture.
 */

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { Button } from '@/design-system/primitives/Button';
import { Search, AlertCircle, Star } from '@/components/Icons';
import {
  resolveSourcingMode,
  jsonFetch,
  formatCents,
  conditionTone,
  severityTone,
  ALERT_TYPE_LABEL,
} from './sourcing-shared';

// ─── Types (mirror the API responses) ───────────────────────────────────────

interface CompatiblePart {
  compatibility_id: number;
  sku_id: number;
  sku: string;
  product_title: string;
  part_role: string;
  is_oem: boolean;
  fit: string;
  lifecycle_status: string;
  on_hand: number;
  open_alert_count: number;
}
interface LookupResult {
  resolvedBy: 'model_number' | 'serial_prefix' | 'model_name' | null;
  model: { id: number; model_number: string; model_name: string; family: string | null } | null;
  parts: CompatiblePart[];
}
interface Candidate {
  externalId: string | null;
  title: string;
  url: string | null;
  imageUrl: string | null;
  condition: string | null;
  priceCents: number | null;
  shippingCents: number | null;
  currency: string;
  sellerName: string | null;
  raw?: unknown;
}
interface AlertRow {
  id: number;
  sku_id: number;
  alert_type: string;
  severity: string;
  status: string;
  reason: string | null;
  opened_at: string;
  sku: string | null;
  product_title: string | null;
  lifecycle_status: string | null;
  replenish_target_cents: number | null;
  model_name: string | null;
}
interface WatchCandidate {
  id: number;
  sku_id: number | null;
  title: string;
  url: string | null;
  image_url: string | null;
  condition: string | null;
  price_cents: number | null;
  shipping_cents: number | null;
  currency: string;
  seller_name: string | null;
  status: string;
}

export function SourcingWorkspace() {
  const searchParams = useSearchParams();
  const mode = resolveSourcingMode(searchParams.get('mode'));

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      {mode === 'lookup' ? <LookupPane /> : mode === 'alerts' ? <AlertsPane /> : <WatchlistPane />}
    </div>
  );
}

// ─── Lookup ─────────────────────────────────────────────────────────────────

function LookupPane() {
  const searchParams = useSearchParams();
  const q = (searchParams.get('q') ?? '').trim();
  const by = searchParams.get('by') === 'serial' ? 'serial' : 'model';

  const { data, isLoading, isError } = useQuery<LookupResult>({
    queryKey: qk.boseModels.lookup(`${by}:${q}`),
    queryFn: () => jsonFetch(`/api/bose-models/lookup?${by}=${encodeURIComponent(q)}`),
    enabled: q.length > 0,
  });

  if (!q) {
    return <Empty icon={<Search className="h-6 w-6" />} title="Look up a Bose model" hint="Search by model number or scan a serial in the sidebar to see compatible parts and stock." />;
  }
  if (isLoading) return <Centered>Looking up…</Centered>;
  if (isError) return <Centered>Lookup failed.</Centered>;
  if (!data?.model) return <Empty icon={<Search className="h-6 w-6" />} title={`No model matched “${q}”`} hint="Try the other search mode (serial vs model), or add the model in Admin › Bose Models." />;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">{data.model.model_name}</h1>
        <p className="text-caption text-gray-500">
          Model #{data.model.model_number}{data.model.family ? ` · ${data.model.family}` : ''}
          {data.resolvedBy ? <span className="ml-2 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">matched by {data.resolvedBy.replace('_', ' ')}</span> : null}
        </p>
      </header>

      <h2 className="mb-2 text-sm font-bold text-gray-900">Compatible parts ({data.parts.length})</h2>
      {data.parts.length === 0 ? (
        <p className="text-caption text-gray-400">No compatible parts linked. Add them in Admin › Bose Models.</p>
      ) : (
        <ul className="space-y-2">
          {data.parts.map((p) => <PartRow key={p.compatibility_id} part={p} modelId={data.model!.id} />)}
        </ul>
      )}
    </div>
  );
}

function PartRow({ part, modelId }: { part: CompatiblePart; modelId: number }) {
  const queryClient = useQueryClient();
  const [results, setResults] = useState<Candidate[] | null>(null);

  const search = useMutation({
    mutationFn: () =>
      jsonFetch('/api/sourcing/search', {
        method: 'POST',
        body: JSON.stringify({ query: part.product_title, partRole: part.part_role, skuId: part.sku_id, boseModelId: modelId }),
      }),
    onSuccess: (body) => setResults(body.results ?? []),
  });

  const save = useMutation({
    mutationFn: (c: Candidate) =>
      jsonFetch('/api/sourcing/candidates', {
        method: 'POST',
        body: JSON.stringify({
          source: 'ebay', externalId: c.externalId, title: c.title, url: c.url, imageUrl: c.imageUrl,
          condition: c.condition, priceCents: c.priceCents, shippingCents: c.shippingCents,
          currency: c.currency, sellerName: c.sellerName, skuId: part.sku_id, boseModelId: modelId,
          raw: (c.raw as Record<string, unknown>) ?? null,
        }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.sourcing.all }),
  });

  const eol = part.lifecycle_status !== 'active';
  const out = part.on_hand <= 0;

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{part.product_title}</p>
          <p className="truncate text-caption text-gray-500">{part.sku}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">{part.part_role}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${out || (eol && part.on_hand < 2) ? 'bg-red-50 text-red-700' : eol ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
          {out ? '0 in stock' : `${part.on_hand} in stock`}{eol ? ` · ${part.lifecycle_status}` : ''}
        </span>
        <Button variant="secondary" size="sm" loading={search.isPending} onClick={() => search.mutate()}>Find on eBay</Button>
      </div>

      {results ? (
        <div className="mt-3 border-t border-gray-100 pt-3">
          {results.length === 0 ? (
            <p className="text-caption text-gray-400">No eBay results.</p>
          ) : (
            <ul className="space-y-1.5">
              {results.slice(0, 6).map((c, i) => (
                <li key={c.externalId ?? i} className="flex items-center gap-2 text-sm">
                  <a href={c.url ?? '#'} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium text-blue-700 hover:underline">{c.title}</a>
                  {c.condition ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${conditionTone[c.condition] ?? 'bg-gray-100 text-gray-600'}`}>{c.condition.replace('_', ' ')}</span> : null}
                  <span className="w-16 text-right text-caption font-semibold text-gray-700">{formatCents(c.priceCents, c.currency)}</span>
                  <button type="button" onClick={() => save.mutate(c)} className="rounded-md px-2 py-1 text-caption font-semibold text-emerald-700 hover:bg-emerald-50">Save</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {search.isError ? <p className="mt-2 text-caption text-red-600">{(search.error as Error).message}</p> : null}
    </li>
  );
}

// ─── Alerts ─────────────────────────────────────────────────────────────────

function AlertsPane() {
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
    const cur = a.replenish_target_cents != null ? (a.replenish_target_cents / 100).toFixed(2) : '';
    const input = window.prompt(`Target price (USD) for ${a.product_title ?? a.sku ?? 'this SKU'} — alert when a listing lands below this:`, cur);
    if (input == null) return;
    const dollars = Number(input.trim());
    if (!Number.isFinite(dollars) || dollars < 0) return;
    setTargetMut.mutate({ skuId: a.sku_id, cents: Math.round(dollars * 100) });
  };

  const rows = useMemo(() => data?.items ?? [], [data]);
  if (isLoading) return <Centered>Loading alerts…</Centered>;
  if (rows.length === 0) return <Empty icon={<AlertCircle className="h-6 w-6" />} title="No sourcing alerts" hint="The nightly scan opens alerts for EOL / low-stock / no-stock parts. None are open right now." />;

  const close = (id: number, next: 'resolved' | 'dismissed') => {
    const reason = window.prompt(`Reason to ${next === 'resolved' ? 'resolve' : 'dismiss'} this alert?`);
    if (reason?.trim()) patch.mutate({ id, status: next, reason: reason.trim() });
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-xl font-bold text-gray-900">Sourcing alerts <span className="text-gray-400">({rows.length})</span></h1>
      <ul className="space-y-2">
        {rows.map((a) => (
          <li key={a.id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ${severityTone[a.severity] ?? severityTone.info}`}>{a.severity}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-gray-900">{a.product_title ?? a.sku ?? `SKU #${a.sku_id}`}</p>
              <p className="truncate text-caption text-gray-500">
                {ALERT_TYPE_LABEL[a.alert_type] ?? a.alert_type}{a.model_name ? ` · ${a.model_name}` : ''}{a.reason ? ` · ${a.reason}` : ''}
              </p>
            </div>
            {a.alert_type === 'replenish' ? (
              <button
                type="button"
                onClick={() => setTarget(a)}
                title="Set the replenish price point for this SKU"
                className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                {a.replenish_target_cents != null ? `Target ${formatCents(a.replenish_target_cents)}` : 'Set target'}
              </button>
            ) : null}
            {a.status === 'open' ? (
              <Button variant="secondary" size="sm" onClick={() => patch.mutate({ id: a.id, status: 'sourcing' })}>Start sourcing</Button>
            ) : <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">{a.status}</span>}
            <button type="button" onClick={() => close(a.id, 'resolved')} className="rounded-md px-2 py-1 text-caption font-semibold text-emerald-700 hover:bg-emerald-50">Resolve</button>
            <button type="button" onClick={() => close(a.id, 'dismissed')} className="rounded-md px-2 py-1 text-caption font-semibold text-gray-500 hover:bg-gray-100">Dismiss</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Watchlist ──────────────────────────────────────────────────────────────

function WatchlistPane() {
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
  if (rows.length === 0) return <Empty icon={<Star className="h-6 w-6" />} title="Watchlist is empty" hint="Save eBay results from the Lookup tab to track candidates here, then import them into inventory." />;

  const doImport = (c: WatchCandidate) => {
    if (!c.sku_id) { window.alert('This candidate has no linked SKU — link one before importing.'); return; }
    const reason = window.prompt('Reason / note for this import?');
    if (reason?.trim()) importCandidate.mutate({ id: c.id, skuId: c.sku_id, reason: reason.trim() });
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-xl font-bold text-gray-900">Watchlist <span className="text-gray-400">({rows.length})</span></h1>
      <ul className="space-y-2">
        {rows.map((c) => (
          <li key={c.id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3">
            {c.image_url ? <img src={c.image_url} alt="" className="h-10 w-10 rounded object-cover" /> : <div className="h-10 w-10 rounded bg-gray-100" />}
            <div className="min-w-0 flex-1">
              <a href={c.url ?? '#'} target="_blank" rel="noreferrer" className="truncate text-sm font-semibold text-blue-700 hover:underline">{c.title}</a>
              <p className="truncate text-caption text-gray-500">{c.seller_name ?? 'eBay'}{c.condition ? ` · ${c.condition.replace('_', ' ')}` : ''}</p>
            </div>
            <span className="w-16 text-right text-caption font-semibold text-gray-700">{formatCents(c.price_cents, c.currency)}</span>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">{c.status}</span>
            <Button variant="primary" size="sm" loading={importCandidate.isPending} disabled={c.status === 'imported'} onClick={() => doImport(c)}>Import</Button>
            <button type="button" onClick={() => patch.mutate({ id: c.id, status: 'rejected' })} className="rounded-md px-2 py-1 text-caption font-semibold text-gray-500 hover:bg-gray-100">Reject</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Shared bits ────────────────────────────────────────────────────────────

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="p-10 text-center text-sm text-gray-400">{children}</div>;
}

function Empty({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-gray-400 shadow-sm">{icon}</div>
        <p className="text-sm font-bold text-gray-700">{title}</p>
        <p className="text-caption text-gray-500">{hint}</p>
      </div>
    </div>
  );
}
