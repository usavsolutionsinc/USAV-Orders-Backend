'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { Edit, Plus, Trash2, X } from '@/components/Icons';
import { mainStickyHeaderClass, mainStickyHeaderShellRowClass } from '@/components/layout/header-shell';
import { toast } from '@/lib/toast';
import { sectionLabel, fieldLabel, tableHeader, tableCell } from '@/design-system/tokens/typography/presets';

/** Mirrors a row from GET /api/repair/issues (RepairIssueTemplate). */
interface RepairIssueRecord {
  id: number;
  favorite_sku_id: number | null;
  label: string;
  category: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
}

interface IssueFormState {
  label: string;
  category: string;
  sortOrder: string;
  active: boolean;
}

const DEFAULT_FORM_STATE: IssueFormState = {
  label: '',
  category: '',
  sortOrder: '0',
  active: true,
};

const inputClass =
  'h-10 w-full border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-gray-400';

/**
 * Manage GLOBAL repair issue templates (favorite_sku_id IS NULL) — the default
 * checklist shown for every repair. SKU-specific templates are managed inline
 * per-favorite in the repair workspace, not here.
 */
export function RepairIssuesManagementTab() {
  const queryClient = useQueryClient();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<IssueFormState>(DEFAULT_FORM_STATE);
  const [filter, setFilter] = useState('');

  const { data, isLoading } = useQuery<{ issues: RepairIssueRecord[] }>({
    queryKey: qk.repairIssues.list(),
    queryFn: async () => {
      const res = await fetch('/api/repair/issues');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.details || body?.error || 'Failed to load issue templates');
      return body;
    },
  });

  // GET returns global + SKU-specific; this admin view manages globals only.
  const rows = useMemo(
    () => (data?.issues ?? []).filter((r) => r.favorite_sku_id == null),
    [data],
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.label.toLowerCase().includes(q) || (r.category ?? '').toLowerCase().includes(q),
    );
  }, [rows, filter]);

  const createMutation = useMutation({
    mutationFn: async (payload: IssueFormState) => {
      const res = await fetch('/api/repair/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: payload.label.trim(),
          category: payload.category.trim() || null,
          sortOrder: Number(payload.sortOrder || 0),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.details || body?.error || 'Failed to create issue template');
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.repairIssues.all });
      toast.success('Issue template created');
      closeForm();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: IssueFormState }) => {
      const res = await fetch(`/api/repair/issues/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: payload.label.trim(),
          category: payload.category.trim() || null,
          sortOrder: Number(payload.sortOrder || 0),
          active: payload.active,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.details || body?.error || 'Failed to update issue template');
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.repairIssues.all });
      toast.success('Issue template updated');
      closeForm();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/repair/issues/${id}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.details || body?.error || 'Failed to delete issue template');
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.repairIssues.all });
      toast.success('Issue template removed');
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

  const openEdit = (row: RepairIssueRecord) => {
    setEditingId(row.id);
    setForm({
      label: row.label,
      category: row.category ?? '',
      sortOrder: String(row.sort_order ?? 0),
      active: row.active,
    });
    setIsFormOpen(true);
  };

  const handleSubmit = () => {
    if (!form.label.trim()) return toast.error('Label is required');
    if (editingId != null) {
      updateMutation.mutate({ id: editingId, payload: form });
      return;
    }
    createMutation.mutate(form);
  };

  const handleDelete = (row: RepairIssueRecord) => {
    if (!window.confirm(`Permanently delete issue template "${row.label}"? To hide it without deleting, edit it and turn off Active.`)) {
      return;
    }
    deleteMutation.mutate(row.id);
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const tableGridClass = 'grid grid-cols-[minmax(220px,2fr)_180px_90px_90px_108px] gap-x-3';

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-[linear-gradient(180deg,#ffffff_0%,#f5f7fa_100%)]">
      <div className={mainStickyHeaderClass}>
        <div className={`${mainStickyHeaderShellRowClass} flex-wrap gap-y-2 px-4`}>
          <p className={`${sectionLabel} truncate text-gray-900`}>Repair Issues</p>
          <div className={`${sectionLabel} flex flex-wrap items-center gap-4`}>
            <span>Total {rows.length}</span>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter label / category"
              className="h-8 w-64 border border-gray-200 bg-white px-3 text-xs font-medium text-gray-900 outline-none focus:border-gray-400"
            />
            <button
              type="button"
              onClick={openAdd}
              className={`${sectionLabel} inline-flex items-center gap-2 border border-gray-300 px-3 py-1.5 text-gray-800 transition-colors hover:bg-gray-50`}
            >
              <Plus className="h-3 w-3" />
              Add Issue
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col overflow-hidden border-y border-gray-200 bg-white">
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-[760px]">
              <div className={`${tableGridClass} ${tableHeader} border-b border-gray-200 px-4 py-3`}>
                <p>Label</p>
                <p>Category</p>
                <p>Sort</p>
                <p>Status</p>
                <p className="text-right">Actions</p>
              </div>

              {isLoading ? (
                <div className="px-6 py-10 text-sm font-medium text-gray-500">Loading issue templates...</div>
              ) : filtered.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <p className={sectionLabel}>No Issue Templates</p>
                  <p className="mt-2 text-sm font-medium text-gray-500">
                    {rows.length === 0 ? 'Add the first global repair issue template.' : 'No templates match your filter.'}
                  </p>
                </div>
              ) : (
                filtered.map((row) => (
                  <div key={row.id} className={`${tableGridClass} items-center border-b border-gray-100 px-4 py-3 text-sm last:border-b-0`}>
                    <p className={`${tableCell} truncate`} title={row.label}>{row.label}</p>
                    <p className={`${tableCell} truncate uppercase tracking-[0.16em] text-gray-600`}>{row.category || '-'}</p>
                    <p className={`${tableCell} text-gray-600`}>{row.sort_order}</p>
                    <p className={`${tableHeader} ${row.active ? 'text-emerald-700' : 'text-gray-400'}`}>
                      {row.active ? 'Active' : 'Hidden'}
                    </p>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        className="inline-flex h-8 w-8 items-center justify-center border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
                        title="Edit issue template"
                        aria-label={`Edit ${row.label}`}
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(row)}
                        disabled={deleteMutation.isPending}
                        className="inline-flex h-8 w-8 items-center justify-center border border-rose-200 text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
                        title="Delete issue template"
                        aria-label={`Delete ${row.label}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
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
          <button type="button" className="absolute inset-0 bg-gray-950/30" onClick={closeForm} aria-label="Close issue form" />
          <div className="relative flex w-full max-w-xl flex-col overflow-hidden border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <p className={sectionLabel}>{editingId != null ? 'Edit Issue Template' : 'New Issue Template'}</p>
                <h3 className="mt-1 text-base font-semibold text-gray-900">
                  {editingId != null ? `Update ${form.label}` : 'Add a global repair issue'}
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
              <label className="space-y-1 md:col-span-2">
                <span className={`block ${sectionLabel}`}>Label</span>
                <input
                  type="text"
                  value={form.label}
                  onChange={(e) => setForm((c) => ({ ...c, label: e.target.value }))}
                  placeholder="e.g. No power"
                  className={inputClass}
                />
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

              {editingId != null && (
                <label className="flex items-center gap-3 border border-gray-200 px-3 py-3 md:col-span-2">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm((c) => ({ ...c, active: e.target.checked }))}
                    className="h-4 w-4 border-gray-300 text-gray-900 focus:ring-gray-300"
                  />
                  <span className={`${sectionLabel} text-gray-700`}>Active (shown in repair checklists)</span>
                </label>
              )}
              {editingId == null && (
                <p className={`md:col-span-2 ${fieldLabel} text-gray-400`}>New templates are active by default.</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4">
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
                disabled={isSaving}
                className={`${sectionLabel} border border-gray-900 bg-gray-900 px-4 py-2 text-white transition-colors hover:bg-gray-800 disabled:opacity-50`}
              >
                {isSaving ? 'Saving...' : editingId != null ? 'Save Changes' : 'Create Issue'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
