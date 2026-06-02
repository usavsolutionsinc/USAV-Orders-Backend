'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import {
  Barcode,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Edit,
  Image as ImageIcon,
  Plus,
  Search,
  Trash2,
  X,
} from '@/components/Icons';
import { mainStickyHeaderClass, mainStickyHeaderShellRowClass } from '@/components/layout/header-shell';
import { toast } from '@/lib/toast';
import { sectionLabel, fieldLabel, tableHeader, tableCell } from '@/design-system/tokens/typography/presets';

const PAGE_SIZE = 50;

/** Mirrors a row from GET /api/sku-catalog (SkuCatalogListRow). */
interface SkuCatalogListRow {
  id: number;
  sku: string;
  product_title: string;
  category: string | null;
  image_url: string | null;
  is_active: boolean;
  platform_count: number;
  manual_count: number;
  qc_step_count: number;
  order_count: number;
  last_shipped: string | null;
  ecwid_display_name: string | null;
  ecwid_image_url: string | null;
  ecwid_sku: string | null;
}

/** The `catalog` object from GET /api/sku-catalog/[id]. Carries upc/ean the list omits. */
interface SkuCatalogDetail {
  id: number;
  sku: string;
  product_title: string;
  category: string | null;
  upc: string | null;
  ean: string | null;
  image_url: string | null;
  is_active: boolean;
}

type SortKey = 'az' | 'ordered' | 'shipped';
type SortDir = 'asc' | 'desc';

interface CatalogFormState {
  sku: string;
  productTitle: string;
  category: string;
  upc: string;
  ean: string;
  imageUrl: string;
  isActive: boolean;
}

const DEFAULT_FORM_STATE: CatalogFormState = {
  sku: '',
  productTitle: '',
  category: '',
  upc: '',
  ean: '',
  imageUrl: '',
  isActive: true,
};

const inputClass =
  'h-10 w-full border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-gray-400';

/** PATCH/POST send null to clear an optional text field; '' is treated as "cleared". */
function toNullable(value: string): string | null {
  const v = value.trim();
  return v.length > 0 ? v : null;
}

export function SkuCatalogManagementTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('az');
  const [dir, setDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(0);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [form, setForm] = useState<CatalogFormState>(DEFAULT_FORM_STATE);

  const { data, isLoading, isFetching } = useQuery<{ items: SkuCatalogListRow[]; total: number }>({
    queryKey: qk.skuCatalog.list(search.trim(), sort, dir, page),
    queryFn: async () => {
      const params = new URLSearchParams({
        q: search.trim(),
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
        sort,
        dir,
      });
      const res = await fetch(`/api/sku-catalog?${params.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Failed to load SKU catalog');
      return { items: Array.isArray(body.items) ? body.items : [], total: body.total ?? 0 };
    },
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, page * PAGE_SIZE + rows.length);

  const createMutation = useMutation({
    mutationFn: async (payload: CatalogFormState) => {
      const res = await fetch('/api/sku-catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: payload.sku.trim(),
          productTitle: payload.productTitle.trim(),
          category: toNullable(payload.category),
          upc: toNullable(payload.upc),
          ean: toNullable(payload.ean),
          imageUrl: toNullable(payload.imageUrl),
          isActive: payload.isActive,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) throw new Error('A SKU catalog entry with that SKU already exists');
        throw new Error(body?.error || 'Failed to create SKU catalog entry');
      }
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.skuCatalog.all });
      toast.success('SKU catalog entry created');
      closeForm();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: CatalogFormState }) => {
      const res = await fetch(`/api/sku-catalog/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productTitle: payload.productTitle.trim(),
          category: toNullable(payload.category),
          upc: toNullable(payload.upc),
          ean: toNullable(payload.ean),
          imageUrl: toNullable(payload.imageUrl),
          isActive: payload.isActive,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Failed to update SKU catalog entry');
      return body;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: qk.skuCatalog.all });
      queryClient.invalidateQueries({ queryKey: qk.skuCatalog.detail(vars.id) });
      toast.success('SKU catalog entry updated');
      closeForm();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/sku-catalog/${id}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Failed to remove SKU catalog entry');
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.skuCatalog.all });
      toast.success('SKU catalog entry removed');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setLoadingDetail(false);
    setForm(DEFAULT_FORM_STATE);
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(DEFAULT_FORM_STATE);
    setIsFormOpen(true);
  };

  const openEdit = async (row: SkuCatalogListRow) => {
    setEditingId(row.id);
    setIsFormOpen(true);
    setLoadingDetail(true);
    // Seed from the list row so the modal is never empty while detail loads.
    setForm({
      sku: row.sku,
      productTitle: row.product_title,
      category: row.category ?? '',
      upc: '',
      ean: '',
      imageUrl: row.image_url ?? '',
      isActive: row.is_active,
    });
    try {
      const res = await fetch(`/api/sku-catalog/${row.id}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Failed to load entry detail');
      const c: SkuCatalogDetail = body.catalog;
      setForm({
        sku: c.sku,
        productTitle: c.product_title,
        category: c.category ?? '',
        upc: c.upc ?? '',
        ean: c.ean ?? '',
        imageUrl: c.image_url ?? '',
        isActive: c.is_active,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load entry detail');
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleSubmit = () => {
    if (editingId == null && !form.sku.trim()) return toast.error('SKU is required');
    if (!form.productTitle.trim()) return toast.error('Product title is required');

    if (editingId != null) {
      updateMutation.mutate({ id: editingId, payload: form });
      return;
    }
    createMutation.mutate(form);
  };

  const handleDelete = (row: SkuCatalogListRow) => {
    if (!window.confirm(`Remove "${row.sku}" from the catalog? It will be hidden from active lists (soft-delete) and can be revived by re-creating the same SKU.`)) {
      return;
    }
    deleteMutation.mutate(row.id);
  };

  const toggleSort = (key: SortKey) => {
    setPage(0);
    if (sort === key) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(key);
      // Counts default to most-first; alphabetical defaults to A→Z.
      setDir(key === 'az' ? 'asc' : 'asc');
    }
  };

  const sortCaret = (key: SortKey) =>
    sort === key ? (
      <ChevronDown className={`h-3 w-3 transition-transform ${dir === 'asc' ? 'rotate-180' : ''}`} />
    ) : null;

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const tableGridClass =
    'grid grid-cols-[48px_180px_minmax(220px,2fr)_150px_88px_84px_70px_84px_88px_96px] gap-x-3';

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-[linear-gradient(180deg,#ffffff_0%,#f5f7fa_100%)]">
      <div className={mainStickyHeaderClass}>
        <div className={`${mainStickyHeaderShellRowClass} flex-wrap gap-y-2 px-4`}>
          <p className={`${sectionLabel} truncate text-gray-900`}>SKU Catalog</p>
          <div className={`${sectionLabel} flex flex-wrap items-center gap-4`}>
            <span>{total} {total === 1 ? 'SKU' : 'SKUs'}</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder="Search SKU / title / category"
                className="h-8 w-72 border border-gray-200 bg-white pl-8 pr-3 text-xs font-medium text-gray-900 outline-none focus:border-gray-400"
              />
            </div>
            <button
              type="button"
              onClick={openAdd}
              className={`${sectionLabel} inline-flex items-center gap-2 border border-gray-300 px-3 py-1.5 text-gray-800 transition-colors hover:bg-gray-50`}
            >
              <Plus className="h-3 w-3" />
              Add SKU
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col overflow-hidden border-y border-gray-200 bg-white">
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-[1080px]">
              <div className={`${tableGridClass} ${tableHeader} border-b border-gray-200 px-4 py-3`}>
                <p />
                <button type="button" onClick={() => toggleSort('az')} className="inline-flex items-center gap-1 text-left uppercase">
                  SKU {sort === 'az' && sortCaret('az')}
                </button>
                <p>Title</p>
                <p>Category</p>
                <p>Platforms</p>
                <p>Manuals</p>
                <p>QC</p>
                <button type="button" onClick={() => toggleSort('ordered')} className="inline-flex items-center gap-1 text-left uppercase">
                  Orders {sortCaret('ordered')}
                </button>
                <p>Status</p>
                <p className="text-right">Actions</p>
              </div>

              {isLoading ? (
                <div className="px-6 py-10 text-sm font-medium text-gray-500">Loading SKU catalog...</div>
              ) : rows.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <p className={sectionLabel}>No SKUs</p>
                  <p className="mt-2 text-sm font-medium text-gray-500">
                    {search.trim() ? 'No catalog entries match your search.' : 'Add the first SKU catalog entry.'}
                  </p>
                </div>
              ) : (
                rows.map((row) => {
                  const img = row.image_url || row.ecwid_image_url;
                  return (
                    <div key={row.id} className={`${tableGridClass} items-center border-b border-gray-100 px-4 py-2.5 text-sm last:border-b-0`}>
                      <div className="flex h-9 w-9 items-center justify-center overflow-hidden border border-gray-200 bg-gray-50">
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <ImageIcon className="h-4 w-4 text-gray-300" />
                        )}
                      </div>
                      <p className={`${tableCell} truncate font-mono`} title={row.sku}>{row.sku}</p>
                      <p className={`${tableCell} truncate`} title={row.product_title}>{row.product_title}</p>
                      <p className={`${tableCell} truncate text-gray-600`}>{row.category || '-'}</p>
                      <p className={`${tableCell} text-gray-600`}>{row.platform_count}</p>
                      <p className={`${tableCell} text-gray-600`}>{row.manual_count}</p>
                      <p className={`${tableCell} text-gray-600`}>{row.qc_step_count}</p>
                      <p className={`${tableCell} text-gray-600`}>{row.order_count}</p>
                      <p className={`${tableHeader} ${row.is_active ? 'text-emerald-700' : 'text-gray-400'}`}>
                        {row.is_active ? 'Active' : 'Inactive'}
                      </p>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(row)}
                          className="inline-flex h-8 w-8 items-center justify-center border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
                          title="Edit SKU"
                          aria-label={`Edit ${row.sku}`}
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(row)}
                          disabled={deleteMutation.isPending}
                          className="inline-flex h-8 w-8 items-center justify-center border border-rose-200 text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
                          title="Remove SKU"
                          aria-label={`Remove ${row.sku}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Pagination footer */}
          <div className="flex items-center justify-between border-t border-gray-200 bg-white px-4 py-2.5">
            <p className={`${tableHeader} text-gray-500`}>
              {total === 0 ? 'No results' : `${rangeStart}–${rangeEnd} of ${total}`}
              {isFetching && !isLoading ? ' · updating…' : ''}
            </p>
            <div className="flex items-center gap-2">
              <span className={`${tableHeader} text-gray-500`}>Page {page + 1} / {pageCount}</span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="inline-flex h-8 w-8 items-center justify-center border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => (p + 1 < pageCount ? p + 1 : p))}
                disabled={page + 1 >= pageCount}
                className="inline-flex h-8 w-8 items-center justify-center border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40"
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-gray-950/30" onClick={closeForm} aria-label="Close SKU form" />
          <div className="relative flex w-full max-w-2xl flex-col overflow-hidden border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <p className={sectionLabel}>{editingId != null ? 'Edit SKU' : 'New SKU'}</p>
                <h3 className="mt-1 text-base font-semibold text-gray-900">
                  {editingId != null ? `Update ${form.sku}` : 'Add a SKU catalog entry'}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeForm}
                className="inline-flex h-9 w-9 items-center justify-center border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-4 border-b border-gray-200 px-5 py-5 md:grid-cols-2">
              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>SKU</span>
                <input
                  type="text"
                  value={form.sku}
                  disabled={editingId != null}
                  onChange={(e) => setForm((c) => ({ ...c, sku: e.target.value }))}
                  placeholder="ABC-123"
                  className={`${inputClass} font-mono ${editingId != null ? 'cursor-not-allowed bg-gray-50 text-gray-500' : ''}`}
                />
                {editingId != null && (
                  <span className={`block ${fieldLabel} text-gray-400`}>SKU is the natural key and can&apos;t be changed.</span>
                )}
              </label>

              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>Category</span>
                <input
                  type="text"
                  value={form.category}
                  onChange={(e) => setForm((c) => ({ ...c, category: e.target.value }))}
                  placeholder="Optional"
                  className={inputClass}
                />
              </label>

              <label className="space-y-1 md:col-span-2">
                <span className={`block ${sectionLabel}`}>Product Title</span>
                <input
                  type="text"
                  value={form.productTitle}
                  onChange={(e) => setForm((c) => ({ ...c, productTitle: e.target.value }))}
                  placeholder="Human-readable product name"
                  className={inputClass}
                />
              </label>

              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>UPC</span>
                <div className="relative">
                  <Barcode className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300" />
                  <input
                    type="text"
                    value={form.upc}
                    onChange={(e) => setForm((c) => ({ ...c, upc: e.target.value }))}
                    placeholder="Optional"
                    className={`${inputClass} pl-9 font-mono`}
                  />
                </div>
              </label>

              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>EAN</span>
                <div className="relative">
                  <Barcode className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300" />
                  <input
                    type="text"
                    value={form.ean}
                    onChange={(e) => setForm((c) => ({ ...c, ean: e.target.value }))}
                    placeholder="Optional"
                    className={`${inputClass} pl-9 font-mono`}
                  />
                </div>
              </label>

              <label className="space-y-1 md:col-span-2">
                <span className={`block ${sectionLabel}`}>Image URL</span>
                <input
                  type="text"
                  value={form.imageUrl}
                  onChange={(e) => setForm((c) => ({ ...c, imageUrl: e.target.value }))}
                  placeholder="https://…"
                  className={inputClass}
                />
              </label>

              <label className="flex items-center gap-3 border border-gray-200 px-3 py-3 md:col-span-2">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((c) => ({ ...c, isActive: e.target.checked }))}
                  className="h-4 w-4 border-gray-300 text-gray-900 focus:ring-gray-300"
                />
                <span className={`${sectionLabel} text-gray-700`}>Active (visible in pickers and lists)</span>
              </label>
            </div>

            <div className="flex items-center justify-between gap-2 px-5 py-4">
              <span className={`${fieldLabel} text-gray-400`}>{loadingDetail ? 'Loading current values…' : ''}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeForm}
                  className={`${sectionLabel} border border-gray-300 px-4 py-2 text-gray-700 transition-colors hover:bg-gray-50`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isSaving || loadingDetail}
                  className={`${sectionLabel} border border-gray-900 bg-gray-900 px-4 py-2 text-white transition-colors hover:bg-gray-800 disabled:opacity-50`}
                >
                  {isSaving ? 'Saving...' : editingId != null ? 'Save Changes' : 'Create SKU'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
