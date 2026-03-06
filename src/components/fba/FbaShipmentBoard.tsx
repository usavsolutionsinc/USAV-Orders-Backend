'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Package } from '@/components/Icons';

interface FbaCatalogRow {
  product_title: string | null;
  asin: string | null;
  sku: string | null;
  fnsku: string | null;
}

interface FbaShipmentBoardProps {
  statusFilter: 'ALL' | 'PLANNED' | 'READY_TO_GO' | 'LABEL_ASSIGNED' | 'SHIPPED';
  refreshTrigger: number;
  searchQuery: string;
}

function CatalogRow({ row }: { row: FbaCatalogRow }) {
  return (
    <div className="flex items-center gap-4 px-6 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-bold text-gray-900 truncate">
          {row.product_title || <span className="italic text-gray-400">No title</span>}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 mt-0.5">
          {row.fnsku && (
            <span className="text-[10px] font-mono font-semibold text-purple-600">{row.fnsku}</span>
          )}
          {row.asin && (
            <span className="text-[10px] font-mono text-gray-400">{row.asin}</span>
          )}
          {row.sku && (
            <span className="text-[10px] font-mono text-gray-400">{row.sku}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function FbaShipmentBoard({ refreshTrigger, searchQuery }: FbaShipmentBoardProps) {
  const [rows, setRows] = useState<FbaCatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qParam = searchQuery.trim()
        ? `&q=${encodeURIComponent(searchQuery.trim())}`
        : '';
      const res = await fetch(`/api/admin/fba-fnskus?limit=500${qParam}`);
      if (!res.ok) throw new Error('Failed to fetch catalog');
      const data = await res.json();
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load catalog');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, refreshTrigger]);

  useEffect(() => { load(); }, [load]);

  if (loading && rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
        <span className="text-sm font-bold text-gray-400">Loading catalog...</span>
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
          {searchQuery ? 'No results found' : 'No FBA products in catalog'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Row count header */}
      <div className="px-6 py-2 border-b border-gray-100 bg-white sticky top-0 z-10">
        <span className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">
          {rows.length} product{rows.length !== 1 ? 's' : ''}
          {searchQuery && <span className="text-purple-500"> · filtered</span>}
        </span>
      </div>
      {rows.map((row, idx) => (
        <CatalogRow key={`${row.fnsku ?? ''}-${idx}`} row={row} />
      ))}
    </div>
  );
}
