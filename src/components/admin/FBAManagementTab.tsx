'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminEmptyDetail } from './shared';

interface FbaFnskuRow {
  product_title: string | null;
  asin: string | null;
  sku: string | null;
  fnsku: string | null;
}

interface FBAManagementTabProps {
  // Search term used to live in this prop; it now lives in the URL and is
  // owned by FbaCatalogSidebarPanel. Kept for backwards compatibility with
  // the admin page's prop pass-through.
  searchTerm?: string;
}

export function FBAManagementTab(_props: FBAManagementTabProps = {}) {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isUploadInfoOpen, setIsUploadInfoOpen] = useState(false);
  const [productTitle, setProductTitle] = useState('');
  const [asin, setAsin] = useState('');
  const [sku, setSku] = useState('');
  const [fnsku, setFnsku] = useState('');

  // Edit-in-place state for the detail view.
  const [editTitle, setEditTitle] = useState('');
  const [editAsin, setEditAsin] = useState('');
  const [editSku, setEditSku] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  const selectedFnsku = searchParams.get('fnsku') ?? '';

  const { data: detail, isLoading } = useQuery<FbaFnskuRow | null>({
    queryKey: ['admin-fba-fnsku-detail', selectedFnsku],
    queryFn: async () => {
      if (!selectedFnsku) return null;
      const res = await fetch(`/api/admin/fba-fnskus/${encodeURIComponent(selectedFnsku)}`);
      if (!res.ok) throw new Error('Failed to fetch FNSKU detail');
      const json = await res.json();
      return (json?.row ?? json) as FbaFnskuRow;
    },
    enabled: Boolean(selectedFnsku),
  });

  useEffect(() => {
    if (detail) {
      setEditTitle(detail.product_title ?? '');
      setEditAsin(detail.asin ?? '');
      setEditSku(detail.sku ?? '');
      setIsEditing(false);
    }
  }, [detail]);

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

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFnsku) return;
      const res = await fetch(`/api/admin/fba-fnskus/${encodeURIComponent(selectedFnsku)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_title: editTitle, asin: editAsin, sku: editSku }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'Failed to update');
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-fba-fnskus'] });
      queryClient.invalidateQueries({ queryKey: ['admin-fba-fnsku-detail', selectedFnsku] });
      setIsEditing(false);
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

  const isStub = useMemo(() => {
    if (!detail) return false;
    return (
      !String(detail.product_title || '').trim() &&
      !String(detail.asin || '').trim() &&
      !String(detail.sku || '').trim()
    );
  }, [detail]);

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-gray-50">
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

      {!selectedFnsku ? (
        <AdminEmptyDetail
          title="Pick an FNSKU"
          hint="Select an FNSKU from the catalog on the left, or use the buttons there to add a row or upload a CSV."
        />
      ) : isLoading ? (
        <AdminEmptyDetail title="Loading FNSKU…" />
      ) : !detail ? (
        <AdminEmptyDetail
          title="FNSKU not found"
          hint="The selected FNSKU isn't in the catalog. Clear the selection and pick another."
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
          <div className="mx-auto max-w-2xl space-y-5">
            <header className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">FNSKU</p>
                <h2 className="mt-0.5 break-all font-mono text-xl font-bold text-gray-900">
                  {detail.fnsku}
                </h2>
              </div>
              <span
                className={`inline-flex flex-shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                  isStub ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                }`}
              >
                {isStub ? 'Stub' : 'Hydrated'}
              </span>
            </header>

            <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
              <FieldRow label="Product Title">
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => {
                    setEditTitle(e.target.value);
                    setIsEditing(true);
                  }}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
                />
              </FieldRow>
              <FieldRow label="ASIN">
                <input
                  type="text"
                  value={editAsin}
                  onChange={(e) => {
                    setEditAsin(e.target.value);
                    setIsEditing(true);
                  }}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-[12px] outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
                />
              </FieldRow>
              <FieldRow label="SKU">
                <input
                  type="text"
                  value={editSku}
                  onChange={(e) => {
                    setEditSku(e.target.value);
                    setIsEditing(true);
                  }}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-[12px] outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
                />
              </FieldRow>

              {isEditing ? (
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setEditTitle(detail.product_title ?? '');
                      setEditAsin(detail.asin ?? '');
                      setEditSku(detail.sku ?? '');
                      setIsEditing(false);
                    }}
                    className="rounded-lg bg-gray-100 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={updateMutation.isPending}
                    onClick={() => updateMutation.mutate()}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {updateMutation.isPending ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {isUploadInfoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/30"
            onClick={() => setIsUploadInfoOpen(false)}
            aria-label="Close FNSKU upload instructions"
          />
          <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
            <h3 className="text-[12px] font-bold uppercase tracking-wider text-gray-900">
              Upload FNSKU CSV
            </h3>
            <p className="text-[12px] text-gray-700 leading-relaxed">
              Include <span className="font-bold">fnsku</span>,{' '}
              <span className="font-bold">product_title</span>,{' '}
              <span className="font-bold">asin</span>, and <span className="font-bold">sku</span>{' '}
              columns. Rows with duplicate <span className="font-bold">fnskus</span> in the same
              file are skipped.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsUploadInfoOpen(false)}
                className="rounded-xl bg-gray-100 px-3 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsUploadInfoOpen(false);
                  fileInputRef.current?.click();
                }}
                className="rounded-xl bg-emerald-600 px-3 py-2 text-[12px] font-semibold text-white hover:bg-emerald-700"
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
              <h3 className="text-[12px] font-bold uppercase tracking-wider text-gray-900">
                Add FNSKU Mapping
              </h3>
              <p className="mt-1 text-[11px] text-gray-600">
                Create one catalog row manually when you don&apos;t want to use a CSV upload.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Product Title">
                <input
                  type="text"
                  value={productTitle}
                  onChange={(e) => setProductTitle(e.target.value)}
                  placeholder="Enter product title"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] outline-none focus:border-blue-500"
                />
              </Field>
              <Field label="ASIN">
                <input
                  type="text"
                  value={asin}
                  onChange={(e) => setAsin(e.target.value)}
                  placeholder="Enter ASIN"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] outline-none focus:border-blue-500"
                />
              </Field>
              <Field label="SKU">
                <input
                  type="text"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="Enter SKU"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] outline-none focus:border-blue-500"
                />
              </Field>
              <Field label="FNSKU">
                <input
                  type="text"
                  value={fnsku}
                  onChange={(e) => setFnsku(e.target.value.toUpperCase())}
                  placeholder="Enter FNSKU"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] outline-none focus:border-blue-500"
                />
              </Field>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="rounded-xl bg-gray-100 px-3 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-200"
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
                className="rounded-xl bg-blue-600 px-3 py-2 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {createMutation.isPending ? 'Saving…' : 'Save Row'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-center gap-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{label}</p>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-700">
        {label}
      </span>
      {children}
    </label>
  );
}
