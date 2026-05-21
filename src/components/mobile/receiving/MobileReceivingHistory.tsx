'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Camera, Search } from '@/components/Icons';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';
import { SkeletonList } from '@/design-system/components/Skeletons';

interface PoRow {
  po_id: string;
  po_number: string;
  receiving_id: number | null;
  source_platform: string | null;
  received_at: string | null;
  last_activity: string | null;
  item_count: number;
  qty_expected: number;
  qty_received: number;
  open_items: number;
  has_pending: boolean;
  photo_count: number;
  status: 'OPEN' | 'RECEIVED';
}

interface ListResponse {
  success: boolean;
  purchase_orders: PoRow[];
}

const FILTERS: Array<{ key: 'all' | 'open' | 'received' | 'today'; label: string }> = [
  { key: 'all',      label: 'All' },
  { key: 'open',     label: 'Open' },
  { key: 'received', label: 'Received' },
  { key: 'today',    label: 'Today' },
];

const STATUS_TONE: Record<string, string> = {
  OPEN:     'bg-amber-100 text-amber-800',
  RECEIVED: 'bg-emerald-100 text-emerald-700',
};

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function MobileReceivingHistory() {
  const [filter, setFilter] = useState<typeof FILTERS[number]['key']>('all');
  const [search, setSearch] = useState('');
  
  useRealtimeInvalidation({ receiving: true });

  const { data, isLoading, error } = useQuery<ListResponse>({
    queryKey: ['receiving-po-list', filter, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('view', filter);
      if (search.trim()) params.set('search', search.trim());
      const res = await fetch(`/api/receiving/po/list?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 20_000,
  });

  const rows = useMemo(() => data?.purchase_orders ?? [], [data]);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Search & Filter Header */}
      <div className="shrink-0 border-b border-gray-100 bg-white p-3 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="search"
            inputMode="search"
            placeholder="Search PO #, SKU, or item"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11 w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-3 text-[14px] font-semibold text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((f) => {
            const active = f.key === filter;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`h-8 whitespace-nowrap rounded-full px-4 text-[11px] font-black uppercase tracking-wider transition-colors ${
                  active
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 active:bg-gray-200'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Scrollable List */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && rows.length === 0 ? (
          <div className="p-3">
            <SkeletonList count={8} type="row" />
          </div>
        ) : error ? (
          <div className="px-6 py-12 text-center">
            <p className="text-[12px] font-bold text-rose-600">
              Couldn't load PO list. Pull to refresh.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-[13px] font-black uppercase tracking-[0.18em] text-gray-700">
              No purchase orders
            </p>
            <p className="mt-1 text-[11px] font-semibold text-gray-500">
              Try switching the filter or clear the search above.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {rows.map((row) => (
              <li key={row.po_id || row.po_number}>
                <Link
                  href={`/m/receiving/po/${encodeURIComponent(row.po_id || row.po_number)}`}
                  prefetch={false}
                  className="flex items-center gap-3 px-4 py-4 active:bg-gray-50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[15px] font-black tracking-tight text-gray-900">
                        PO {row.po_number || row.po_id}
                      </p>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${
                          STATUS_TONE[row.status] ?? 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {row.status}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] font-bold text-gray-500">
                      {row.item_count} item{row.item_count === 1 ? '' : 's'}
                      {' · '}
                      {row.qty_received}/{row.qty_expected || '?'} rec.
                      {' · '}
                      {formatRelative(row.last_activity ?? row.received_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-black text-gray-700">
                      <Camera className="h-3.5 w-3.5" />
                      {row.photo_count}
                    </span>
                    <ChevronRight className="h-5 w-5 text-gray-300" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
