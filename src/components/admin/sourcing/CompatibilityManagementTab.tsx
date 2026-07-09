'use client';

/**
 * Main pane for /admin?section=compatibility — a flat audit table of
 * model ↔ part compatibility edges, optionally filtered to one model via
 * ?boseModelId. Per-model editing lives in the Bose Models section; this view
 * is the cross-cutting "what's linked to what" table with inline delete.
 */

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { AdminEmptyDetail } from '../shared';
import { Layers } from '@/components/Icons';
import { Button } from '@/design-system/primitives';

interface EdgeRow {
  id: number;
  bose_model_id: number;
  sku_id: number;
  part_role: string;
  is_oem: boolean;
  fit: string;
  confidence: string;
  source: string;
  model_number: string;
  model_name: string;
  sku: string;
  product_title: string;
}

async function jsonFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body;
}

export function CompatibilityManagementTab() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const boseModelId = searchParams.get('boseModelId') ?? '';

  const queryKey = boseModelId
    ? qk.partCompatibility.forModel(Number(boseModelId))
    : qk.partCompatibility.all;

  const { data, isLoading } = useQuery<{ items: EdgeRow[] }>({
    queryKey,
    queryFn: () =>
      jsonFetch(boseModelId ? `/api/part-compatibility?boseModelId=${boseModelId}` : '/api/part-compatibility'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => jsonFetch(`/api/part-compatibility/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.partCompatibility.all });
      queryClient.invalidateQueries({ queryKey: qk.boseModels.all });
    },
  });

  const rows = useMemo(() => data?.items ?? [], [data]);

  if (isLoading) return <div className="p-6 text-sm text-text-faint">Loading edges…</div>;
  if (rows.length === 0) {
    return (
      <AdminEmptyDetail
        icon={<Layers className="h-6 w-6" />}
        title="No compatibility edges"
        hint="Link parts to models in the Bose Models section, then audit them here."
      />
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-4xl">
        <h2 className="mb-4 text-lg font-bold text-text-default">
          Compatibility edges <span className="text-text-faint">({rows.length})</span>
        </h2>
        <div className="overflow-hidden rounded-xl border border-border-soft bg-surface-card">
          <table className="w-full text-sm">
            <thead className="bg-surface-canvas text-caption uppercase tracking-wide text-text-soft">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Model</th>
                <th className="px-4 py-2 text-left font-semibold">Part</th>
                <th className="px-4 py-2 text-left font-semibold">Role</th>
                <th className="px-4 py-2 text-left font-semibold">Fit</th>
                <th className="px-4 py-2 text-left font-semibold">Source</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border-hairline">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-hover">
                  <td className="px-4 py-2">
                    <div className="font-semibold text-text-default">{r.model_name}</div>
                    <div className="text-caption text-text-soft">{r.model_number}</div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="font-semibold text-text-default">{r.product_title}</div>
                    <div className="text-caption text-text-soft">{r.sku}</div>
                  </td>
                  <td className="px-4 py-2 text-text-muted">{r.part_role}</td>
                  <td className="px-4 py-2">
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-micro font-semibold text-text-muted">
                      {r.is_oem ? 'OEM ' : ''}{r.fit}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-caption text-text-soft">{r.source}</td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => remove.mutate(r.id)}
                      className="text-rose-600 hover:text-rose-700"
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
