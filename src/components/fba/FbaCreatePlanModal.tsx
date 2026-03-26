'use client';

import { useEffect, useState } from 'react';
import { X } from '@/components/Icons';
import type { StationTheme } from '@/utils/staff-colors';
import { fbaSidebarThemeChrome } from '@/utils/staff-colors';
import { useActiveStaffDirectory } from '@/components/sidebar/hooks';
import { FbaCreateShipmentForm, type FbaCreateShipmentFormState } from './FbaCreateShipmentForm';

export const FBA_OPEN_CREATE_PLAN_EVENT = 'fba-open-create-plan';

const INITIAL_FORM: FbaCreateShipmentFormState = {
  shipment_ref: '',
  destination_fc: '',
  due_date: '',
  notes: '',
  assigned_tech_id: '',
  assigned_packer_id: '',
  items: [{ fnsku: '', expected_qty: '1' }],
};

export function FbaCreatePlanModal({ stationTheme = 'blue' }: { stationTheme?: StationTheme }) {
  const chrome = fbaSidebarThemeChrome[stationTheme];
  const staffDirectory = useActiveStaffDirectory();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FbaCreateShipmentFormState>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const handleOpen = () => {
      setForm(INITIAL_FORM);
      setSubmitError(null);
      setOpen(true);
    };
    window.addEventListener(FBA_OPEN_CREATE_PLAN_EVENT, handleOpen);
    return () => window.removeEventListener(FBA_OPEN_CREATE_PLAN_EVENT, handleOpen);
  }, []);

  const addItem = () => {
    setForm((f) => ({ ...f, items: [...f.items, { fnsku: '', expected_qty: '1' }] }));
  };

  const removeItem = (index: number) => {
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== index) }));
  };

  const updateItem = (index: number, field: 'fnsku' | 'expected_qty', value: string) => {
    setForm((f) => {
      const next = [...f.items];
      next[index] = { ...next[index], [field]: value };
      return { ...f, items: next };
    });
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/fba/shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipment_ref: form.shipment_ref.trim() || undefined,
          destination_fc: form.destination_fc.trim() || undefined,
          due_date: form.due_date || undefined,
          notes: form.notes.trim() || undefined,
          assigned_tech_id: form.assigned_tech_id || undefined,
          assigned_packer_id: form.assigned_packer_id || undefined,
          items: form.items
            .filter((i) => i.fnsku.trim())
            .map((i) => ({ fnsku: i.fnsku.trim(), expected_qty: Math.max(1, Number(i.expected_qty) || 1) })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to create plan');
      window.dispatchEvent(new Event('fba-plan-created'));
      setOpen(false);
      setForm(INITIAL_FORM);
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to create plan');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/35"
        aria-label="Close create plan"
        onClick={() => { if (!submitting) setOpen(false); }}
      />
      <div className="relative z-[81] flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-900/15">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <div>
            <p className={`text-[10px] font-black uppercase tracking-[0.16em] ${chrome.sectionLabel}`}>
              New plan
            </p>
            <h2 className="mt-1 text-sm font-black text-zinc-900">Create FBA shipment plan</h2>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={submitting}
            className="rounded-full border border-zinc-200 bg-white p-2 text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-800 disabled:opacity-40"
            aria-label="Close create plan"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FbaCreateShipmentForm
            staff={staffDirectory}
            form={form}
            setForm={setForm}
            addItem={addItem}
            removeItem={removeItem}
            updateItem={updateItem}
            onClose={() => setOpen(false)}
            onSubmit={handleSubmit}
            submitting={submitting}
            submitError={submitError}
            stationTheme={stationTheme}
          />
        </div>
      </div>
    </div>
  );
}
