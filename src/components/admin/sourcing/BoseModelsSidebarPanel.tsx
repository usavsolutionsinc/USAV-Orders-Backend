'use client';

/**
 * Sidebar for /admin?section=bose_models — picker for the Bose model catalog.
 *
 * URL-state contract:
 *   ?search=<q>   — search box value
 *   ?model=<id>   — selected model id (read by the main pane); 'new' = create form
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import {
  AdminSidebarShell,
  AdminPickerRow,
  useAdminUrlState,
} from '../shared';

interface BoseModelListRow {
  id: number;
  model_number: string;
  model_name: string;
  family: string | null;
  compat_count: number;
}

export function BoseModelsSidebarPanel() {
  const { searchParams, setParam } = useAdminUrlState();
  const search = searchParams.get('search') ?? '';
  const selected = searchParams.get('model') ?? '';

  const { data, isLoading } = useQuery<{ items: BoseModelListRow[] }>({
    queryKey: qk.boseModels.list(search, ''),
    queryFn: async () => {
      const q = search.trim();
      const url = q ? `/api/bose-models?q=${encodeURIComponent(q)}` : '/api/bose-models';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch Bose models');
      return res.json();
    },
  });

  const rows = useMemo(() => data?.items ?? [], [data]);

  return (
    <AdminSidebarShell
      search={{
        value: search,
        onChange: (v) =>
          setParam((p) => {
            if (v.trim()) p.set('search', v.trim());
            else p.delete('search');
          }),
        onClear: () => setParam((p) => p.delete('search')),
        placeholder: 'Search model number or name',
        variant: 'blue',
      }}
      action={
        <button
          type="button"
          onClick={() => setParam((p) => p.set('model', 'new'))}
          className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 bg-white px-2 py-1.5 text-caption font-semibold text-gray-700 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
          Add model
        </button>
      }
    >
      {isLoading ? (
        <div className="px-2 py-6 text-center text-xs text-gray-400">Loading models…</div>
      ) : rows.length === 0 ? (
        <div className="px-2 py-6 text-center text-xs text-gray-400">No Bose models yet.</div>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li key={row.id}>
              <AdminPickerRow
                selected={selected === String(row.id)}
                onPick={() => setParam((p) => p.set('model', String(row.id)))}
                title={row.model_name}
                subtitle={row.family ? `${row.model_number} · ${row.family}` : row.model_number}
                trailing={
                  <span
                    title={`${row.compat_count} compatible part${row.compat_count === 1 ? '' : 's'}`}
                    className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600"
                  >
                    {row.compat_count}
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </AdminSidebarShell>
  );
}
