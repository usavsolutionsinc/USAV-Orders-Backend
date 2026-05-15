'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

type Tab = 'utilization' | 'velocity' | 'dead';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'utilization', label: 'Bin Utilization' },
  { id: 'velocity', label: 'Velocity (30d)' },
  { id: 'dead', label: 'Dead Stock (90d+)' },
];

function ReportsPageInner() {
  const [tab, setTab] = useState<Tab>('utilization');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url =
        tab === 'utilization'
          ? '/api/reports/bin-utilization?limit=500'
          : tab === 'velocity'
          ? '/api/reports/velocity?limit=200'
          : '/api/reports/dead-stock?limit=500';
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
          Reports
        </p>
        <div className="mt-2 flex gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={`rounded-md px-3 py-1.5 text-xs font-bold ${
                tab === t.id
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-300 bg-white text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
          <button
            type="button"
            onClick={load}
            className="ml-auto rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700"
          >
            Refresh
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {loading && (
          <div className="flex h-32 items-center justify-center">
            <LoadingSpinner size="md" className="text-blue-600" />
          </div>
        )}
        {error && (
          <p className="px-3 py-6 text-center text-sm font-bold text-rose-600">{error}</p>
        )}
        {!loading && !error && rows.length === 0 && (
          <p className="px-3 py-10 text-center text-sm font-semibold text-slate-500">
            No data — try the daily refresh cron, or write some movement.
          </p>
        )}
        {!loading && !error && rows.length > 0 && (
          <ReportTable tab={tab} rows={rows} />
        )}
      </main>
    </div>
  );
}

function ReportTable({ tab, rows }: { tab: Tab; rows: Array<Record<string, unknown>> }) {
  if (tab === 'utilization') {
    return (
      <table className="w-full text-left text-[12px]">
        <thead className="sticky top-0 bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-600">
          <tr>
            <th className="px-3 py-2">Bin</th>
            <th className="px-3 py-2">Room</th>
            <th className="px-3 py-2 text-right">Fill</th>
            <th className="px-3 py-2 text-right">Qty</th>
            <th className="px-3 py-2 text-right">Cap</th>
            <th className="px-3 py-2 text-right">SKUs</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r.bin_id)} className={i % 2 ? 'bg-slate-50/40' : ''}>
              <td className="px-3 py-1.5 font-mono font-bold">
                {String(r.barcode ?? r.bin_name ?? '')}
              </td>
              <td className="px-3 py-1.5 text-slate-600">{String(r.room ?? '—')}</td>
              <td className="px-3 py-1.5 text-right font-mono">
                {r.fill_ratio != null
                  ? `${(Number(r.fill_ratio) * 100).toFixed(0)}%`
                  : '—'}
              </td>
              <td className="px-3 py-1.5 text-right font-mono font-black">{Number(r.in_bin)}</td>
              <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                {r.capacity != null ? Number(r.capacity) : '—'}
              </td>
              <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                {Number(r.sku_count)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (tab === 'velocity') {
    return (
      <table className="w-full text-left text-[12px]">
        <thead className="sticky top-0 bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-600">
          <tr>
            <th className="px-3 py-2">Tier</th>
            <th className="px-3 py-2">SKU</th>
            <th className="px-3 py-2">Product</th>
            <th className="px-3 py-2 text-right">Out</th>
            <th className="px-3 py-2 text-right">In</th>
            <th className="px-3 py-2 text-right">Stock</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r.sku)} className={i % 2 ? 'bg-slate-50/40' : ''}>
              <td className="px-3 py-1.5 font-black">{String(r.velocity_tier)}</td>
              <td className="px-3 py-1.5 font-mono font-bold">{String(r.sku)}</td>
              <td className="px-3 py-1.5 text-slate-700 truncate max-w-md">
                {String(r.product_title ?? '—')}
              </td>
              <td className="px-3 py-1.5 text-right font-mono font-black text-rose-600">
                {Number(r.out_qty)}
              </td>
              <td className="px-3 py-1.5 text-right font-mono text-emerald-600">
                {Number(r.in_qty)}
              </td>
              <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                {Number(r.current_stock ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <table className="w-full text-left text-[12px]">
      <thead className="sticky top-0 bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-600">
        <tr>
          <th className="px-3 py-2">SKU</th>
          <th className="px-3 py-2">Product</th>
          <th className="px-3 py-2 text-right">Stock</th>
          <th className="px-3 py-2 text-right">Days dormant</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={String(r.sku)} className={i % 2 ? 'bg-slate-50/40' : ''}>
            <td className="px-3 py-1.5 font-mono font-bold">{String(r.sku)}</td>
            <td className="px-3 py-1.5 text-slate-700 truncate max-w-md">
              {String(r.product_title ?? '—')}
            </td>
            <td className="px-3 py-1.5 text-right font-mono font-black">{Number(r.stock)}</td>
            <td className="px-3 py-1.5 text-right font-mono text-rose-600">
              {Number(r.days_dormant)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center bg-gray-50">
          <LoadingSpinner size="lg" className="text-blue-600" />
        </div>
      }
    >
      <ReportsPageInner />
    </Suspense>
  );
}
