'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Loader2, Package, Plus, Trash2 } from '@/components/Icons';
import {
  SidebarIntakeFormField,
  SidebarIntakeFormShell,
  SIDEBAR_INTAKE_INPUT_CLASS,
  SIDEBAR_INTAKE_INPUT_MONO_CLASS,
  SIDEBAR_INTAKE_SELECT_CLASS,
  SIDEBAR_INTAKE_SUBMIT_BUTTON_CLASS,
} from '@/design-system/components';

export interface FbaCreateShipmentFormState {
  shipment_ref: string;
  destination_fc: string;
  due_date: string;
  notes: string;
  assigned_tech_id: string;
  assigned_packer_id: string;
  items: Array<{ fnsku: string; expected_qty: string }>;
}

interface StaffMember {
  id: number;
  name: string;
  role: string;
}

export interface FbaCreateShipmentFormProps {
  staff: StaffMember[];
  form: FbaCreateShipmentFormState;
  setForm: Dispatch<SetStateAction<FbaCreateShipmentFormState>>;
  addItem: () => void;
  removeItem: (index: number) => void;
  updateItem: (index: number, field: 'fnsku' | 'expected_qty', value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
  submitError: string | null;
}

export function FbaCreateShipmentForm({
  staff,
  form,
  setForm,
  addItem,
  removeItem,
  updateItem,
  onClose,
  onSubmit,
  submitting,
  submitError,
}: FbaCreateShipmentFormProps) {
  const canSubmit = Boolean(form.shipment_ref.trim() && Number(form.assigned_tech_id));

  return (
    <SidebarIntakeFormShell
      title="New FBA shipment"
      subtitle="Plan mode"
      subtitleAccent="violet"
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || !canSubmit}
          className={SIDEBAR_INTAKE_SUBMIT_BUTTON_CLASS}
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating…
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <Package className="h-4 w-4" />
              Create shipment
            </span>
          )}
        </button>
      }
    >
      <SidebarIntakeFormField label="Shipment reference" required>
        <input
          type="text"
          value={form.shipment_ref}
          onChange={(e) => setForm((f) => ({ ...f, shipment_ref: e.target.value }))}
          placeholder="FBA15XXXXX"
          className={SIDEBAR_INTAKE_INPUT_CLASS}
        />
      </SidebarIntakeFormField>

      <SidebarIntakeFormField label="FC code">
        <input
          type="text"
          value={form.destination_fc}
          onChange={(e) => setForm((f) => ({ ...f, destination_fc: e.target.value }))}
          placeholder="PHX7"
          className={SIDEBAR_INTAKE_INPUT_CLASS}
        />
      </SidebarIntakeFormField>

      <SidebarIntakeFormField label="Due date">
        <input
          type="date"
          value={form.due_date}
          onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
          className={SIDEBAR_INTAKE_INPUT_CLASS}
        />
      </SidebarIntakeFormField>

      <SidebarIntakeFormField label="Tech (created by)" required>
        <select
          value={form.assigned_tech_id}
          onChange={(e) => setForm((f) => ({ ...f, assigned_tech_id: e.target.value }))}
          className={SIDEBAR_INTAKE_SELECT_CLASS}
        >
          <option value="">Select</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </SidebarIntakeFormField>

      <SidebarIntakeFormField label="Packer" optionalHint="(Optional)">
        <select
          value={form.assigned_packer_id}
          onChange={(e) => setForm((f) => ({ ...f, assigned_packer_id: e.target.value }))}
          className={SIDEBAR_INTAKE_SELECT_CLASS}
        >
          <option value="">Select</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </SidebarIntakeFormField>

      <SidebarIntakeFormField label="Notes" optionalHint="(Optional)">
        <input
          type="text"
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          placeholder="Optional notes"
          className={SIDEBAR_INTAKE_INPUT_CLASS}
        />
      </SidebarIntakeFormField>

      <div className="space-y-3 border-t border-gray-100 pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-700">FBA line items</span>
          <button
            type="button"
            onClick={addItem}
            className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-gray-700 transition-all hover:bg-gray-100"
          >
            <Plus className="h-4 w-4" />
            Add line
          </button>
        </div>

        {form.items.map((item, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-gray-200 bg-gray-50/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-600">Line {i + 1}</span>
              {form.items.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-900"
                  title="Remove line"
                  aria-label="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <SidebarIntakeFormField label="FNSKU">
              <input
                type="text"
                value={item.fnsku}
                onChange={(e) => updateItem(i, 'fnsku', e.target.value)}
                placeholder="FNSKU"
                className={SIDEBAR_INTAKE_INPUT_MONO_CLASS}
              />
            </SidebarIntakeFormField>
            <SidebarIntakeFormField label="Expected qty">
              <input
                type="number"
                min={0}
                value={item.expected_qty}
                onChange={(e) => updateItem(i, 'expected_qty', e.target.value)}
                placeholder="0"
                className={SIDEBAR_INTAKE_INPUT_CLASS}
              />
            </SidebarIntakeFormField>
          </div>
        ))}
      </div>

      {submitError ? <p className="text-sm font-semibold text-red-600">{submitError}</p> : null}
    </SidebarIntakeFormShell>
  );
}
