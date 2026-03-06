'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Check, Loader2, X, Package, Barcode } from '@/components/Icons';

interface StaffMember {
  id: number;
  name: string;
  role: string;
}

interface FbaSidebarProps {
  onShipmentCreated: () => void;
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

const EMPTY_FORM: CreateShipmentForm = {
  shipment_ref: '',
  destination_fc: '',
  due_date: '',
  notes: '',
  assigned_tech_id: '',
  assigned_packer_id: '',
  items: [{ fnsku: '', expected_qty: '' }],
};

export function FbaSidebar({ onShipmentCreated }: FbaSidebarProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [form, setForm] = useState<CreateShipmentForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [stats, setStats] = useState({ planned: 0, ready: 0, labeled: 0, shipped: 0 });

  useEffect(() => {
    fetch('/api/staff?active=true', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setStaff(d.map((m: any) => ({ id: Number(m.id), name: String(m.name || ''), role: String(m.role || '') }))))
      .catch(() => {});

    fetch('/api/fba/shipments?limit=200')
      .then((r) => r.json())
      .then((d) => {
        if (!Array.isArray(d?.shipments)) return;
        const s = d.shipments;
        setStats({
          planned:  s.filter((x: any) => x.status === 'PLANNED').length,
          ready:    s.filter((x: any) => x.status === 'READY_TO_GO').length,
          labeled:  s.filter((x: any) => x.status === 'LABEL_ASSIGNED').length,
          shipped:  s.filter((x: any) => x.status === 'SHIPPED').length,
        });
      })
      .catch(() => {});
  }, [submitSuccess]);

  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, { fnsku: '', expected_qty: '' }] }));
  const removeItem = (i: number) => setForm((f) => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));
  const updateItem = (i: number, field: 'fnsku' | 'expected_qty', val: string) =>
    setForm((f) => ({ ...f, items: f.items.map((item, idx) => idx === i ? { ...item, [field]: val } : item) }));

  const handleCreate = async () => {
    if (!form.shipment_ref.trim()) { setSubmitError('Shipment reference is required'); return; }

    const techIdNum = Number(form.assigned_tech_id) || null;
    if (!techIdNum) { setSubmitError('Created-by staff is required'); return; }

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
      if (!res.ok) { setSubmitError(data?.error || 'Failed to create shipment'); return; }
      setSubmitSuccess(true);
      setForm(EMPTY_FORM);
      setShowCreateForm(false);
      onShipmentCreated();
      setTimeout(() => setSubmitSuccess(false), 3000);
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to create shipment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col">
      {/* Stats chips */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-purple-600" />
            <h3 className="text-[12px] font-black uppercase tracking-widest text-gray-900">FBA</h3>
          </div>
          <AnimatePresence>
            {submitSuccess && (
              <motion.span
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-1 text-[9px] font-black text-emerald-600"
              >
                <Check className="w-3 h-3" /> Created
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {[
            { label: 'Planned',  val: stats.planned,  color: 'bg-gray-100 text-gray-600' },
            { label: 'Ready',    val: stats.ready,    color: 'bg-emerald-100 text-emerald-700' },
            { label: 'Labeled',  val: stats.labeled,  color: 'bg-blue-100 text-blue-700' },
            { label: 'Shipped',  val: stats.shipped,  color: 'bg-purple-100 text-purple-700' },
          ].map(({ label, val, color }) => (
            <div key={label} className={`rounded-xl px-3 py-2 ${color}`}>
              <p className="text-[9px] font-black uppercase tracking-widest">{label}</p>
              <p className="text-lg font-black tabular-nums">{val}</p>
            </div>
          ))}
        </div>
      </div>

      {/* New shipment button */}
      <div className="px-4 py-3 border-b border-gray-100">
        <button
          type="button"
          onClick={() => { setShowCreateForm(!showCreateForm); setSubmitError(null); }}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-purple-600/20"
        >
          <Plus className="w-4 h-4" />
          New Shipment
        </button>
      </div>

      {/* Create form */}
      <AnimatePresence>
        {showCreateForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 py-3 space-y-3 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-black uppercase tracking-widest text-purple-600">New Shipment</p>
                <button type="button" onClick={() => setShowCreateForm(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div>
                <label className="block text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1">Shipment Ref *</label>
                <input
                  type="text"
                  value={form.shipment_ref}
                  onChange={(e) => setForm((f) => ({ ...f, shipment_ref: e.target.value }))}
                  placeholder="FBA15XXXXX"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/10"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1">FC Code</label>
                  <input
                    type="text"
                    value={form.destination_fc}
                    onChange={(e) => setForm((f) => ({ ...f, destination_fc: e.target.value }))}
                    placeholder="PHX7"
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/10"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1">Due Date</label>
                  <input
                    type="date"
                    value={form.due_date}
                    onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/10"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1">Tech *</label>
                  <select
                    value={form.assigned_tech_id}
                    onChange={(e) => setForm((f) => ({ ...f, assigned_tech_id: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/10"
                  >
                    <option value="">Select</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1">Packer</label>
                  <select
                    value={form.assigned_packer_id}
                    onChange={(e) => setForm((f) => ({ ...f, assigned_packer_id: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/10"
                  >
                    <option value="">Select</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1">Notes</label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional notes..."
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/10"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[9px] font-black text-gray-500 uppercase tracking-widest">FNSKUs</label>
                  <button
                    type="button"
                    onClick={addItem}
                    className="flex items-center gap-1 text-[9px] font-black text-purple-600 hover:text-purple-700"
                  >
                    <Plus className="w-3 h-3" /> Add
                  </button>
                </div>
                <div className="space-y-1.5">
                  {form.items.map((item, i) => (
                    <div key={i} className="flex gap-1.5 items-center">
                      <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-xl px-2 py-1 flex-shrink-0">
                        <Barcode className="w-3 h-3 text-gray-400" />
                      </div>
                      <input
                        type="text"
                        value={item.fnsku}
                        onChange={(e) => updateItem(i, 'fnsku', e.target.value)}
                        placeholder="FNSKU"
                        className="flex-1 min-w-0 px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-[10px] font-bold focus:outline-none focus:border-purple-500"
                      />
                      <input
                        type="number"
                        value={item.expected_qty}
                        onChange={(e) => updateItem(i, 'expected_qty', e.target.value)}
                        placeholder="Qty"
                        min={1}
                        className="w-14 px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-[10px] font-bold text-center focus:outline-none focus:border-purple-500"
                      />
                      {form.items.length > 1 && (
                        <button type="button" onClick={() => removeItem(i)} className="text-gray-300 hover:text-red-500 flex-shrink-0">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {submitError && (
                <p className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{submitError}</p>
              )}

              <button
                type="button"
                onClick={handleCreate}
                disabled={submitting}
                className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all"
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating...
                  </span>
                ) : 'Create Shipment'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="px-4 pb-4 pt-3 text-center">
        <p className="text-[9px] font-black text-gray-300 uppercase tracking-[0.3em]">FBA LIFECYCLE v1.0</p>
      </div>
    </div>
  );
}
