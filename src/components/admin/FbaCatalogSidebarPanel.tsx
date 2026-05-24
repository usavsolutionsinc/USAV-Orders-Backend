'use client';

/**
 * Sidebar for /admin?section=fba — picker for the FNSKU catalog.
 *
 * URL-state contract:
 *   ?search=<q>     — search box value
 *   ?fnsku=<value>  — selected FNSKU (read by main pane)
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SearchBar } from '@/components/ui/SearchBar';
import {
  AdminSidebarShell,
  AdminPickerRow,
  StatPill,
  useAdminUrlState,
} from './shared';

interface FbaFnskuRow {
  product_title: string | null;
  asin: string | null;
  sku: string | null;
  fnsku: string | null;
}

function emitOpenAddFba() {
  window.dispatchEvent(new CustomEvent('admin-fba-open-add'));
}

function emitOpenUploadFba() {
  window.dispatchEvent(new CustomEvent('admin-fba-open-upload'));
}

export function FbaCatalogSidebarPanel() {
  const { searchParams, setParam } = useAdminUrlState();
  const search = searchParams.get('search') ?? '';
  const selected = searchParams.get('fnsku') ?? '';

  const { data, isLoading } = useQuery<{ rows: FbaFnskuRow[] }>({
    queryKey: ['admin-fba-fnskus', search],
    queryFn: async () => {
      const q = search.trim();
      const url = q
        ? `/api/admin/fba-fnskus?q=${encodeURIComponent(q)}`
        : '/api/admin/fba-fnskus';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch FBA FNSKU rows');
      return res.json();
    },
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const stats = useMemo(() => {
    const total = rows.length;
    const stubs = rows.filter(
      (r) =>
        !String(r.product_title || '').trim() &&
        !String(r.asin || '').trim() &&
        !String(r.sku || '').trim(),
    ).length;
    return { total, stubs, hydrated: total - stubs };
  }, [rows]);

  return (
    <AdminSidebarShell
      search={
        <SearchBar
          value={search}
          onChange={(v) =>
            setParam((p) => {
              if (v.trim()) p.set('search', v.trim());
              else p.delete('search');
            })
          }
          onClear={() => setParam((p) => p.delete('search'))}
          placeholder="Search FNSKU, title, ASIN, SKU"
          variant="blue"
          className="w-full"
        />
      }
      stats={
        <>
          <StatPill label="Total" value={stats.total} />
          <StatPill label="Hydrated" value={stats.hydrated} tone="green" />
          {stats.stubs > 0 ? <StatPill label="Stubs" value={stats.stubs} tone="purple" /> : null}
        </>
      }
      action={
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={emitOpenAddFba}
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 bg-white px-2 py-1.5 text-caption font-semibold text-gray-700 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
          >
            <svg
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            Add row
          </button>
          <button
            type="button"
            onClick={emitOpenUploadFba}
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 bg-white px-2 py-1.5 text-caption font-semibold text-gray-700 transition hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700"
          >
            <svg
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3v12" />
              <path d="M7 8l5-5 5 5" />
              <path d="M5 21h14" />
            </svg>
            Upload CSV
          </button>
        </div>
      }
    >
      {isLoading ? (
        <div className="px-2 py-6 text-center text-xs text-gray-400">Loading catalog…</div>
      ) : rows.length === 0 ? (
        <div className="px-2 py-6 text-center text-xs text-gray-400">No FNSKUs.</div>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row, i) => {
            const fnsku = row.fnsku ?? '';
            const isStub =
              !String(row.product_title || '').trim() &&
              !String(row.asin || '').trim() &&
              !String(row.sku || '').trim();
            return (
              <li key={`${fnsku}-${i}`}>
                <AdminPickerRow
                  selected={selected === fnsku}
                  onPick={() => setParam((p) => p.set('fnsku', fnsku))}
                  title={row.product_title?.trim() || fnsku || 'Untitled'}
                  subtitle={fnsku}
                  trailing={
                    isStub ? (
                      <span
                        title="Stub row (needs hydration)"
                        className="h-2 w-2 rounded-full bg-amber-500"
                      />
                    ) : (
                      <span title="Hydrated" className="h-2 w-2 rounded-full bg-emerald-500" />
                    )
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </AdminSidebarShell>
  );
}
