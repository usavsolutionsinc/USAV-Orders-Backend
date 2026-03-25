'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Loader2 } from '@/components/Icons';

export interface FbaFnskuRow {
  product_title: string | null;
  asin: string | null;
  sku: string | null;
  fnsku: string | null;
}

interface FbaFnskuDirectoryPanelProps {
  searchTerm: string;
  /** `admin` matches FBAManagementTab chrome; `embed` is compact for /fba right rail */
  variant?: 'admin' | 'embed';
  className?: string;
}

export function FbaFnskuDirectoryPanel({
  searchTerm,
  variant = 'admin',
  className = '',
}: FbaFnskuDirectoryPanelProps) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const isEmbed = variant === 'embed';

  const { data, isLoading } = useQuery<{ rows: FbaFnskuRow[] }>({
    queryKey: ['admin-fba-fnskus', searchTerm],
    queryFn: async () => {
      const q = searchTerm.trim();
      const url = q
        ? `/api/admin/fba-fnskus?q=${encodeURIComponent(q)}`
        : '/api/admin/fba-fnskus';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch FBA FNSKU rows');
      return res.json();
    },
  });

  const rows = useMemo(() => data?.rows || [], [data]);

  const copyValue = async (value: string | null | undefined) => {
    const text = String(value || '').trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedValue(text);
      window.setTimeout(() => setCopiedValue((current) => (current === text ? null : current)), 1000);
    } catch (error) {
      console.error('Copy failed:', error);
    }
  };

  const inner = (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)_92px_92px_120px] gap-0 px-4 py-3 border-b border-gray-100 bg-gray-50">
        <div className="min-w-0 pr-3 text-[10px] font-black uppercase tracking-widest text-gray-500 truncate">
          Product Title
        </div>
        <div className="pr-3 text-[10px] font-black uppercase tracking-widest text-gray-500 text-right">ASIN</div>
        <div className="px-0 text-[10px] font-black uppercase tracking-widest text-gray-500 text-right">SKU</div>
        <div className="px-0 text-[10px] font-black uppercase tracking-widest text-gray-500 text-right">FNSKU</div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 px-4 py-8 text-sm font-bold text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-8 text-sm font-bold text-gray-500">No FBA rows found.</div>
      ) : (
        <div
          className={
            isEmbed
              ? 'min-h-0 flex-1 overflow-y-auto divide-y divide-gray-100'
              : 'h-[calc(100%-49px)] overflow-y-auto divide-y divide-gray-100'
          }
        >
          {rows.map((row, index) => (
            <div
              key={`${row.fnsku || 'row'}-${index}`}
              className="grid grid-cols-[minmax(0,1fr)_92px_92px_132px] gap-0 px-4 py-3 items-center"
            >
              <button
                type="button"
                onClick={() => copyValue(row.product_title)}
                className="min-w-0 w-full pr-3 block text-left text-[11px] font-bold text-gray-900 truncate hover:text-blue-700"
                title={row.product_title || ''}
              >
                {row.product_title || '-'}
              </button>
              <div className="relative group w-full pr-3">
                <button
                  type="button"
                  onClick={() => copyValue(row.asin)}
                  className="w-full text-[11px] font-mono font-bold text-gray-700 truncate text-right hover:text-blue-700"
                  title={row.asin || ''}
                >
                  {row.asin || '-'}
                </button>
                {row.asin ? (
                  <div className="pointer-events-none absolute top-full mt-1 right-0 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                    <a
                      href={`https://www.amazon.com/dp/${encodeURIComponent(String(row.asin).trim())}`}
                      target="_blank"
                      rel="noreferrer"
                      className="pointer-events-auto inline-flex items-center h-8 px-3 rounded-lg bg-white border border-gray-200 shadow-sm text-[9px] font-black uppercase tracking-wider text-gray-700 hover:bg-gray-50 whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open on Amazon
                    </a>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => copyValue(row.sku)}
                className="w-full px-0 text-[11px] font-mono font-bold text-gray-700 truncate text-right hover:text-blue-700"
                title={row.sku || ''}
              >
                {row.sku || '-'}
              </button>
              <button
                type="button"
                onClick={() => copyValue(row.fnsku)}
                className="w-full px-0 text-[11px] font-mono font-bold text-blue-700 truncate text-right hover:text-blue-800"
                title={row.fnsku || ''}
              >
                {row.fnsku || '-'}
              </button>
            </div>
          ))}
        </div>
      )}

      {copiedValue ? (
        <div className="mx-4 mb-3 inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-[10px] font-black uppercase tracking-widest text-emerald-700">
          <Check className="w-3 h-3" />
          Copied
        </div>
      ) : null}
    </>
  );

  if (isEmbed) {
    return (
      <div
        className={`flex h-full min-h-0 flex-col overflow-hidden border border-gray-200 bg-white rounded-xl shadow-sm ${className}`}
      >
        {inner}
      </div>
    );
  }

  return (
    <div className={`h-full overflow-hidden border border-gray-200 bg-white ${className}`}>{inner}</div>
  );
}
