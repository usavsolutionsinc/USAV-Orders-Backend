'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Package } from '@/components/Icons';

interface FbaSummaryRow {
  fnsku: string;
  product_title: string | null;
  asin: string | null;
  sku: string | null;
  tech_scanned_qty: number;
  pack_ready_qty: number;
  shipped_qty: number;
  available_to_ship: number;
  shipment_ref: string | null;
  shipment_item_status: string | null;
  expected_qty: number | null;
  actual_qty: number | null;
}

interface FbaShipmentBoardProps {
  statusFilter: 'ALL' | 'PLANNED' | 'READY_TO_GO' | 'LABEL_ASSIGNED' | 'SHIPPED';
  refreshTrigger: number;
  searchQuery: string;
}

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string | null | undefined;
  tone: string;
}) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${tone}`}>
      <p className="text-[9px] font-black uppercase tracking-[0.25em] opacity-70">{label}</p>
      <p className="mt-1 text-xs font-black tabular-nums">{value ?? 0}</p>
    </div>
  );
}

function SummaryRow({ row }: { row: FbaSummaryRow }) {
  return (
    <div className="border-b border-gray-100 px-6 py-4 hover:bg-white transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-mono font-black text-purple-600">{row.fnsku}</span>
            {row.shipment_ref ? (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-blue-700">
                {row.shipment_ref}
              </span>
            ) : null}
            {row.shipment_item_status ? (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-gray-600">
                {row.shipment_item_status.replaceAll('_', ' ')}
              </span>
            ) : null}
          </div>
          <p className="mt-1 truncate text-[13px] font-black text-gray-900">
            {row.product_title || 'Untitled FNSKU'}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono text-gray-400">
            {row.asin ? <span>{row.asin}</span> : null}
            {row.sku ? <span>{row.sku}</span> : null}
            {row.expected_qty != null ? <span>exp {row.expected_qty}</span> : null}
            {row.actual_qty != null ? <span>act {row.actual_qty}</span> : null}
          </div>
        </div>
        <div className="grid min-w-[320px] grid-cols-4 gap-2">
          <StatPill label="Tech" value={row.tech_scanned_qty} tone="bg-gray-50 text-gray-700 border-gray-100" />
          <StatPill label="Ready" value={row.pack_ready_qty} tone="bg-emerald-50 text-emerald-700 border-emerald-100" />
          <StatPill label="Avail" value={row.available_to_ship} tone="bg-blue-50 text-blue-700 border-blue-100" />
          <StatPill label="Shipped" value={row.shipped_qty} tone="bg-purple-50 text-purple-700 border-purple-100" />
        </div>
      </div>
    </div>
  );
}

export function FbaShipmentBoard({ refreshTrigger, searchQuery }: FbaShipmentBoardProps) {
  const [rows, setRows] = useState<FbaSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qParam = searchQuery.trim()
        ? `?q=${encodeURIComponent(searchQuery.trim())}&limit=500`
        : '?limit=500';
      const res = await fetch(`/api/fba/logs/summary${qParam}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch FBA summary');
      const data = await res.json();
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load FBA summary');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, refreshTrigger]);

  useEffect(() => { load(); }, [load]);

  if (loading && rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
        <span className="text-sm font-bold text-gray-400">Loading FBA readiness...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-40">
        <p className="text-sm font-bold text-red-500">{error}</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-3">
        <Package className="w-10 h-10 text-gray-200" />
        <p className="text-[11px] font-black uppercase tracking-widest text-gray-400">
          {searchQuery ? 'No FNSKU activity found' : 'No FNSKU activity yet'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="sticky top-0 z-10 border-b border-gray-100 bg-white px-6 py-3">
        <span className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">
          {rows.length} FNSKU row{rows.length !== 1 ? 's' : ''}
          {searchQuery ? <span className="text-purple-500"> · filtered</span> : null}
        </span>
      </div>
      {rows.map((row) => (
        <SummaryRow key={row.fnsku} row={row} />
      ))}
    </div>
  );
}
