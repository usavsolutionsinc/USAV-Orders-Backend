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
import { qk } from '@/queries/keys';
import {
  HorizontalButtonSlider,
  type HorizontalSliderItem,
} from '@/components/ui/HorizontalButtonSlider';
import { AlertTriangle, Check, Layers } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import {
  AdminSidebarShell,
  AdminPickerRow,
  useAdminUrlState,
} from './shared';

interface FbaFnskuRow {
  product_title: string | null;
  asin: string | null;
  sku: string | null;
  fnsku: string | null;
}

type FbaFilter = 'all' | 'hydrated' | 'stubs';

function asFilter(value: string | null): FbaFilter {
  return value === 'hydrated' || value === 'stubs' ? value : 'all';
}

function isStubRow(r: FbaFnskuRow): boolean {
  return (
    !String(r.product_title || '').trim() &&
    !String(r.asin || '').trim() &&
    !String(r.sku || '').trim()
  );
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
  const filter = asFilter(searchParams.get('fbaFilter'));

  const { data, isLoading } = useQuery<{ rows: FbaFnskuRow[] }>({
    queryKey: qk.adminFbaFnskus.list(search),
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

  // Counts always reflect the full (search-scoped) result set so the pills
  // keep showing totals even while a filter narrows the visible list.
  const stats = useMemo(() => {
    const total = rows.length;
    const stubs = rows.filter(isStubRow).length;
    return { total, stubs, hydrated: total - stubs };
  }, [rows]);

  const visibleRows = useMemo(() => {
    if (filter === 'hydrated') return rows.filter((r) => !isStubRow(r));
    if (filter === 'stubs') return rows.filter(isStubRow);
    return rows;
  }, [rows, filter]);

  const filterItems = useMemo<HorizontalSliderItem[]>(
    () => [
      { id: 'all', label: 'All', icon: Layers, count: stats.total },
      { id: 'hydrated', label: 'Hydrated', icon: Check, count: stats.hydrated },
      { id: 'stubs', label: 'Stubs', icon: AlertTriangle, count: stats.stubs },
    ],
    [stats],
  );

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
        placeholder: 'Search FNSKU, title, ASIN, SKU',
        variant: 'blue',
      }}
      filters={
        <HorizontalButtonSlider
          items={filterItems}
          value={filter}
          onChange={(next) =>
            setParam((p) => {
              if (next === 'all') p.delete('fbaFilter');
              else p.set('fbaFilter', next);
            })
          }
          variant="nav"
          dense
          className="w-full"
          aria-label="FNSKU catalog filter"
        />
      }
      action={
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={emitOpenAddFba}
            className="border-dashed border-gray-300 bg-white text-gray-700 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
            icon={
              <svg
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
            }
          >
            Add row
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={emitOpenUploadFba}
            className="border-dashed border-gray-300 bg-white text-gray-700 hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700"
            icon={
              <svg
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
            }
          >
            Upload CSV
          </Button>
        </div>
      }
    >
      {isLoading ? (
        <div className="px-2 py-6 text-center text-xs text-gray-400">Loading catalog…</div>
      ) : visibleRows.length === 0 ? (
        <div className="px-2 py-6 text-center text-xs text-gray-400">
          {rows.length === 0 ? 'No FNSKUs.' : `No ${filter} FNSKUs.`}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {visibleRows.map((row, i) => {
            const fnsku = row.fnsku ?? '';
            const isStub = isStubRow(row);
            return (
              <li key={`${fnsku}-${i}`}>
                <AdminPickerRow
                  selected={selected === fnsku}
                  onPick={() => setParam((p) => p.set('fnsku', fnsku))}
                  title={row.product_title?.trim() || fnsku || 'Untitled'}
                  subtitle={fnsku}
                  trailing={
                    isStub ? (
                      <HoverTooltip label="Stub row (needs hydration)" asChild focusable={false}>
                        <span className="h-2 w-2 rounded-full bg-amber-500" />
                      </HoverTooltip>
                    ) : (
                      <HoverTooltip label="Hydrated" asChild focusable={false}>
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      </HoverTooltip>
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
