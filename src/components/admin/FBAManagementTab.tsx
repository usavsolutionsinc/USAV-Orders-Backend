'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Plus } from '@/components/Icons';
import { SearchBar } from '@/components/ui/SearchBar';

interface FbaFnskuRow {
  product_title: string | null;
  asin: string | null;
  sku: string | null;
  fnsku: string | null;
}

export function FBAManagementTab() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isUploadInfoOpen, setIsUploadInfoOpen] = useState(false);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [productTitle, setProductTitle] = useState('');
  const [asin, setAsin] = useState('');
  const [sku, setSku] = useState('');
  const [fnsku, setFnsku] = useState('');

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

  const createMutation = useMutation({
    mutationFn: async (payload: { product_title: string; asin: string; sku: string; fnsku: string }) => {
      const res = await fetch('/api/admin/fba-fnskus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'Failed to add FBA row');
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-fba-fnskus'] });
      setIsAddOpen(false);
      setProductTitle('');
      setAsin('');
      setSku('');
      setFnsku('');
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/admin/fba-fnskus/upload', {
        method: 'POST',
        body: formData,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'Failed to upload CSV');
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-fba-fnskus'] });
      if (fileInputRef.current) fileInputRef.current.value = '';
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

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadMutation.mutate(file);
        }}
      />
      <div className="flex items-center gap-3">
        <SearchBar
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search product title, ASIN, SKU, or FNSKU..."
          className="w-full max-w-[420px]"
          variant="blue"
        />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setIsAddOpen(true)}
            className="inline-flex h-10 items-center gap-2 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase tracking-widest"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
          <button
            type="button"
            onClick={() => setIsUploadInfoOpen(true)}
            disabled={uploadMutation.isPending}
            className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
            title="Upload CSV"
            aria-label="Upload CSV"
          >
            {uploadMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M12 4v12m0-12l-4 4m4-4l4 4" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-3xl overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_92px_92px_120px] gap-0 px-4 py-3 border-b border-gray-100 bg-gray-50">
          <div className="min-w-0 pr-3 text-[10px] font-black uppercase tracking-widest text-gray-500 truncate">Product Title</div>
          <div className="pr-3 text-[10px] font-black uppercase tracking-widest text-gray-500 text-right">ASIN</div>
          <div className="px-0 text-[10px] font-black uppercase tracking-widest text-gray-500 text-right">SKU</div>
          <div className="px-0 text-[10px] font-black uppercase tracking-widest text-gray-500 text-right">FNSKU</div>
        </div>

        {isLoading ? (
          <div className="px-4 py-8 text-sm font-bold text-gray-500">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-8 text-sm font-bold text-gray-500">No FBA rows found.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {rows.map((row, index) => (
              <div key={`${row.fnsku || 'row'}-${index}`} className="grid grid-cols-[minmax(0,1fr)_92px_92px_132px] gap-0 px-4 py-3 items-center">
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
                  {row.asin && (
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
                  )}
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
      </div>
      {copiedValue && (
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-[10px] font-black uppercase tracking-widest text-emerald-700">
          <Check className="w-3 h-3" />
          Copied
        </div>
      )}

      {isUploadInfoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/30"
            onClick={() => setIsUploadInfoOpen(false)}
            aria-label="Close upload instructions"
          />
          <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-gray-900">CSV Upload Instructions</h3>
            <p className="text-[11px] font-bold text-gray-700 leading-relaxed">
              Include an <span className="font-black">fnsku</span>, <span className="font-black">product_title</span>, <span className="font-black">asin</span>, and <span className="font-black">sku</span> columns (required).
              Duplicate <span className="font-black">fnskus</span> in the same file are skipped.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsUploadInfoOpen(false)}
                className="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-[10px] font-black uppercase tracking-widest text-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsUploadInfoOpen(false);
                  fileInputRef.current?.click();
                }}
                className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-[10px] font-black uppercase tracking-widest text-white"
              >
                Choose CSV
              </button>
            </div>
          </div>
        </div>
      )}

      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/30"
            onClick={() => setIsAddOpen(false)}
            aria-label="Close add FBA row dialog"
          />
          <div className="relative w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-gray-900">Add FBA Row</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                type="text"
                value={productTitle}
                onChange={(e) => setProductTitle(e.target.value)}
                placeholder="Product title"
                className="px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-xs font-bold text-gray-900 outline-none focus:border-blue-500"
              />
              <input
                type="text"
                value={asin}
                onChange={(e) => setAsin(e.target.value)}
                placeholder="ASIN"
                className="px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-xs font-bold text-gray-900 outline-none focus:border-blue-500"
              />
              <input
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="SKU"
                className="px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-xs font-bold text-gray-900 outline-none focus:border-blue-500"
              />
              <input
                type="text"
                value={fnsku}
                onChange={(e) => setFnsku(e.target.value.toUpperCase())}
                placeholder="FNSKU (required)"
                className="px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-xs font-bold text-gray-900 outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-[10px] font-black uppercase tracking-widest text-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={createMutation.isPending || !fnsku.trim()}
                onClick={() =>
                  createMutation.mutate({
                    product_title: productTitle,
                    asin,
                    sku,
                    fnsku,
                  })
                }
                className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
              >
                {createMutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
