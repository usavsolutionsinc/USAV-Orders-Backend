'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Calendar,
  Loader2,
  Package,
  Plus,
  Trash2,
  User,
  X,
} from '@/components/Icons';
import type { FbaSummaryRow } from '@/components/fba/types';

interface StaffMember {
  id: number;
  name: string;
  role: string;
}

interface CreateShipmentForm {
  shipment_ref: string;
  destination_fc: string;
  due_date: string;
  notes: string;
  assigned_tech_id: string;
  assigned_packer_id: string;
  items: Array<{ fnsku: string; expected_qty: string }>;
}

interface LegacySidebarProps {
  onShipmentCreated: () => void;
  showCreateForm: boolean;
  onCreateFormChange: (nextValue: boolean) => void;
}

const EMPTY_FORM: CreateShipmentForm = {
  shipment_ref: '',
  destination_fc: '',
  due_date: '',
  notes: '',
  assigned_tech_id: '',
  assigned_packer_id: '',
  items: [{ fnsku: '', expected_qty: '' }],
};

function getAttentionQty(row: FbaSummaryRow) {
  const baseline = Math.max(row.expected_qty ?? 0, row.actual_qty ?? 0, row.tech_scanned_qty ?? 0);
  return Math.max(baseline - row.pack_ready_qty, 0);
}

function SidebarIconButton({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 text-gray-600 transition hover:border-gray-300 hover:bg-gray-50 hover:text-gray-950 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {icon}
    </button>
  );
}

function FbaControlSidebar({ onShipmentCreated, showCreateForm, onCreateFormChange }: LegacySidebarProps) {
  const [form, setForm] = useState<CreateShipmentForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [stats, setStats] = useState({ items: 0, ready: 0, attention: 0, shipped: 0 });

  useEffect(() => {
    fetch('/api/staff?active=true')
      .then((r) => r.json())
      .then((d) =>
        Array.isArray(d) &&
        setStaff(d.map((m: any) => ({ id: Number(m.id), name: String(m.name || ''), role: String(m.role || '') })))
      )
      .catch(() => {});

    fetch('/api/fba/logs/summary?limit=500')
      .then((r) => r.json())
      .then((d) => {
        if (!Array.isArray(d?.rows)) return;
        const rows = d.rows as FbaSummaryRow[];
        setStats({
          items: rows.length,
          ready: rows.reduce((sum, row) => sum + row.pack_ready_qty, 0),
          attention: rows.reduce((sum, row) => sum + getAttentionQty(row), 0),
          shipped: rows.reduce((sum, row) => sum + row.shipped_qty, 0),
        });
      })
      .catch(() => {});
  }, [submitSuccess]);

  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, { fnsku: '', expected_qty: '' }] }));
  const removeItem = (i: number) => setForm((f) => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));
  const updateItem = (i: number, field: 'fnsku' | 'expected_qty', val: string) =>
    setForm((f) => ({ ...f, items: f.items.map((item, idx) => (idx === i ? { ...item, [field]: val } : item)) }));

  const handleCreate = async () => {
    if (!form.shipment_ref.trim()) {
      setSubmitError('Shipment reference is required');
      return;
    }

    const techIdNum = Number(form.assigned_tech_id) || null;
    if (!techIdNum) {
      setSubmitError('Created-by staff is required');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    const cleanItems = form.items
      .filter((item) => item.fnsku.trim())
      .map((item) => ({ fnsku: item.fnsku.trim(), expected_qty: Number(item.expected_qty) || 0 }));

    try {
      const res = await fetch('/api/fba/shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipment_ref: form.shipment_ref.trim(),
          destination_fc: form.destination_fc.trim() || null,
          due_date: form.due_date || null,
          notes: form.notes.trim() || null,
          created_by_staff_id: techIdNum,
          assigned_tech_id: form.assigned_tech_id ? Number(form.assigned_tech_id) : null,
          assigned_packer_id: form.assigned_packer_id ? Number(form.assigned_packer_id) : null,
          items: cleanItems,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data?.error || 'Failed to create shipment');
        return;
      }
      setSubmitSuccess(true);
      setForm(EMPTY_FORM);
      onCreateFormChange(false);
      onShipmentCreated();
      window.setTimeout(() => setSubmitSuccess(false), 3000);
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to create shipment');
    } finally {
      setSubmitting(false);
    }
  };

  const statCards = useMemo(
    () => [
      { label: 'Items', value: stats.items },
      { label: 'Ready', value: stats.ready },
      { label: 'Attention', value: stats.attention },
      { label: 'Shipped', value: stats.shipped },
    ],
    [stats]
  );

  return (
    <div className="flex h-full flex-col bg-white">
      <AnimatePresence initial={false}>
        {submitSuccess ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="border-b border-gray-200 px-4 py-3 text-right text-[11px] font-medium text-gray-500"
          >
            Shipment created
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="border-b border-gray-200 px-4 py-4">
        <div className="grid grid-cols-2 gap-px border border-gray-200 bg-gray-200">
          {statCards.map((card) => (
            <div key={card.label} className="bg-white px-3 py-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-gray-400">{card.label}</p>
              <p className="mt-2 text-xl font-semibold tabular-nums text-gray-950">{card.value}</p>
            </div>
          ))}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {showCreateForm ? (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="border-b border-gray-200"
          >
            <div className="px-4 py-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-[#7c3aed]">Add FBA items</p>
                  <p className="mt-1 text-sm text-gray-500">Create a shipment and seed its first FNSKUs.</p>
                </div>
                <SidebarIconButton icon={<X className="h-4 w-4" />} label="Close shipment form" onClick={() => onCreateFormChange(false)} />
              </div>

              <div className="space-y-3">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-gray-400">Shipment reference</span>
                  <input
                    type="text"
                    value={form.shipment_ref}
                    onChange={(e) => setForm((f) => ({ ...f, shipment_ref: e.target.value }))}
                    placeholder="FBA15XXXXX"
                    className="mt-1.5 w-full border border-gray-200 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-gray-400">FC code</span>
                    <input
                      type="text"
                      value={form.destination_fc}
                      onChange={(e) => setForm((f) => ({ ...f, destination_fc: e.target.value }))}
                      placeholder="PHX7"
                      className="mt-1.5 w-full border border-gray-200 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-gray-400">Due date</span>
                    <input
                      type="date"
                      value={form.due_date}
                      onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                      className="mt-1.5 w-full border border-gray-200 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-gray-400">Tech</span>
                    <select
                      value={form.assigned_tech_id}
                      onChange={(e) => setForm((f) => ({ ...f, assigned_tech_id: e.target.value }))}
                      className="mt-1.5 w-full border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                    >
                      <option value="">Select</option>
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-gray-400">Packer</span>
                    <select
                      value={form.assigned_packer_id}
                      onChange={(e) => setForm((f) => ({ ...f, assigned_packer_id: e.target.value }))}
                      className="mt-1.5 w-full border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                    >
                      <option value="">Select</option>
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="block">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-gray-400">Notes</span>
                  <input
                    type="text"
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="Optional notes"
                    className="mt-1.5 w-full border border-gray-200 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                  />
                </label>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-gray-400">FBA items</span>
                    <button
                      type="button"
                      onClick={addItem}
                      className="inline-flex items-center gap-1 text-sm font-medium text-[#7c3aed]"
                    >
                      <Plus className="h-4 w-4" />
                      Add FBA items
                    </button>
                  </div>

                  <div className="space-y-px border border-gray-200 bg-gray-200">
                    {form.items.map((item, i) => (
                      <div key={i} className="grid grid-cols-[minmax(0,1fr)_7rem_auto] gap-px bg-gray-200">
                        <input
                          type="text"
                          value={item.fnsku}
                          onChange={(e) => updateItem(i, 'fnsku', e.target.value)}
                          placeholder="FNSKU"
                          className="bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:bg-gray-50"
                        />
                        <input
                          type="number"
                          min="0"
                          value={item.expected_qty}
                          onChange={(e) => updateItem(i, 'expected_qty', e.target.value)}
                          placeholder="Qty"
                          className="bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:bg-gray-50"
                        />
                        {form.items.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => removeItem(i)}
                            className="flex items-center justify-center bg-white px-3 text-gray-400 transition hover:text-gray-900"
                            title="Remove item"
                            aria-label="Remove item"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : (
                          <div className="bg-white" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {submitError ? <p className="text-sm text-red-600">{submitError}</p> : null}

                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={submitting}
                  className="inline-flex w-full items-center justify-center gap-2 bg-gray-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-60"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
                  Create shipment
                </button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-4 border border-gray-200 px-4 py-4">
          <div className="flex items-start gap-3">
            <Calendar className="mt-0.5 h-4 w-4 text-gray-400" />
            <div>
              <p className="text-sm font-medium text-gray-900">Keep action density out of the board</p>
              <p className="mt-1 text-sm leading-6 text-gray-500">
                Use the main table for scanning state quickly. Use this rail for creation, search refinement, and filters.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <User className="mt-0.5 h-4 w-4 text-gray-400" />
            <div>
              <p className="text-sm font-medium text-gray-900">Add FBA items is the only accent color</p>
              <p className="mt-1 text-sm leading-6 text-gray-500">
                Everything else stays neutral so inventory state, not decoration, carries the hierarchy.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FbaSidebar(props: LegacySidebarProps) {
  return <FbaControlSidebar {...props} />;
}
