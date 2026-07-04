'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { Edit, Plus, Trash2, X } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
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
  applies_to?: string[] | null;
}

type Direction = ReasonCodeRecord['direction'];

const DIRECTION_OPTIONS: Array<{ value: Direction; label: string }> = [
  { value: 'either', label: 'Either' },
  { value: 'in', label: 'In' },
  { value: 'out', label: 'Out' },
];

/**
 * User-selectable categories. Must stay within the DB `reason_codes_category_chk`
 * set; `initial` is system-only (seed balances) so it's omitted from the picker.
 */
const CATEGORY_OPTIONS = ['movement', 'adjustment', 'shrinkage', 'sale', 'return'] as const;

interface ReasonCodeFormState {
  code: string;
  label: string;
  category: string;
  direction: Direction;
  requiresNote: boolean;
  requiresPhoto: boolean;
  sortOrder: string;
  appliesTo: string[];
}

const DEFAULT_FORM_STATE: ReasonCodeFormState = {
  code: '',
  label: '',
  category: 'adjustment',
  direction: 'either',
  requiresNote: false,
  requiresPhoto: false,
  sortOrder: '0',
  appliesTo: [],
};

const inputClass =
  'h-10 w-full border border-border-soft bg-surface-card px-3 text-sm font-semibold text-text-default outline-none transition-colors focus:border-border-emphasis';

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

  // Workflow nodes for the D3 applies_to (per-node palette) editor.
  const { data: nodesData } = useQuery<{ nodes: Array<{ id: string; label: string; definitionName: string | null }> }>({
    queryKey: ['catalog', 'workflow-nodes'],
    queryFn: async () => {
      const res = await fetch('/api/catalog/workflow-nodes');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('Failed to load workflow nodes');
      return body;
    },
  });
  const workflowNodes = nodesData?.nodes ?? [];

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
          appliesTo: payload.appliesTo.length > 0 ? payload.appliesTo : null,
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
      appliesTo: row.applies_to ?? [],
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
          <p className={`${sectionLabel} truncate text-text-default`}>Reason Codes</p>
          <div className={`${sectionLabel} flex flex-wrap items-center gap-4`}>
            <span>Total {rows.length}</span>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter code / label / category"
              className="h-8 w-64 border border-border-soft bg-surface-card px-3 text-xs font-medium text-text-default outline-none focus:border-border-emphasis"
            />
            <Button variant="secondary" size="sm" icon={<Plus />} onClick={openAdd}>
              Add Code
            </Button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col overflow-hidden border-y border-border-soft bg-surface-card">
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-[980px]">
              <div className={`${tableGridClass} ${tableHeader} border-b border-border-soft px-4 py-3`}>
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
                <div className="px-6 py-10 text-sm font-medium text-text-soft">Loading reason codes...</div>
              ) : filtered.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <p className={sectionLabel}>No Reason Codes</p>
                  <p className="mt-2 text-sm font-medium text-text-soft">
                    {rows.length === 0 ? 'Add the first reason code for inventory adjustments.' : 'No codes match your filter.'}
                  </p>
                </div>
              ) : (
                filtered.map((row) => (
                  <div key={row.id} className={`${tableGridClass} items-center border-b border-border-hairline px-4 py-3 text-sm last:border-b-0`}>
                    <p className={`${tableCell} truncate font-mono uppercase`}>{row.code}</p>
                    <p className={`${tableCell} truncate`}>{row.label}</p>
                    <p className={`${tableCell} truncate uppercase tracking-[0.16em] text-text-muted`}>{row.category}</p>
                    <p className={`${tableHeader} text-text-muted`}>{row.direction}</p>
                    <p className={`${tableHeader} ${row.requires_note ? 'text-emerald-700' : 'text-text-faint'}`}>
                      {row.requires_note ? 'Yes' : '-'}
                    </p>
                    <p className={`${tableHeader} ${row.requires_photo ? 'text-emerald-700' : 'text-text-faint'}`}>
                      {row.requires_photo ? 'Yes' : '-'}
                    </p>
                    <p className={`${tableCell} text-text-muted`}>{row.sort_order}</p>
                    <div className="flex items-center justify-end gap-2">
                      <HoverTooltip label="Edit reason code" asChild>
                        <IconButton
                          onClick={() => openEdit(row)}
                          className="inline-flex h-8 w-8 items-center justify-center border border-border-soft hover:bg-surface-hover"
                          ariaLabel={`Edit ${row.code}`}
                          icon={<Edit className="h-3.5 w-3.5" />}
                        />
                      </HoverTooltip>
                      <HoverTooltip label="Remove reason code" asChild>
                        <IconButton
                          onClick={() => handleDelete(row)}
                          disabled={deleteMutation.isPending}
                          className="inline-flex h-8 w-8 items-center justify-center border border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          ariaLabel={`Remove ${row.code}`}
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
          {/* ds-raw-button: full-bleed modal scrim, not a styled control */}
          <button type="button" className="absolute inset-0 bg-gray-950/30" onClick={closeForm} aria-label="Close reason code form" />
          <div className="relative flex w-full max-w-2xl flex-col overflow-hidden border border-border-soft bg-surface-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border-soft px-5 py-4">
              <div>
                <p className={sectionLabel}>{editingId != null ? 'Edit Reason Code' : 'New Reason Code'}</p>
                <h3 className="mt-1 text-base font-semibold text-text-default">
                  {editingId != null ? `Update ${form.code}` : 'Add an inventory reason code'}
                </h3>
              </div>
              <IconButton
                onClick={closeForm}
                className="inline-flex h-9 w-9 items-center justify-center border border-border-soft hover:bg-surface-hover"
                ariaLabel="Close"
                icon={<X className="h-4 w-4" />}
              />
            </div>

            <div className="grid gap-4 border-b border-border-soft px-5 py-5 md:grid-cols-2">
              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>Code</span>
                <input
                  type="text"
                  value={form.code}
                  disabled={editingId != null}
                  onChange={(e) => setForm((c) => ({ ...c, code: e.target.value.toUpperCase() }))}
                  placeholder="DAMAGED"
                  className={`${inputClass} ${editingId != null ? 'cursor-not-allowed bg-surface-canvas text-text-soft' : ''}`}
                />
                {editingId != null && (
                  <span className={`block ${fieldLabel} text-text-faint`}>Code is the key and can&apos;t be changed.</span>
                )}
              </label>

              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>Category</span>
                <select
                  value={form.category}
                  onChange={(e) => setForm((c) => ({ ...c, category: e.target.value }))}
                  className={inputClass}
                >
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
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

              <div className="space-y-1 md:col-span-2">
                <span className={`block ${sectionLabel}`}>Applies to nodes</span>
                <span className={`block ${fieldLabel} text-text-faint`}>
                  Empty = applies to every node (global). Select nodes to scope this reason to them (D3 palette).
                </span>
                <div className="mt-1 max-h-40 space-y-1 overflow-y-auto border border-border-soft bg-surface-card p-2">
                  {workflowNodes.length === 0 ? (
                    <p className="text-xs font-medium text-text-faint">No workflow nodes available.</p>
                  ) : (
                    workflowNodes.map((node) => (
                      <label key={node.id} className="flex cursor-pointer items-center gap-2 rounded p-1 hover:bg-surface-hover">
                        <input
                          type="checkbox"
                          checked={form.appliesTo.includes(node.id)}
                          onChange={(e) =>
                            setForm((c) => ({
                              ...c,
                              appliesTo: e.target.checked
                                ? [...c.appliesTo, node.id]
                                : c.appliesTo.filter((nid) => nid !== node.id),
                            }))
                          }
                          className="h-4 w-4 border-border-default text-text-default focus:ring-border-default"
                        />
                        <span className="text-xs font-medium text-text-muted">
                          {node.label}
                          {node.definitionName ? <span className="ml-1 text-text-faint">({node.definitionName})</span> : null}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <label className="flex items-center gap-3 border border-border-soft px-3 py-3">
                <input
                  type="checkbox"
                  checked={form.requiresNote}
                  onChange={(e) => setForm((c) => ({ ...c, requiresNote: e.target.checked }))}
                  className="h-4 w-4 border-border-default text-text-default focus:ring-border-default"
                />
                <span className={`${sectionLabel} text-text-muted`}>Requires note</span>
              </label>

              <label className="flex items-center gap-3 border border-border-soft px-3 py-3">
                <input
                  type="checkbox"
                  checked={form.requiresPhoto}
                  onChange={(e) => setForm((c) => ({ ...c, requiresPhoto: e.target.checked }))}
                  className="h-4 w-4 border-border-default text-text-default focus:ring-border-default"
                />
                <span className={`${sectionLabel} text-text-muted`}>Requires photo</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4">
              <Button variant="secondary" size="md" onClick={closeForm}>
                Cancel
              </Button>
              <Button variant="brand" size="md" onClick={handleSubmit} disabled={isSaving}>
                {isSaving ? 'Saving...' : editingId != null ? 'Save Changes' : 'Create Code'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
