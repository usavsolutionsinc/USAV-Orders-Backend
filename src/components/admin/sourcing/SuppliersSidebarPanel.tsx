'use client';

/**
 * Sidebar for /admin?section=suppliers — picker for the vendor list.
 *
 * URL-state contract:
 *   ?search=<q>      — search box value
 *   ?supplier=<id>   — selected supplier id ('new' = create form)
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import {
  AdminSidebarShell,
  AdminPickerRow,
  useAdminUrlState,
} from '../shared';

interface SupplierListRow {
  id: number;
  name: string;
  supplier_type: string;
  ebay_seller_id: string | null;
}

export function SuppliersSidebarPanel() {
  const { searchParams, setParam } = useAdminUrlState();
  const search = searchParams.get('search') ?? '';
  const selected = searchParams.get('supplier') ?? '';

  const { data, isLoading } = useQuery<{ items: SupplierListRow[] }>({
    queryKey: qk.suppliers.list(search, ''),
    queryFn: async () => {
      const q = search.trim();
      const url = q ? `/api/suppliers?q=${encodeURIComponent(q)}` : '/api/suppliers';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch suppliers');
      return res.json();
    },
  });

  const rows = useMemo(() => data?.items ?? [], [data]);

  return (
    <AdminSidebarShell
      search={{
        value: search,
        onChange: (v) => setParam((p) => { if (v.trim()) p.set('search', v.trim()); else p.delete('search'); }),
        onClear: () => setParam((p) => p.delete('search')),
        placeholder: 'Search supplier name',
        variant: 'blue',
      }}
      action={
        <button
          type="button"
          onClick={() => setParam((p) => p.set('supplier', 'new'))}
          className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 bg-white px-2 py-1.5 text-caption font-semibold text-gray-700 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14" /><path d="M5 12h14" />
          </svg>
          Add supplier
        </button>
      }
    >
      {isLoading ? (
        <div className="px-2 py-6 text-center text-xs text-gray-400">Loading suppliers…</div>
      ) : rows.length === 0 ? (
        <div className="px-2 py-6 text-center text-xs text-gray-400">No suppliers yet.</div>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li key={row.id}>
              <AdminPickerRow
                selected={selected === String(row.id)}
                onPick={() => setParam((p) => p.set('supplier', String(row.id)))}
                title={row.name}
                subtitle={row.supplier_type.replace('_', ' ')}
                trailing={row.ebay_seller_id ? <span className="rounded-full bg-yellow-100 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-700">eBay</span> : null}
              />
            </li>
          ))}
        </ul>
      )}
    </AdminSidebarShell>
  );
}
