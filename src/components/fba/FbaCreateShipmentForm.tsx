'use client';

import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef } from 'react';
import { Loader2, Package, Plus, Trash2 } from '@/components/Icons';
import { DeferredQtyInput } from '@/design-system/primitives';
import { buildFbaPlanRefFromIsoDate } from '@/lib/fba/plan-ref';
import type { StationTheme } from '@/utils/staff-colors';
import { fbaSidebarThemeChrome } from '@/utils/staff-colors';
import {
  SidebarIntakeFormField,
  SidebarIntakeFormShell,
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
  stationTheme?: StationTheme;
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
  stationTheme = 'blue',
}: FbaCreateShipmentFormProps) {
  const chrome = fbaSidebarThemeChrome[stationTheme];

  // Auto-derive plan ref from due_date using buildFbaPlanRefFromIsoDate.
  // Tracks the last auto-derived value so user overrides are preserved.
  const lastAutoRefRef = useRef<string>('');
  const derivedRef = useMemo(
    () => (form.due_date ? buildFbaPlanRefFromIsoDate(form.due_date) : ''),
    [form.due_date],
  );
  const isAutoRef =
    form.shipment_ref === '' || form.shipment_ref === lastAutoRefRef.current;
  const refIsInvalid = form.shipment_ref === 'FBA-00-00-00';

  useEffect(() => {
    if (!derivedRef || derivedRef === 'FBA-00-00-00') return;
    if (isAutoRef) {
      lastAutoRefRef.current = derivedRef;
      setForm((f) => ({ ...f, shipment_ref: derivedRef }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedRef]);

  const canSubmit = Boolean(
    form.shipment_ref.trim() &&
    !refIsInvalid &&
    Number(form.assigned_tech_id),
  );

  return (
    <SidebarIntakeFormShell
      title="New FBA shipment"
      subtitle="Plan mode"
      subtitleAccent={stationTheme}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || !canSubmit}
          className={chrome.primaryButton}
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
      <SidebarIntakeFormField
        label="Plan ID"
        required
        hintBelow={
          <div className="space-y-1">
            {derivedRef && derivedRef !== 'FBA-00-00-00' ? (
              <p className="font-mono text-[10px] text-emerald-700">
                Auto: {derivedRef}
              </p>
            ) : null}
            {!isAutoRef ? (
              <button
                type="button"
                className="text-[10px] text-blue-600 underline"
                onClick={() => {
                  if (!derivedRef || derivedRef === 'FBA-00-00-00') return;
                  lastAutoRefRef.current = derivedRef;
                  setForm((f) => ({ ...f, shipment_ref: derivedRef }));
                }}
              >
                Reset to auto
              </button>
            ) : null}
            {refIsInvalid ? (
              <p className="text-[10px] text-amber-600">
                Invalid plan ref. Set a valid due date or type a custom ref.
              </p>
            ) : null}
            <p className="text-[10px] leading-snug text-gray-500">
              Stored as shipment_ref — not the internal DB row id or Amazon&apos;s FBA shipment id.
            </p>
          </div>
        }
      >
        <input
          type="text"
          value={form.shipment_ref}
          onChange={(e) => {
            lastAutoRefRef.current = '';
            setForm((f) => ({ ...f, shipment_ref: e.target.value }));
          }}
          placeholder="FBA-03-26-26"
          className={chrome.monoInput}
        />
      </SidebarIntakeFormField>

      <SidebarIntakeFormField label="FC code">
        <input
          type="text"
          value={form.destination_fc}
          onChange={(e) => setForm((f) => ({ ...f, destination_fc: e.target.value }))}
          placeholder="PHX7"
          className={chrome.input}
        />
      </SidebarIntakeFormField>

      <SidebarIntakeFormField label="Due date">
        <input
          type="date"
          value={form.due_date}
          onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
          className={chrome.input}
        />
      </SidebarIntakeFormField>

      <SidebarIntakeFormField label="Tech (created by)" required>
        <select
          value={form.assigned_tech_id}
          onChange={(e) => setForm((f) => ({ ...f, assigned_tech_id: e.target.value }))}
          className={chrome.input}
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
          className={chrome.input}
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
          className={chrome.input}
        />
      </SidebarIntakeFormField>

      <div className="space-y-3 border-t border-gray-100 pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className={chrome.lineItemLabel}>FBA line items</span>
          <button
            type="button"
            onClick={addItem}
            className={chrome.secondaryButton}
          >
            <Plus className="h-4 w-4" />
            Add line
          </button>
        </div>

        {form.items.map((item, i) => (
          <div key={i} className={chrome.lineItemShell}>
            <div className="flex items-center justify-between gap-2">
              <span className={chrome.lineItemLabel}>Line {i + 1}</span>
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
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <SidebarIntakeFormField label="FNSKU">
                  <input
                    type="text"
                    value={item.fnsku}
                    onChange={(e) => updateItem(i, 'fnsku', e.target.value)}
                    placeholder="FNSKU"
                    className={chrome.monoInput}
                  />
                </SidebarIntakeFormField>
              </div>
              <div className="w-14 shrink-0">
                <SidebarIntakeFormField label="Qty">
                  <DeferredQtyInput
                    value={Math.max(0, parseInt(item.expected_qty, 10) || 0)}
                    onChange={(v) => updateItem(i, 'expected_qty', String(v))}
                    min={0}
                    className={`${chrome.input} text-center`}
                  />
                </SidebarIntakeFormField>
              </div>
            </div>
          </div>
        ))}
      </div>

      {submitError ? <p className="text-sm font-semibold text-red-600">{submitError}</p> : null}
    </SidebarIntakeFormShell>
  );
}
