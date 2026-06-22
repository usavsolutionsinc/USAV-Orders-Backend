import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { Button } from '@/design-system/primitives/Button';
import { Search, Sparkles } from '@/components/Icons';
import { SourceThisButton } from '../SourceThisButton';
import { WatchSearchButton } from '../WatchSearchButton';
import { jsonFetch, formatCents, conditionTone } from '../sourcing-shared';
import type { Candidate, CompatiblePart, LookupResult, SourcingResearchResponse } from './sourcing-workspace-types';
import { ResearchPanel } from './ResearchPanel';
import { Centered, Empty } from './WorkspaceShared';

/** Scout — resolve a product/model → compatible parts with stock + market search. */
export function ScoutPane() {
  const searchParams = useSearchParams();
  const q = (searchParams.get('q') ?? '').trim();
  const by = searchParams.get('by') === 'serial' ? 'serial' : 'model';

  const { data, isLoading, isError } = useQuery<LookupResult>({
    queryKey: qk.productModels.lookup(`${by}:${q}`),
    queryFn: () => jsonFetch(`/api/product-models/lookup?${by}=${encodeURIComponent(q)}`),
    enabled: q.length > 0,
  });

  if (!q) {
    return <Empty icon={<Search className="h-6 w-6" />} title="Look up a product" hint="Search by model number or scan a serial in the sidebar to see compatible parts and stock." />;
  }
  if (isLoading) return <Centered>Looking up…</Centered>;
  if (isError) return <Centered>Lookup failed.</Centered>;
  if (!data?.model) return <Empty icon={<Search className="h-6 w-6" />} title={`No model matched “${q}”`} hint="Try the other search mode (serial vs model), or add the model in Admin › Models." />;

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
        <p className="text-caption text-gray-400">No compatible parts linked. Add them in Admin › Models.</p>
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
  const [researchResult, setResearchResult] = useState<SourcingResearchResponse | null>(null);

  const search = useMutation({
    mutationFn: () =>
      jsonFetch('/api/sourcing/search', {
        method: 'POST',
        body: JSON.stringify({ query: part.product_title, partRole: part.part_role, skuId: part.sku_id, boseModelId: modelId }),
      }),
    onSuccess: (body) => setResults(body.results ?? []),
  });
  const research = useMutation({
    mutationFn: () =>
      jsonFetch('/api/sourcing/research', {
        method: 'POST',
        body: JSON.stringify({ query: part.product_title, partRole: part.part_role, skuId: part.sku_id, boseModelId: modelId, limit: 12 }),
      }) as Promise<SourcingResearchResponse>,
    onSuccess: (body) => {
      setResearchResult(body);
      setResults(body.results ?? []);
    },
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
        <Button variant="secondary" size="sm" icon={<Sparkles className="h-3.5 w-3.5" />} loading={research.isPending} onClick={() => research.mutate()}>
          Research
        </Button>
        <SourceThisButton skuId={part.sku_id} boseModelId={modelId} />
        <WatchSearchButton query={part.product_title} skuId={part.sku_id} />
      </div>

      {researchResult ? (
        <ResearchPanel research={researchResult.research} candidates={researchResult.results} onSave={(candidate) => save.mutate(candidate)} saving={save.isPending} />
      ) : null}

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
      {research.isError ? <p className="mt-2 text-caption text-red-600">{(research.error as Error).message}</p> : null}
    </li>
  );
}
