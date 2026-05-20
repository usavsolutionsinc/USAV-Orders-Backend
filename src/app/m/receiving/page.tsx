'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Camera } from '@/components/Icons';
import { NetworkChip } from '@/components/mobile/NetworkChip';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';

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

export default function MobileReceivingPipelinePage() {
  const [filter, setFilter] = useState<typeof FILTERS[number]['key']>('all');
  const [search, setSearch] = useState('');
  // Keep this list fresh when a desktop scan, another phone's upload, or a
  // QA action lands on the receiving-log Ably channel.
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
    refetchOnWindowFocus: true,
  });

  const rows = useMemo(() => data?.purchase_orders ?? [], [data]);

  return (
    <div className="min-h-screen bg-white">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/95 backdrop-blur">
        <div className="flex h-14 items-center gap-2 px-3">
          <h1 className="flex-1 text-[16px] font-black tracking-tight text-gray-900">
            Receiving
          </h1>
          <NetworkChip />
        </div>
        <div className="px-3 pb-2">
          <input
            type="search"
            inputMode="search"
            placeholder="Search PO #, SKU, or item"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-[14px] font-semibold text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((f) => {
            const active = f.key === filter;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`h-9 whitespace-nowrap rounded-full px-4 text-[12px] font-black uppercase tracking-wider transition-colors ${
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
      </header>

      {/* List */}
      <main className="pb-24">
        {isLoading && rows.length === 0 ? (
          <div className="space-y-2 px-3 pt-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-[88px] animate-pulse rounded-2xl bg-gray-100"
                aria-hidden
              />
            ))}
          </div>
        ) : error ? (
          <p className="px-6 py-12 text-center text-[12px] font-bold text-rose-600">
            Couldn't load PO list. Pull to refresh.
          </p>
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
          <ul className="divide-y divide-gray-100 px-3 pt-2">
            {rows.map((row) => (
              <li key={row.po_id || row.po_number}>
                <Link
                  href={`/m/receiving/po/${encodeURIComponent(row.po_id || row.po_number)}`}
                  prefetch={false}
                  className="flex items-center gap-3 py-3 active:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="truncate text-[14px] font-black tracking-tight text-gray-900">
                        PO {row.po_number || row.po_id}
                      </p>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                          STATUS_TONE[row.status] ?? 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {row.status}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] font-bold text-gray-500">
                      {row.item_count} item{row.item_count === 1 ? '' : 's'}
                      {' · '}
                      {row.qty_received}/{row.qty_expected || '?'} received
                      {' · '}
                      {formatRelative(row.last_activity ?? row.received_at)}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-black text-gray-700">
                    <Camera className="h-3.5 w-3.5" />
                    {row.photo_count}
                  </span>
                  <ChevronRight className="h-5 w-5 text-gray-300" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
