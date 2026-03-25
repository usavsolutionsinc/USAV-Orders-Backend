'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from '@/components/Icons';
import { FbaFnskuDirectoryPanel } from '@/components/fba/FbaFnskuDirectoryPanel';

interface FBAManagementTabProps {
  searchTerm?: string;
}

export function FBAManagementTab({ searchTerm = '' }: FBAManagementTabProps) {
  const queryClient = useQueryClient();

  const { data: dirData } = useQuery<{ rows: { fnsku: string | null }[] }>({
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
  const visibleRowCount = dirData?.rows?.length ?? 0;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isUploadInfoOpen, setIsUploadInfoOpen] = useState(false);
  const [productTitle, setProductTitle] = useState('');
  const [asin, setAsin] = useState('');
  const [sku, setSku] = useState('');
  const [fnsku, setFnsku] = useState('');

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

  useEffect(() => {
    const openAdd = () => setIsAddOpen(true);
    const openUpload = () => setIsUploadInfoOpen(true);
    window.addEventListener('admin-fba-open-add', openAdd as EventListener);
    window.addEventListener('admin-fba-open-upload', openUpload as EventListener);
    return () => {
      window.removeEventListener('admin-fba-open-add', openAdd as EventListener);
      window.removeEventListener('admin-fba-open-upload', openUpload as EventListener);
    };
  }, []);

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-[linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)]">
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
      <div className="border-b border-gray-200 bg-white/90 px-6 py-5 backdrop-blur">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-2xl">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Catalog Mapping Surface</p>
            <h2 className="mt-2 text-lg font-black uppercase tracking-[0.18em] text-slate-900">Admin FBA Directory</h2>
            <p className="mt-2 text-[12px] font-bold leading-relaxed text-slate-500">
              Use the sidebar to search, add, and import FNSKU mappings. This board stays focused on the actual catalog rows.
            </p>
          </div>

          <div className="grid min-w-[280px] flex-1 gap-3 sm:grid-cols-3">
            <div className="border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Visible Rows</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-slate-900">{visibleRowCount}</p>
            </div>
            <div className="border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Search Query</p>
              <p className="mt-2 truncate text-sm font-black uppercase tracking-[0.14em] text-slate-900">
                {searchTerm.trim() || 'All rows'}
              </p>
            </div>
            <div className="border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Upload State</p>
              <div className="mt-2 flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em] text-slate-900">
                {uploadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin text-emerald-600" /> : null}
                <span>{uploadMutation.isPending ? 'Uploading' : 'Ready'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-6 py-6">
        <FbaFnskuDirectoryPanel searchTerm={searchTerm} variant="admin" />
      </div>

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
              Include an <span className="font-black">fnsku</span>, <span className="font-black">product_title</span>,{' '}
              <span className="font-black">asin</span>, and <span className="font-black">sku</span> columns (required).
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
    </section>
  );
}
