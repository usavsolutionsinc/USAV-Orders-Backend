'use client';

/**
 * Sidebar for /admin?section=compatibility — filter the global compatibility
 * edge table by model.
 *
 * URL-state contract:
 *   ?search=<q>        — search box value (filters the model list)
 *   ?boseModelId=<id>  — selected model filter ('' / absent = all edges)
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

export function CompatibilitySidebarPanel() {
  const { searchParams, setParam } = useAdminUrlState();
  const search = searchParams.get('search') ?? '';
  const selected = searchParams.get('boseModelId') ?? '';

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
        placeholder: 'Filter by model',
        variant: 'blue',
      }}
    >
      <ul className="space-y-1.5">
        <li>
          <AdminPickerRow
            selected={selected === ''}
            onPick={() => setParam((p) => p.delete('boseModelId'))}
            title="All edges"
            subtitle="Every model"
          />
        </li>
        {isLoading ? (
          <li className="px-2 py-6 text-center text-xs text-gray-400">Loading…</li>
        ) : (
          rows.map((row) => (
            <li key={row.id}>
              <AdminPickerRow
                selected={selected === String(row.id)}
                onPick={() => setParam((p) => p.set('boseModelId', String(row.id)))}
                title={row.model_name}
                subtitle={row.model_number}
                trailing={
                  <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-micro font-semibold text-gray-600">
                    {row.compat_count}
                  </span>
                }
              />
            </li>
          ))
        )}
      </ul>
    </AdminSidebarShell>
  );
}
