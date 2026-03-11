'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import {
  X,
  ExternalLink,
  Loader2,
  Calendar,
  ClipboardList,
  User,
} from '@/components/Icons';
import { getActiveStaff, type StaffMember } from '@/lib/staffCache';
import { OrderStaffAssignmentButtons } from '@/components/ui/OrderStaffAssignmentButtons';
import {
  type WorkOrderRow,
  type WorkStatus,
  STATUS_OPTIONS,
  STATUS_COLOR,
  formatDate,
  toDateInputValue,
  buildSourceHref,
} from '@/components/work-orders/types';

interface WorkOrderDetailsPanelProps {
  row: WorkOrderRow;
  onClose: () => void;
  onSaved: () => void;
  queue: string;
  query: string;
}

export function WorkOrderDetailsPanel({
  row,
  onClose,
  onSaved,
  queue,
  query,
}: WorkOrderDetailsPanelProps) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    assignedTechId: row.techId ? String(row.techId) : '',
    assignedPackerId: row.packerId ? String(row.packerId) : '',
    status: row.status as WorkStatus,
    priority: String(row.priority || 100),
    deadlineAt: toDateInputValue(row.deadlineAt),
    notes: row.notes || '',
  });

  useEffect(() => {
    let active = true;
    getActiveStaff()
      .then((members) => { if (active) setStaff(members); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setForm({
      assignedTechId: row.techId ? String(row.techId) : '',
      assignedPackerId: row.packerId ? String(row.packerId) : '',
      status: row.status,
      priority: String(row.priority || 100),
      deadlineAt: toDateInputValue(row.deadlineAt),
      notes: row.notes || '',
    });
  }, [row]);

  const TECH_IDS = [1, 2, 3, 6];
  const technicianOptions = staff
    .filter((m) => m.role === 'technician' && TECH_IDS.includes(Number(m.id)))
    .map((m) => ({ id: Number(m.id), name: m.name }))
    .sort((a, b) => TECH_IDS.indexOf(a.id) - TECH_IDS.indexOf(b.id));
  const packerOptions = staff
    .filter((m) => m.role === 'packer')
    .map((m) => ({ id: Number(m.id), name: m.name }));

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/work-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: row.entityType,
          entityId: row.entityId,
          assignedTechId: form.assignedTechId ? Number(form.assignedTechId) : null,
          assignedPackerId: form.assignedPackerId ? Number(form.assignedPackerId) : null,
          status: form.status,
          priority: Number(form.priority || 100),
          deadlineAt: form.deadlineAt || null,
          notes: form.notes,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.details || payload?.error || 'Failed to save work order');
      }
      onSaved();
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch (err: any) {
      window.alert(err?.message || 'Failed to save work order');
    } finally {
      setSaving(false);
    }
  };

  const statusBadgeClass = STATUS_COLOR[form.status] || 'text-slate-600 bg-slate-100';

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 26, stiffness: 360, mass: 0.45 }}
      className="fixed right-0 top-0 h-screen w-[400px] bg-white border-l border-gray-200 shadow-[-24px_0_48px_rgba(0,0,0,0.06)] z-[100] flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="shrink-0 border-b border-gray-100 px-6 py-5 bg-white">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[9px] font-black uppercase tracking-[0.3em] text-emerald-700">
                {row.queueLabel}
              </span>
              <span className={`text-[9px] font-black uppercase tracking-[0.2em] px-2 py-0.5 rounded-full ${statusBadgeClass}`}>
                {row.status.replace('_', ' ')}
              </span>
            </div>
            <h2 className="text-[17px] font-black uppercase tracking-tight text-slate-950 leading-tight truncate">
              {row.recordLabel}
            </h2>
            <p className="mt-1 text-[12px] font-medium text-slate-500 line-clamp-1">{row.title}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Link
              href={buildSourceHref(row)}
              target="_blank"
              rel="noopener"
              className="h-9 w-9 flex items-center justify-center rounded-xl border border-gray-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors"
              aria-label="Open source record"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="h-9 w-9 flex items-center justify-center rounded-xl border border-gray-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors"
              aria-label="Close panel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

        {/* Assignment */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <User className="h-3.5 w-3.5 text-slate-400" />
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Assignment</p>
          </div>
          {staff.length > 0 ? (
            <OrderStaffAssignmentButtons
              testerOptions={technicianOptions}
              packerOptions={packerOptions}
              testerId={form.assignedTechId ? Number(form.assignedTechId) : null}
              packerId={form.assignedPackerId ? Number(form.assignedPackerId) : null}
              onAssignTester={(id) =>
                setForm((prev) => ({
                  ...prev,
                  assignedTechId: prev.assignedTechId === String(id) ? '' : String(id),
                }))
              }
              onAssignPacker={(id) =>
                setForm((prev) => ({
                  ...prev,
                  assignedPackerId: prev.assignedPackerId === String(id) ? '' : String(id),
                }))
              }
              layout="rows"
            />
          ) : (
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="text-[11px]">Loading staff…</span>
            </div>
          )}
        </section>

        <div className="h-px bg-gray-100" />

        {/* Workflow */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <ClipboardList className="h-3.5 w-3.5 text-slate-400" />
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Workflow</p>
          </div>

          <div className="space-y-4">
            {/* Status */}
            <div>
              <p className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500">Status</p>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_OPTIONS.map((s) => {
                  const isActive = form.status === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, status: s }))}
                      className={`h-7 px-3 rounded-md text-[9px] font-black uppercase tracking-wide border transition-all ${
                        isActive
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-300'
                      }`}
                    >
                      {s.replace('_', ' ')}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Priority + Deadline */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-500">
                    Priority
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={9999}
                    value={form.priority}
                    onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-slate-400 focus:ring-0 transition-colors"
                  />
                </label>
              </div>
              <div>
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500">
                    <Calendar className="h-3 w-3" />
                    Deadline
                  </span>
                  <input
                    type="date"
                    value={form.deadlineAt}
                    onChange={(e) => setForm((prev) => ({ ...prev, deadlineAt: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-slate-400 focus:ring-0 transition-colors"
                  />
                </label>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-500">
                  Notes
                </span>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  rows={4}
                  placeholder="Add notes…"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-slate-400 focus:ring-0 transition-colors resize-none"
                />
              </label>
            </div>
          </div>
        </section>

        <div className="h-px bg-gray-100" />

        {/* Current state read-only */}
        <section>
          <p className="mb-2.5 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Current State</p>
          <dl className="space-y-1.5 text-[12px]">
            {[
              { label: 'Queue', value: row.queueLabel },
              { label: 'Status', value: row.status.replace('_', ' ') },
              { label: 'Deadline', value: formatDate(row.deadlineAt) },
              ...(row.updatedAt ? [{ label: 'Updated', value: formatDate(row.updatedAt) }] : []),
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between gap-4">
                <dt className="font-medium text-slate-400">{label}</dt>
                <dd className="font-black text-slate-800">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {/* Footer save */}
      <div className="shrink-0 border-t border-gray-100 px-6 py-4 bg-white">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {saving ? 'Saving…' : 'Save Work Order'}
        </button>
      </div>
    </motion.div>
  );
}
