'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Edit, Plus, Trash2, X } from '@/components/Icons';
import { mainStickyHeaderClass, mainStickyHeaderShellRowClass } from '@/components/layout/header-shell';
import { toast } from '@/lib/toast';
import { getActiveStaff, type StaffMember } from '@/lib/staffCache';
import { sectionLabel, fieldLabel, tableHeader, tableCell } from '@/design-system/tokens/typography/presets';
import type {
  AdminFeaturePriority,
  AdminFeatureRecord,
  AdminFeatureStatus,
  AdminFeatureType,
} from './types';

const FEATURE_TYPE_OPTIONS: Array<{ value: AdminFeatureType; label: string }> = [
  { value: 'feature', label: 'Feature' },
  { value: 'bug_fix', label: 'Bug Fix' },
];

const FEATURE_STATUS_OPTIONS: Array<{ value: AdminFeatureStatus; label: string }> = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
];

const FEATURE_PRIORITY_OPTIONS: Array<{ value: AdminFeaturePriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

interface FeatureFormState {
  title: string;
  description: string;
  type: AdminFeatureType;
  status: AdminFeatureStatus;
  priority: AdminFeaturePriority;
  pageArea: string;
  sortOrder: string;
  assignedToStaffId: string;
  isActive: boolean;
}

const DEFAULT_FORM_STATE: FeatureFormState = {
  title: '',
  description: '',
  type: 'feature',
  status: 'backlog',
  priority: 'medium',
  pageArea: '',
  sortOrder: '100',
  assignedToStaffId: '',
  isActive: true,
};

function formatDateTime(value: string | null) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString();
}

function getStatusTone(status: AdminFeatureStatus) {
  if (status === 'done') return 'text-emerald-700';
  if (status === 'in_progress') return 'text-blue-700';
  return 'text-amber-700';
}

function getPriorityTone(priority: AdminFeaturePriority) {
  if (priority === 'high') return 'text-red-700';
  if (priority === 'medium') return 'text-gray-700';
  return 'text-gray-500';
}

export function FeaturesManagementTab() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingFeatureId, setEditingFeatureId] = useState<number | null>(null);
  const [form, setForm] = useState<FeatureFormState>(DEFAULT_FORM_STATE);

  const search = (searchParams.get('search') || '').trim();
  const featureType = (searchParams.get('featureType') || '').trim();
  const featureStatus = (searchParams.get('featureStatus') || '').trim();
  const featureActive = (searchParams.get('featureActive') || '').trim();

  const { data: featureResponse, isLoading } = useQuery<{ rows: AdminFeatureRecord[] }>({
    queryKey: ['admin-features', search, featureType, featureStatus, featureActive],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (featureType) params.set('type', featureType);
      if (featureStatus) params.set('status', featureStatus);
      if (featureActive && featureActive !== 'all') params.set('active', featureActive);
      params.set('limit', '300');
      const res = await fetch(`/api/admin/features?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.details || data?.error || 'Failed to fetch feature rows');
      return data;
    },
  });

  const { data: staff = [] } = useQuery<StaffMember[]>({
    queryKey: ['staff', 'admin-features-form'],
    queryFn: () => getActiveStaff(),
  });

  const rows = featureResponse?.rows || [];

  const createMutation = useMutation({
    mutationFn: async (payload: FeatureFormState) => {
      const res = await fetch('/api/admin/features', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: payload.title,
          description: payload.description,
          type: payload.type,
          status: payload.status,
          priority: payload.priority,
          pageArea: payload.pageArea,
          sortOrder: Number(payload.sortOrder || 100),
          assignedToStaffId: payload.assignedToStaffId ? Number(payload.assignedToStaffId) : null,
          isActive: payload.isActive,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.details || data?.error || 'Failed to create feature');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-features'] });
      toast.success('Feature item created');
      closeForm();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create feature item');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: FeatureFormState }) => {
      const res = await fetch(`/api/admin/features/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: payload.title,
          description: payload.description,
          type: payload.type,
          status: payload.status,
          priority: payload.priority,
          pageArea: payload.pageArea,
          sortOrder: Number(payload.sortOrder || 100),
          assignedToStaffId: payload.assignedToStaffId ? Number(payload.assignedToStaffId) : null,
          isActive: payload.isActive,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.details || data?.error || 'Failed to update feature');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-features'] });
      toast.success('Feature item updated');
      closeForm();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update feature item');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/features/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.details || data?.error || 'Failed to delete feature');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-features'] });
      toast.success('Feature item deleted');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete feature item');
    },
  });

  useEffect(() => {
    const handleOpenAdd = () => {
      setEditingFeatureId(null);
      setForm(DEFAULT_FORM_STATE);
      setIsFormOpen(true);
    };

    window.addEventListener('admin-features-open-add', handleOpenAdd as EventListener);
    return () => window.removeEventListener('admin-features-open-add', handleOpenAdd as EventListener);
  }, []);

  const summary = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.total += 1;
        if (row.type === 'feature') acc.features += 1;
        if (row.type === 'bug_fix') acc.bugFixes += 1;
        if (row.status === 'in_progress') acc.inProgress += 1;
        if (row.status === 'done') acc.done += 1;
        if (row.isActive) acc.active += 1;
        return acc;
      },
      { total: 0, features: 0, bugFixes: 0, inProgress: 0, done: 0, active: 0 },
    );
  }, [rows]);

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingFeatureId(null);
    setForm(DEFAULT_FORM_STATE);
  };

  const openEdit = (row: AdminFeatureRecord) => {
    setEditingFeatureId(row.id);
    setForm({
      title: row.title,
      description: row.description || '',
      type: row.type,
      status: row.status,
      priority: row.priority,
      pageArea: row.pageArea || '',
      sortOrder: String(row.sortOrder || 100),
      assignedToStaffId: row.assignedToStaffId ? String(row.assignedToStaffId) : '',
      isActive: row.isActive,
    });
    setIsFormOpen(true);
  };

  const handleSubmit = () => {
    if (!form.title.trim()) {
      toast.error('Title is required');
      return;
    }

    if (editingFeatureId != null) {
      updateMutation.mutate({ id: editingFeatureId, payload: form });
      return;
    }

    createMutation.mutate(form);
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const tableGridClass =
    'grid grid-cols-[100px_minmax(240px,1.5fr)_120px_120px_120px_140px_108px_150px] gap-x-3';

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-[linear-gradient(180deg,#ffffff_0%,#f5f7fa_100%)]">
      <div className={mainStickyHeaderClass}>
        <div className={`${mainStickyHeaderShellRowClass} flex-wrap gap-y-2 px-4`}>
          <p className={`${sectionLabel} truncate text-gray-900`}>
            Team Features
          </p>
          <div className={`${sectionLabel} flex flex-wrap items-center gap-4`}>
            <span>Total {summary.total}</span>
            <span>Features {summary.features}</span>
            <span>Bug Fixes {summary.bugFixes}</span>
            <span>In Progress {summary.inProgress}</span>
            <span>Done {summary.done}</span>
            <button
              type="button"
              onClick={() => {
                setEditingFeatureId(null);
                setForm(DEFAULT_FORM_STATE);
                setIsFormOpen(true);
              }}
              className={`${sectionLabel} inline-flex items-center gap-2 border border-gray-300 px-3 py-1.5 text-gray-800 transition-colors hover:bg-gray-50`}
            >
              <Plus className="h-3 w-3" />
              Add Item
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col overflow-hidden border-y border-gray-200 bg-white">
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-[1180px]">
              <div
                className={`${tableGridClass} ${tableHeader} border-b border-gray-200 px-4 py-3`}
              >
                <p>Type</p>
                <p>Work Item</p>
                <p>Area</p>
                <p>Status</p>
                <p>Priority</p>
                <p>Assigned</p>
                <p>Active</p>
                <p className="text-right">Actions</p>
              </div>

              {isLoading ? (
                <div className="px-6 py-10 text-sm font-medium text-gray-500">Loading feature tracker...</div>
              ) : rows.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <p className={sectionLabel}>No Work Items Found</p>
                  <p className="mt-2 text-sm font-medium text-gray-500">
                    Adjust the sidebar filters or add the first feature entry for the team.
                  </p>
                </div>
              ) : (
                rows.map((row) => (
                  <div key={row.id} className={`${tableGridClass} items-center border-b border-gray-100 px-4 py-3 text-sm last:border-b-0`}>
                    <div className="min-w-0">
                      <p className={`${sectionLabel} text-gray-900`}>
                        {row.type === 'bug_fix' ? 'Bug Fix' : 'Feature'}
                      </p>
                      <p className={`${fieldLabel} mt-1 text-gray-500`}>#{row.id}</p>
                    </div>

                    <div className="min-w-0">
                      <p className={`${tableCell} truncate`}>{row.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500">
                        {row.description || 'No description added.'}
                      </p>
                      <p className={`${fieldLabel} mt-1 text-gray-500`}>
                        Updated {formatDateTime(row.updatedAt)}
                      </p>
                    </div>

                    <p className={`${tableCell} truncate uppercase tracking-[0.16em]`}>
                      {row.pageArea || '-'}
                    </p>

                    <p className={`text-xs font-black uppercase tracking-[0.16em] ${getStatusTone(row.status)}`}>
                      {row.status.replace('_', ' ')}
                    </p>

                    <p className={`text-xs font-black uppercase tracking-[0.16em] ${getPriorityTone(row.priority)}`}>
                      {row.priority}
                    </p>

                    <p className={`${tableCell} truncate`}>
                      {row.assignedToStaffName || 'Unassigned'}
                    </p>

                    <p className={`${tableHeader} ${row.isActive ? 'text-emerald-700' : 'text-gray-500'}`}>
                      {row.isActive ? 'Visible' : 'Hidden'}
                    </p>

                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        className="inline-flex h-8 w-8 items-center justify-center border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
                        title="Edit work item"
                        aria-label={`Edit ${row.title}`}
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteMutation.mutate(row.id)}
                        disabled={deleteMutation.isPending}
                        className="inline-flex h-8 w-8 items-center justify-center border border-rose-200 text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
                        title="Delete work item"
                        aria-label={`Delete ${row.title}`}
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
          <button
            type="button"
            className="absolute inset-0 bg-gray-950/30"
            onClick={closeForm}
            aria-label="Close feature form"
          />
          <div className="relative flex w-full max-w-3xl flex-col overflow-hidden border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <p className={sectionLabel}>
                  {editingFeatureId != null ? 'Edit Work Item' : 'New Work Item'}
                </p>
                <h3 className="mt-1 text-base font-semibold text-gray-900">
                  {editingFeatureId != null ? 'Update feature tracker row' : 'Add a feature or bug fix'}
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
                <span className={`block ${sectionLabel}`}>Title</span>
                <input
                  type="text"
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Short label for the work item"
                  className="h-10 w-full border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-gray-400"
                />
              </label>

              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>Type</span>
                <select
                  value={form.type}
                  onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as AdminFeatureType }))}
                  className="h-10 w-full border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-gray-400"
                >
                  {FEATURE_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>Status</span>
                <select
                  value={form.status}
                  onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as AdminFeatureStatus }))}
                  className="h-10 w-full border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-gray-400"
                >
                  {FEATURE_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>Priority</span>
                <select
                  value={form.priority}
                  onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as AdminFeaturePriority }))}
                  className="h-10 w-full border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-gray-400"
                >
                  {FEATURE_PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>Area / Page</span>
                <input
                  type="text"
                  value={form.pageArea}
                  onChange={(event) => setForm((current) => ({ ...current, pageArea: event.target.value }))}
                  placeholder="Admin, dashboard, support, API..."
                  className="h-10 w-full border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-gray-400"
                />
              </label>

              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>Assigned Staff</span>
                <select
                  value={form.assignedToStaffId}
                  onChange={(event) => setForm((current) => ({ ...current, assignedToStaffId: event.target.value }))}
                  className="h-10 w-full border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-gray-400"
                >
                  <option value="">Unassigned</option>
                  {staff.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name} ({member.role})
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className={`block ${sectionLabel}`}>Sort Order</span>
                <input
                  type="number"
                  min={0}
                  value={form.sortOrder}
                  onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))}
                  className="h-10 w-full border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-gray-400"
                />
              </label>

              <label className="flex items-center gap-3 border border-gray-200 px-3 py-3">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
                  className="h-4 w-4 border-gray-300 text-gray-900 focus:ring-gray-300"
                />
                <div>
                  <span className={`block ${sectionLabel} text-gray-700`}>Active</span>
                  <span className="block text-xs font-medium text-gray-500">Hidden items stay in the tracker but are visually muted.</span>
                </div>
              </label>

              <label className="space-y-1 md:col-span-2">
                <span className={`block ${sectionLabel}`}>Description</span>
                <textarea
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Include the change request, bug details, or notes for the team."
                  rows={5}
                  className="w-full border border-gray-200 bg-white px-3 py-3 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-gray-400"
                />
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
                {isSaving ? 'Saving...' : editingFeatureId != null ? 'Save Changes' : 'Create Item'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
