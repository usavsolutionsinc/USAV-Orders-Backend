import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { Link2 } from '@/components/Icons';
import { jsonFetch, formatCents, SUPPLIER_TYPE_LABEL } from '../sourcing-shared';
import type { SupplierStats } from './sourcing-workspace-types';
import { Centered, Empty } from './WorkspaceShared';

/** Suppliers — read-only rollup of sellers/distributors with spend stats. */
export function SuppliersPane() {
  const searchParams = useSearchParams();
  const q = (searchParams.get('q') ?? '').trim();
  const type = searchParams.get('type') ?? '';

  const { data, isLoading } = useQuery<{ items: SupplierStats[] }>({
    queryKey: qk.suppliers.list(`stats:${q}`, type || 'all'),
    queryFn: () => {
      const params = new URLSearchParams({ stats: '1' });
      if (q) params.set('q', q);
      if (type) params.set('type', type);
      return jsonFetch(`/api/suppliers?${params.toString()}`);
    },
  });

  const rows = useMemo(() => data?.items ?? [], [data]);
  if (isLoading) return <Centered>Loading suppliers…</Centered>;
  if (rows.length === 0) return <Empty icon={<Link2 className="h-6 w-6" />} title="No suppliers yet" hint="eBay sellers are auto-created when you import a candidate. Add distributors/salvage sources in Admin › Suppliers." />;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-xl font-bold text-gray-900">Suppliers <span className="text-gray-400">({rows.length})</span></h1>
      <ul className="space-y-2">
        {rows.map((s) => (
          <li key={s.id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-gray-900">{s.name}</p>
              <p className="truncate text-caption text-gray-500">
                {SUPPLIER_TYPE_LABEL[s.supplier_type] ?? s.supplier_type}
                {s.lead_time_days != null ? ` · ${s.lead_time_days}d lead` : ''}
                {s.rating != null ? ` · ${s.rating}★` : ''}
                {s.last_ordered_at ? ` · last order ${new Date(s.last_ordered_at).toLocaleDateString()}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-right">
              <Stat label="watch" value={s.candidate_count} />
              <Stat label="acq" value={s.acquisition_count} />
              <div className="w-20">
                <p className="text-sm font-bold text-gray-900">{formatCents(s.spend_cents)}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">spend</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="w-12">
      <p className="text-sm font-bold text-gray-900">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
    </div>
  );
}
