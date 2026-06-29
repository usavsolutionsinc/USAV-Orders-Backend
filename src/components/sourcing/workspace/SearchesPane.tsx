import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { Button } from '@/design-system/primitives/Button';
import { Clock } from '@/components/Icons';
import { jsonFetch, CADENCE_LABEL, cadenceTone } from '../sourcing-shared';
import type { SavedSearch } from './sourcing-workspace-types';
import { Centered, Empty } from './WorkspaceShared';

/** Standing searches — the scour watcher re-runs these to auto-fill the watchlist. */
export function SearchesPane() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [cadence, setCadence] = useState('daily');

  const { data, isLoading } = useQuery<{ items: SavedSearch[] }>({
    queryKey: qk.sourcing.savedSearches('all'),
    queryFn: () => jsonFetch('/api/sourcing/saved-searches?active=false'),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.sourcing.all });

  const create = useMutation({
    mutationFn: (vars: { query: string; cadence: string }) => jsonFetch('/api/sourcing/saved-searches', { method: 'POST', body: JSON.stringify(vars) }),
    onSuccess: () => { setQuery(''); invalidate(); },
  });
  const patch = useMutation({
    mutationFn: (vars: { id: number; cadence?: string; isActive?: boolean }) =>
      jsonFetch(`/api/sourcing/saved-searches/${vars.id}`, { method: 'PATCH', body: JSON.stringify({ cadence: vars.cadence, isActive: vars.isActive }) }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => jsonFetch(`/api/sourcing/saved-searches/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  const run = useMutation({
    mutationFn: (id: number) => jsonFetch(`/api/sourcing/saved-searches/${id}/run`, { method: 'POST' }),
    onSuccess: invalidate,
  });

  const rows = useMemo(() => data?.items ?? [], [data]);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-xl font-bold text-gray-900">Standing searches <span className="text-gray-400">({rows.length})</span></h1>

      {/* Create */}
      <form
        className="mb-5 flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-3"
        onSubmit={(e) => { e.preventDefault(); if (query.trim()) create.mutate({ query: query.trim(), cadence }); }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What to watch for, e.g. “SoundLink Mini battery”"
          className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
        />
        <select value={cadence} onChange={(e) => setCadence(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-700 focus:border-blue-400 focus:outline-none">
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="off">Manual</option>
        </select>
        <Button type="submit" variant="primary" size="sm" loading={create.isPending} disabled={!query.trim()}>Add</Button>
      </form>

      {isLoading ? (
        <Centered>Loading searches…</Centered>
      ) : rows.length === 0 ? (
        <Empty icon={<Clock className="h-6 w-6" />} title="No standing searches" hint="Add one above to have the scour watcher re-run it daily/weekly and auto-fill the watchlist." />
      ) : (
        <ul className="space-y-2">
          {rows.map((s) => (
            <li key={s.id} className={`flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 ${s.is_active ? '' : 'opacity-60'}`}>
              <span className={`rounded-full px-2 py-0.5 text-micro font-semibold ${cadenceTone[s.cadence] ?? cadenceTone.off}`}>{CADENCE_LABEL[s.cadence] ?? s.cadence}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900">{s.label || s.query}</p>
                <p className="truncate text-caption text-gray-500">
                  {s.product_title ?? s.sku ?? s.query}
                  {s.last_run_at ? ` · last run ${new Date(s.last_run_at).toLocaleDateString()}${s.last_hit_count != null ? ` · ${s.last_hit_count} hit${s.last_hit_count === 1 ? '' : 's'}` : ''}` : ' · never run'}
                </p>
              </div>
              <Button variant="secondary" size="sm" loading={run.isPending} onClick={() => run.mutate(s.id)}>Run now</Button>
              {s.is_active && s.cadence !== 'off' ? (
                <Button variant="ghost" size="sm" type="button" onClick={() => patch.mutate({ id: s.id, cadence: 'off' })}>Pause</Button>
              ) : (
                <Button variant="ghost" size="sm" type="button" onClick={() => patch.mutate({ id: s.id, isActive: true, cadence: 'daily' })} className="text-emerald-700 hover:bg-emerald-50 hover:text-emerald-700">Resume</Button>
              )}
              <Button variant="ghost" size="sm" type="button" onClick={() => remove.mutate(s.id)}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
