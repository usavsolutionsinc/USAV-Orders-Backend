'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { Edit, Plus, Trash2, X } from '@/components/Icons';
import { mainStickyHeaderClass, mainStickyHeaderShellRowClass } from '@/components/layout/header-shell';
import { toast } from '@/lib/toast';
import { sectionLabel, fieldLabel, tableHeader, tableCell } from '@/design-system/tokens/typography/presets';

/** Mirrors the rows returned by GET /api/reason-codes. */
interface ReasonCodeRecord {
  id: number;
  code: string;
  label: string;
  category: string;
  direction: 'in' | 'out' | 'either';
  requires_note: boolean;
  requires_photo: boolean;
  sort_order: number;
}

type Direction = ReasonCodeRecord['direction'];

const DIRECTION_OPTIONS: Array<{ value: Direction; label: string }> = [
  { value: 'either', label: 'Either' },
  { value: 'in', label: 'In' },
  { value: 'out', label: 'Out' },
];

interface ReasonCodeFormState {
  code: string;
  label: string;
  category: string;
  direction: Direction;
  requiresNote: boolean;
  requiresPhoto: boolean;
  sortOrder: string;
}

const DEFAULT_FORM_STATE: ReasonCodeFormState = {
  code: '',
  label: '',
  category: '',
  direction: 'either',
  requiresNote: false,
  requiresPhoto: false,
  sortOrder: '0',
};

const inputClass =
  'h-10 w-full border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-gray-400';

export function ReasonCodesManagementTab() {
  const queryClient = useQueryClient();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ReasonCodeFormState>(DEFAULT_FORM_STATE);
  const [filter, setFilter] = useState('');

  const { data, isLoading } = useQuery<{ reason_codes: ReasonCodeRecord[] }>({
    queryKey: qk.reasonCodes.list(),
    queryFn: async () => {
      const res = await fetch('/api/reason-codes');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.details || body?.error || 'Failed to load reason codes');
      return body;
    },
  });

  const rows = data?.reason_codes ?? [];

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.code.toLowerCase().includes(q) ||
        r.label.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q),
    );
  }, [rows, filter]);

  const createMutation = useMutation({
    mutationFn: async (payload: ReasonCodeFormState) => {
      const res = await fetch('/api/reason-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: payload.code,
          label: payload.label,
          category: payload.category,
          direction: payload.direction,
          requiresNote: payload.requiresNote,
          requiresPhoto: payload.requiresPhoto,
          sortOrder: Number(payload.sortOrder || 0),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) throw new Error('A reason code with that code already exists');
        throw new Error(body?.details || body?.error || 'Failed to create reason code');
      }
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.reasonCodes.all });
      toast.success('Reason code created');
      closeForm();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: ReasonCodeFormState }) => {
      const res = await fetch(`/api/reason-codes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: payload.label,
          category: payload.category,
          direction: payload.direction,
          requiresNote: payload.requiresNote,
          requiresPhoto: payload.requiresPhoto,
          sortOrder: Number(payload.sortOrder || 0),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.details || body?.error || 'Failed to update reason code');
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.reasonCodes.all });
      toast.success('Reason code updated');
      closeForm();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/reason-codes/${id}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.details || body?.error || 'Failed to delete reason code');
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.reasonCodes.all });
      toast.success('Reason code removed');
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

  const openEdit = (row: ReasonCodeRecord) => {
    setEditingId(row.id);
    setForm({
      code: row.code,
      label: row.label,
      category: row.category,
      direction: row.direction,
      requiresNote: row.requires_note,
      requiresPhoto: row.requires_photo,
      sortOrder: String(row.sort_order ?? 0),
    });
    setIsFormOpen(true);
  };

  const handleSubmit = () => {
    if (!form.code.trim()) return toast.error('Code is required');
    if (!form.label.trim()) return toast.error('Label is required');
    if (!form.category.trim()) return toast.error('Category is required');

    if (editingId != null) {
      updateMutation.mutate({ id: editingId, payload: form });
      return;
    }
    createMutation.mutate(form);
  };

  const handleDelete = (row: ReasonCodeRecord) => {
    if (!window.confirm(`Remove reason code "${row.code}"? It will be hidden from pickers.`)) return;
    deleteMutation.mutate(row.id);
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const tableGridClass =
    'grid grid-cols-[160px_minmax(200px,1.5fr)_140px_110px_90px_90px_80px_108px] gap-x-3';

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-[linear-gradient(180deg,#ffffff_0%,#f5f7fa_100%)]">
      <div className={mainStickyHeaderClass}>
        <div className={`${mainStickyHeaderShellRowClass} flex-wrap gap-y-2 px-4`}>
          <p className={`${sectionLabel} truncate text-gray-900`}>Reason Codes</p>
          <div className={`${sectionLabel} flex flex-wrap items-center gap-4`}>
            <span>Total {rows.length}</span>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter code / label / category"
              className="h-8 w-64 border border-gray-200 bg-white px-3 text-xs font-medium text-gray-900 outline-none focus:border-gray-400"
            />
            <button
              type="button"
              onClick={openAdd}
              className={`${sectionLabel} inline-flex items-center gap-2 border border-gray-300 px-3 py-1.5 text-gray-800 transition-colors hover:bg-gray-50`}
            >
              <Plus className="h-3 w-3" />
              Add Code
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col overflow-hidden border-y border-gray-200 bg-white">
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-[980px]">
              <div className={`${tableGridClass} ${tableHeader} border-b border-gray-200 px-4 py-3`}>
                <p>Code</p>
                <p>Label</p>
                <p>Category</p>
                <p>Direction</p>
                <p>Note</p>
                <p>Photo</p>
                <p>Sort</p>
                <p className="text-right">Actions</p>
              </div>

              {isLoading ? (
                <div className="px-6 py-10 text-sm font-medium text-gray-500">Loading reason codes...</div>
              ) : filtered.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <p className={sectionLabel}>No Reason Codes</p>
                  <p className="mt-2 text-sm font-medium text-gray-500">
                    {rows.length === 0 ? 'Add the first reason code for inventory adjustments.' : 'No codes match your filter.'}
                  </p>
                </div>
              ) : (
                filtered.map((row) => (
                  <div key={row.id} className={`${tableGridClass} items-center border-b border-gray-100 px-4 py-3 text-sm last:border-b-0`}>
                    <p className={`${tableCell} truncate font-mono uppercase`}>{row.code}</p>
                    <p className={`${tableCell} truncate`}>{row.label}</p>
                    <p className={`${tableCell} truncate uppercase tracking-[0.16em] text-gray-600`}>{row.category}</p>
                    <p className={`${tableHeader} text-gray-700`}>{row.direction}</p>
                    <p className={`${tableHeader} ${row.requires_note ? 'text-emerald-700' : 'text-gray-400'}`}>
                      {row.requires_note ? 'Yes' : '-'}
                    </p>
                    <p className={`${tableHeader} ${row.requires_photo ? 'text-emerald-700' : 'text-gray-400'}`}>
                      {row.requires_photo ? 'Yes' : '-'}
                    </p>
                    <p className={`${tableCell} text-gray-600`}>{row.sort_order}</p>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        className="inline-flex h-8 w-8 items-center justify-center border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
                        title="Edit reason code"
                        aria-label={`Edit ${row.code}`}
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(row)}
                        disabled={deleteMutation.isPending}
                        className="inline-flex h-8 w-8 items-center justify-center border border-rose-200 text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
                        title="Remove reason code"
                        aria-label={`Remove ${row.code}`}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-gray-950/30" onClick={closeForm} aria-label="Close reason code form" />
          <div className="relative flex w-full max-w-2xl flex-col overflow-hidden border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <p className={sectionLabel}>{editingId != null ? 'Edit Reason Code' : 'New Reason Code'}</p>
                <h3 className="mt-1 text-base font-semibold text-gray-900">
                  {editingId != null ? `Update ${form.code}` : 'Add an inventory reason code'}
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
                <span className={`block ${sectionLabel}`}>Code</span>
                <input
                  type="text"
                  value={form.code}
                  disabled={editingId != null}
                  onChange={(e) => setForm((c) => ({ ...c, code: e.target.value.toUpperCase() }))}
                  placeholder="DAMAGED"
                  className={`${inputClass} ${editingId != null ? 'cursor-not-allowed bg-gray-50 text-gray-500' : ''}`}
                />
                {editingId != null && (
                  <span className={`block ${fieldLabel} text-gray-400`}>Code is the key and can&apos;t be changed.</span>
                )}
              </label>

              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>Category</span>
                <input
                  type="text"
                  value={form.category}
                  onChange={(e) => setForm((c) => ({ ...c, category: e.target.value }))}
                  placeholder="shrinkage, cycle_count..."
                  className={inputClass}
                />
              </label>

              <label className="space-y-1 md:col-span-2">
                <span className={`block ${sectionLabel}`}>Label</span>
                <input
                  type="text"
                  value={form.label}
                  onChange={(e) => setForm((c) => ({ ...c, label: e.target.value }))}
                  placeholder="Human-readable name shown in the picker"
                  className={inputClass}
                />
              </label>

              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>Direction</span>
                <select
                  value={form.direction}
                  onChange={(e) => setForm((c) => ({ ...c, direction: e.target.value as Direction }))}
                  className={inputClass}
                >
                  {DIRECTION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
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

              <label className="flex items-center gap-3 border border-gray-200 px-3 py-3">
                <input
                  type="checkbox"
                  checked={form.requiresNote}
                  onChange={(e) => setForm((c) => ({ ...c, requiresNote: e.target.checked }))}
                  className="h-4 w-4 border-gray-300 text-gray-900 focus:ring-gray-300"
                />
                <span className={`${sectionLabel} text-gray-700`}>Requires note</span>
              </label>

              <label className="flex items-center gap-3 border border-gray-200 px-3 py-3">
                <input
                  type="checkbox"
                  checked={form.requiresPhoto}
                  onChange={(e) => setForm((c) => ({ ...c, requiresPhoto: e.target.checked }))}
                  className="h-4 w-4 border-gray-300 text-gray-900 focus:ring-gray-300"
                />
                <span className={`${sectionLabel} text-gray-700`}>Requires photo</span>
              </label>
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
                {isSaving ? 'Saving...' : editingId != null ? 'Save Changes' : 'Create Code'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
