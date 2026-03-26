'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FbaFnskuDirectoryPanel } from '@/components/fba/FbaFnskuDirectoryPanel';

interface FBAManagementTabProps {
  searchTerm?: string;
}

export function FBAManagementTab({ searchTerm = '' }: FBAManagementTabProps) {
  const queryClient = useQueryClient();
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
    <section className="flex h-full min-h-0 w-full min-w-0 flex-col bg-white">
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
      <FbaFnskuDirectoryPanel searchTerm={searchTerm} variant="admin" className="min-h-0 flex-1 border-0" />

      {isUploadInfoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/30"
            onClick={() => setIsUploadInfoOpen(false)}
            aria-label="Close FNSKU upload instructions"
          />
          <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-gray-900">Upload FNSKU CSV</h3>
            <p className="text-[11px] font-bold text-gray-700 leading-relaxed">
              Include <span className="font-black">fnsku</span>, <span className="font-black">product_title</span>,{' '}
              <span className="font-black">asin</span>, and <span className="font-black">sku</span> columns. Rows with
              duplicate <span className="font-black">fnskus</span> in the same file are skipped.
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
                Choose File
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
            aria-label="Close add FNSKU mapping dialog"
          />
          <div className="relative w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
            <div>
              <h3 className="text-xs font-black uppercase tracking-widest text-gray-900">Add FNSKU Mapping</h3>
              <p className="mt-1 text-[11px] font-bold text-gray-600">
                Create one catalog row manually when you do not want to use a CSV upload.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="block text-[10px] font-black uppercase tracking-widest text-gray-500">Product Title</span>
                <input
                  type="text"
                  value={productTitle}
                  onChange={(e) => setProductTitle(e.target.value)}
                  placeholder="Enter product title"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-xs font-bold text-gray-900 outline-none focus:border-blue-500"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-[10px] font-black uppercase tracking-widest text-gray-500">ASIN</span>
                <input
                  type="text"
                  value={asin}
                  onChange={(e) => setAsin(e.target.value)}
                  placeholder="Enter ASIN"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-xs font-bold text-gray-900 outline-none focus:border-blue-500"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-[10px] font-black uppercase tracking-widest text-gray-500">SKU</span>
                <input
                  type="text"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="Enter SKU"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-xs font-bold text-gray-900 outline-none focus:border-blue-500"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-[10px] font-black uppercase tracking-widest text-gray-500">FNSKU</span>
                <input
                  type="text"
                  value={fnsku}
                  onChange={(e) => setFnsku(e.target.value.toUpperCase())}
                  placeholder="Enter FNSKU"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-xs font-bold text-gray-900 outline-none focus:border-blue-500"
                />
              </label>
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
                {createMutation.isPending ? 'Saving...' : 'Save Row'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
