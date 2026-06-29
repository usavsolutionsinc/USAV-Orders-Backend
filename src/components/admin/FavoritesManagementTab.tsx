'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { Edit, Plus, Trash2, X } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { mainStickyHeaderClass, mainStickyHeaderShellRowClass } from '@/components/layout/header-shell';
import { toast } from '@/lib/toast';
import { sectionLabel, tableHeader, tableCell } from '@/design-system/tokens/typography/presets';

/** Keep in sync with FAVORITE_WORKSPACE_KEYS in src/lib/favorites/sku-favorites.ts. */
const WORKSPACES = [
  { key: 'repair', label: 'Repair' },
  { key: 'sku-stock', label: 'SKU Stock' },
  { key: 'fba', label: 'FBA' },
] as const;

type WorkspaceKey = (typeof WORKSPACES)[number]['key'];

/** Mirrors FavoriteSkuRecord from GET /api/favorites (camelCase). */
interface FavoriteRecord {
  id: number;
  ecwidProductId: string | null;
  sku: string;
  label: string;
  productTitle: string | null;
  issueTemplate: string | null;
  defaultPrice: string | null;
  notes: string | null;
  sortOrder: number;
  isActive: boolean;
}

interface FavoriteFormState {
  sku: string;
  label: string;
  productTitle: string;
  defaultPrice: string;
  issueTemplate: string;
  notes: string;
  ecwidProductId: string;
  sortOrder: string;
  isActive: boolean;
}

const DEFAULT_FORM_STATE: FavoriteFormState = {
  sku: '',
  label: '',
  productTitle: '',
  defaultPrice: '',
  issueTemplate: '',
  notes: '',
  ecwidProductId: '',
  sortOrder: '0',
  isActive: true,
};

const inputClass =
  'h-10 w-full border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-gray-400';

function toNullable(value: string): string | null {
  const v = value.trim();
  return v.length > 0 ? v : null;
}

/**
 * Manage favorite SKU shortcuts per workspace (repair / sku-stock / fba). These
 * power the quick-pick pickers in each workspace; this tab is the source of truth
 * for editing them. The list shows only active favorites; turning Active off
 * hides one, Delete removes it permanently.
 */
export function FavoritesManagementTab() {
  const queryClient = useQueryClient();
  const [workspace, setWorkspace] = useState<WorkspaceKey>('repair');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FavoriteFormState>(DEFAULT_FORM_STATE);
  const [filter, setFilter] = useState('');

  const { data, isLoading } = useQuery<{ favorites: FavoriteRecord[] }>({
    queryKey: qk.favorites.list(workspace),
    queryFn: async () => {
      const res = await fetch(`/api/favorites?workspace=${encodeURIComponent(workspace)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.details || body?.error || 'Failed to load favorites');
      return body;
    },
  });

  const rows = data?.favorites ?? [];

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.sku.toLowerCase().includes(q) ||
        r.label.toLowerCase().includes(q) ||
        (r.productTitle ?? '').toLowerCase().includes(q),
    );
  }, [rows, filter]);

  const buildPayload = (payload: FavoriteFormState) => ({
    workspaceKey: workspace,
    sku: payload.sku.trim(),
    label: payload.label.trim(),
    productTitle: toNullable(payload.productTitle),
    defaultPrice: toNullable(payload.defaultPrice),
    issueTemplate: toNullable(payload.issueTemplate),
    notes: toNullable(payload.notes),
    ecwidProductId: toNullable(payload.ecwidProductId),
    sortOrder: Number(payload.sortOrder || 0),
    isActive: payload.isActive,
  });

  const createMutation = useMutation({
    mutationFn: async (payload: FavoriteFormState) => {
      const res = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(payload)),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.details || body?.error || 'Failed to create favorite');
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.favorites.all });
      toast.success('Favorite created');
      closeForm();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: FavoriteFormState }) => {
      const res = await fetch(`/api/favorites/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(payload)),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.details || body?.error || 'Failed to update favorite');
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.favorites.all });
      toast.success('Favorite updated');
      closeForm();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/favorites/${id}?workspace=${encodeURIComponent(workspace)}`, {
        method: 'DELETE',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.details || body?.error || 'Failed to remove favorite');
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.favorites.all });
      toast.success('Favorite removed');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setForm(DEFAULT_FORM_STATE);
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(DEFAULT_FORM_STATE);
    setIsFormOpen(true);
  };

  const openEdit = (row: FavoriteRecord) => {
    setEditingId(row.id);
    setForm({
      sku: row.sku,
      label: row.label,
      productTitle: row.productTitle ?? '',
      defaultPrice: row.defaultPrice ?? '',
      issueTemplate: row.issueTemplate ?? '',
      notes: row.notes ?? '',
      ecwidProductId: row.ecwidProductId ?? '',
      sortOrder: String(row.sortOrder ?? 0),
      isActive: row.isActive,
    });
    setIsFormOpen(true);
  };

  const handleSubmit = () => {
    if (!form.sku.trim()) return toast.error('SKU is required');
    if (!form.label.trim()) return toast.error('Label is required');
    if (editingId != null) {
      updateMutation.mutate({ id: editingId, payload: form });
      return;
    }
    createMutation.mutate(form);
  };

  const handleDelete = (row: FavoriteRecord) => {
    if (!window.confirm(`Remove favorite "${row.label}" (${row.sku}) from ${workspace}? This deletes it permanently — to hide it instead, edit and turn off Active.`)) {
      return;
    }
    deleteMutation.mutate(row.id);
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const tableGridClass = 'grid grid-cols-[160px_minmax(200px,1.5fr)_minmax(160px,1fr)_100px_80px_90px_108px] gap-x-3';

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-[linear-gradient(180deg,#ffffff_0%,#f5f7fa_100%)]">
      <div className={mainStickyHeaderClass}>
        <div className={`${mainStickyHeaderShellRowClass} flex-wrap gap-y-2 px-4`}>
          <div className="flex items-center gap-4">
            <p className={`${sectionLabel} truncate text-gray-900`}>Favorites</p>
            <div className="flex items-center border border-gray-200">
              {WORKSPACES.map((w) => (
                <Button
                  key={w.key}
                  variant={workspace === w.key ? 'brand' : 'ghost'}
                  size="sm"
                  onClick={() => {
                    setWorkspace(w.key);
                    setFilter('');
                  }}
                  className={`${tableHeader} rounded-none`}
                >
                  {w.label}
                </Button>
              ))}
            </div>
          </div>
          <div className={`${sectionLabel} flex flex-wrap items-center gap-4`}>
            <span>Total {rows.length}</span>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter sku / label / title"
              className="h-8 w-64 border border-gray-200 bg-white px-3 text-xs font-medium text-gray-900 outline-none focus:border-gray-400"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={openAdd}
              icon={<Plus className="h-3 w-3" />}
              className={`${sectionLabel} rounded-none`}
            >
              Add Favorite
            </Button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col overflow-hidden border-y border-gray-200 bg-white">
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-[980px]">
              <div className={`${tableGridClass} ${tableHeader} border-b border-gray-200 px-4 py-3`}>
                <p>SKU</p>
                <p>Label</p>
                <p>Product Title</p>
                <p>Price</p>
                <p>Sort</p>
                <p>Status</p>
                <p className="text-right">Actions</p>
              </div>

              {isLoading ? (
                <div className="px-6 py-10 text-sm font-medium text-gray-500">Loading favorites...</div>
              ) : filtered.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <p className={sectionLabel}>No Favorites</p>
                  <p className="mt-2 text-sm font-medium text-gray-500">
                    {rows.length === 0 ? `Add the first favorite for the ${workspace} workspace.` : 'No favorites match your filter.'}
                  </p>
                </div>
              ) : (
                filtered.map((row) => (
                  <div key={row.id} className={`${tableGridClass} items-center border-b border-gray-100 px-4 py-3 text-sm last:border-b-0`}>
                    {/* ds-allow-title: native tooltip shows full value when truncated */}
                    <p className={`${tableCell} truncate font-mono`} title={row.sku}>{row.sku}</p>
                    {/* ds-allow-title: native tooltip shows full value when truncated */}
                    <p className={`${tableCell} truncate`} title={row.label}>{row.label}</p>
                    {/* ds-allow-title: native tooltip shows full value when truncated */}
                    <p className={`${tableCell} truncate text-gray-600`} title={row.productTitle ?? ''}>{row.productTitle || '-'}</p>
                    <p className={`${tableCell} text-gray-600`}>{row.defaultPrice ? `$${row.defaultPrice}` : '-'}</p>
                    <p className={`${tableCell} text-gray-600`}>{row.sortOrder}</p>
                    <p className={`${tableHeader} ${row.isActive ? 'text-emerald-700' : 'text-gray-400'}`}>
                      {row.isActive ? 'Active' : 'Hidden'}
                    </p>
                    <div className="flex items-center justify-end gap-2">
                      <HoverTooltip label="Edit favorite" asChild>
                        <IconButton
                          onClick={() => openEdit(row)}
                          className="inline-flex h-8 w-8 items-center justify-center border border-gray-200 transition-colors hover:bg-gray-50"
                          ariaLabel={`Edit ${row.label}`}
                          icon={<Edit className="h-3.5 w-3.5" />}
                        />
                      </HoverTooltip>
                      <HoverTooltip label="Remove favorite" asChild>
                        <IconButton
                          onClick={() => handleDelete(row)}
                          disabled={deleteMutation.isPending}
                          className="inline-flex h-8 w-8 items-center justify-center border border-rose-200 text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
                          ariaLabel={`Remove ${row.label}`}
                          icon={<Trash2 className="h-3.5 w-3.5" />}
                        />
                      </HoverTooltip>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {isFormOpen && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
          {/* ds-raw-button: full-bleed modal scrim/overlay dismiss target, not a DS Button */}
          <button type="button" className="absolute inset-0 bg-gray-950/30" onClick={closeForm} aria-label="Close favorite form" />
          <div className="relative flex w-full max-w-2xl flex-col overflow-hidden border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <p className={sectionLabel}>{editingId != null ? 'Edit Favorite' : 'New Favorite'}</p>
                <h3 className="mt-1 text-base font-semibold text-gray-900">
                  {editingId != null ? `Update ${form.label || form.sku}` : `Add a ${workspace} favorite`}
                </h3>
              </div>
              <IconButton
                onClick={closeForm}
                className="inline-flex h-9 w-9 items-center justify-center border border-gray-200 transition-colors hover:bg-gray-50"
                ariaLabel="Close"
                icon={<X className="h-4 w-4" />}
              />
            </div>

            <div className="grid gap-4 border-b border-gray-200 px-5 py-5 md:grid-cols-2">
              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>SKU</span>
                <input
                  type="text"
                  value={form.sku}
                  onChange={(e) => setForm((c) => ({ ...c, sku: e.target.value }))}
                  placeholder="ABC-123"
                  className={`${inputClass} font-mono`}
                />
              </label>

              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>Label</span>
                <input
                  type="text"
                  value={form.label}
                  onChange={(e) => setForm((c) => ({ ...c, label: e.target.value }))}
                  placeholder="Quick-pick name"
                  className={inputClass}
                />
              </label>

              <label className="space-y-1 md:col-span-2">
                <span className={`block ${sectionLabel}`}>Product Title</span>
                <input
                  type="text"
                  value={form.productTitle}
                  onChange={(e) => setForm((c) => ({ ...c, productTitle: e.target.value }))}
                  placeholder="Optional"
                  className={inputClass}
                />
              </label>

              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>Default Price</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.defaultPrice}
                  onChange={(e) => setForm((c) => ({ ...c, defaultPrice: e.target.value }))}
                  placeholder="Optional"
                  className={inputClass}
                />
              </label>

              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>Sort Order</span>
                <input
                  type="number"
                  min={0}
                  value={form.sortOrder}
                  onChange={(e) => setForm((c) => ({ ...c, sortOrder: e.target.value }))}
                  className={inputClass}
                />
              </label>

              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>Ecwid Product ID</span>
                <input
                  type="text"
                  value={form.ecwidProductId}
                  onChange={(e) => setForm((c) => ({ ...c, ecwidProductId: e.target.value }))}
                  placeholder="Optional"
                  className={`${inputClass} font-mono`}
                />
              </label>

              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>Issue Template</span>
                <input
                  type="text"
                  value={form.issueTemplate}
                  onChange={(e) => setForm((c) => ({ ...c, issueTemplate: e.target.value }))}
                  placeholder="Optional"
                  className={inputClass}
                />
              </label>

              <label className="space-y-1 md:col-span-2">
                <span className={`block ${sectionLabel}`}>Notes</span>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))}
                  placeholder="Optional"
                  rows={2}
                  className="w-full border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-gray-400"
                />
              </label>

              <label className="flex items-center gap-3 border border-gray-200 px-3 py-3 md:col-span-2">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((c) => ({ ...c, isActive: e.target.checked }))}
                  className="h-4 w-4 border-gray-300 text-gray-900 focus:ring-gray-300"
                />
                <span className={`${sectionLabel} text-gray-700`}>Active (shown in the {workspace} picker)</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4">
              <Button
                variant="secondary"
                size="md"
                onClick={closeForm}
                className={`${sectionLabel} rounded-none`}
              >
                Cancel
              </Button>
              <Button
                variant="brand"
                size="md"
                onClick={handleSubmit}
                disabled={isSaving}
                className={`${sectionLabel} rounded-none`}
              >
                {isSaving ? 'Saving...' : editingId != null ? 'Save Changes' : 'Create Favorite'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
