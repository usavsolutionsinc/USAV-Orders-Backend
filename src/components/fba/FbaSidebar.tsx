'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Loader2,
  Package,
  Plus,
  Trash2,
  X,
} from '@/components/Icons';
import type { FbaSummaryRow } from '@/components/fba/types';
import { deriveFbaWorkflowMode, getFbaCurrentlyPackingQty, getFbaReadyToPrintQty } from '@/components/fba/types';
import { DetailsPanelRow, PanelSection } from '@/design-system/components';

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
  activeMode?: 'ALL' | 'PACKING' | 'STOCK';
  refreshToken?: number;
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

const MODE_META = {
  PLAN: {
    label: 'Plan',
    badge: 'bg-violet-100 text-violet-700 border-violet-200',
  },
  PACKING: {
    label: 'Packing',
    badge: 'bg-amber-100 text-amber-700 border-amber-200',
  },
  READY_TO_GO: {
    label: 'Ready to Go',
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  },
} as const;

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

function FbaControlSidebar({
  onShipmentCreated,
  showCreateForm,
  onCreateFormChange,
  activeMode = 'ALL',
  refreshToken = 0,
}: LegacySidebarProps) {
  const [form, setForm] = useState<CreateShipmentForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [stats, setStats] = useState({
    planned_units: 0,
    packing_units: 0,
    ready_units: 0,
    shipped_units: 0,
    plan_fnskus: 0,
    packing_fnskus: 0,
    ready_to_go_fnskus: 0,
  });
  const [flowRows, setFlowRows] = useState<FbaSummaryRow[]>([]);

  const loadSummary = useCallback(async () => {
    setIsSummaryLoading(true);
    try {
      const summaryRes = await fetch('/api/fba/logs/summary?limit=500', { cache: 'no-store' });
      const summaryData = await summaryRes.json();
      const rows = Array.isArray(summaryData?.rows) ? (summaryData.rows as FbaSummaryRow[]) : [];

      let planFnskus = 0;
      let packingFnskus = 0;
      let readyToGoFnskus = 0;
      for (const row of rows) {
        const mode = deriveFbaWorkflowMode(row);
        if (mode === 'PLAN') planFnskus += 1;
        if (mode === 'PACKING') packingFnskus += 1;
        if (mode === 'READY_TO_GO') readyToGoFnskus += 1;
      }

      setStats({
        planned_units: rows.reduce((sum, row) => sum + Number(row.tech_scanned_qty || 0), 0),
        packing_units: rows.reduce((sum, row) => sum + getFbaCurrentlyPackingQty(row), 0),
        ready_units: rows.reduce((sum, row) => sum + getFbaReadyToPrintQty(row), 0),
        shipped_units: rows.reduce((sum, row) => sum + Number(row.shipped_qty || 0), 0),
        plan_fnskus: planFnskus,
        packing_fnskus: packingFnskus,
        ready_to_go_fnskus: readyToGoFnskus,
      });

      const sorted = [...rows].sort((a, b) => {
        const timeA = new Date(a.last_event_at || 0).getTime();
        const timeB = new Date(b.last_event_at || 0).getTime();
        return timeB - timeA;
      });
      setFlowRows(sorted.filter((row) => deriveFbaWorkflowMode(row) !== 'NONE').slice(0, 24));
    } catch {
      // no-op
    } finally {
      setIsSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch('/api/staff?active=true')
      .then((r) => r.json())
      .then((d) =>
        Array.isArray(d) &&
        setStaff(d.map((m: any) => ({ id: Number(m.id), name: String(m.name || ''), role: String(m.role || '') })))
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary, refreshToken, submitSuccess]);

  useEffect(() => {
    const handleRefresh = () => {
      loadSummary();
    };
    window.addEventListener('usav-refresh-data' as any, handleRefresh as any);
    window.addEventListener('dashboard-refresh' as any, handleRefresh as any);
    return () => {
      window.removeEventListener('usav-refresh-data' as any, handleRefresh as any);
      window.removeEventListener('dashboard-refresh' as any, handleRefresh as any);
    };
  }, [loadSummary]);

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

  const visibleFlowRows = useMemo(
    () =>
      flowRows
        .filter((row) => {
          const mode = deriveFbaWorkflowMode(row);
          if (activeMode === 'ALL') return mode === 'PLAN' || mode === 'PACKING';
          if (activeMode === 'PACKING') return mode === 'PACKING';
          return mode === 'PLAN';
        })
        .slice(0, 8),
    [activeMode, flowRows]
  );

  return (
    <div className="flex h-full flex-col bg-white">
      <AnimatePresence initial={false}>
        {submitSuccess ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="border-b border-gray-200 px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-gray-500"
          >
            Shipment created
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="border-b border-gray-200 px-3 pb-2">
        <PanelSection title="Pipeline" className="pt-3">
          <DetailsPanelRow label="Plan" dividerClassName="border-b border-gray-100">
            <p className="text-sm font-black tabular-nums text-violet-700">{stats.planned_units}</p>
          </DetailsPanelRow>
          <DetailsPanelRow label="Currently packing" dividerClassName="border-b border-gray-100">
            <p className="text-sm font-black tabular-nums text-amber-700">{stats.packing_units}</p>
          </DetailsPanelRow>
          <DetailsPanelRow label="Ready to go" dividerClassName="border-b border-gray-100" className="last:border-b-0">
            <p className="text-sm font-black tabular-nums text-emerald-700">{stats.ready_units}</p>
          </DetailsPanelRow>
        </PanelSection>

        <PanelSection title="FNSKU counts" className="pt-4">
          <DetailsPanelRow label="Plan SKUs" dividerClassName="border-b border-gray-100">
            <p className="text-sm font-black tabular-nums text-violet-700">{stats.plan_fnskus}</p>
          </DetailsPanelRow>
          <DetailsPanelRow label="Packing" dividerClassName="border-b border-gray-100">
            <p className="text-sm font-black tabular-nums text-amber-700">{stats.packing_fnskus}</p>
          </DetailsPanelRow>
          <DetailsPanelRow label="Ready to go" dividerClassName="border-b border-gray-100" className="last:border-b-0">
            <p className="text-sm font-black tabular-nums text-emerald-700">{stats.ready_to_go_fnskus}</p>
          </DetailsPanelRow>
        </PanelSection>
      </div>

      <div className="border-b border-gray-200 px-3 py-2.5">
        <PanelSection
          title="Flow"
          headerRight={isSummaryLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" /> : null}
        >
          {visibleFlowRows.length === 0 ? (
            <p className="py-2 text-[10px] font-bold text-gray-400">No FNSKUs in this mode.</p>
          ) : (
            visibleFlowRows
              .filter((row) => deriveFbaWorkflowMode(row) !== 'NONE')
              .map((row, idx, arr) => {
                const mode = deriveFbaWorkflowMode(row);
                if (mode === 'NONE') return null;
                const meta = MODE_META[mode];
                const isLast = idx === arr.length - 1;
                return (
                  <DetailsPanelRow
                    key={row.fnsku}
                    label="FNSKU"
                    dividerClassName="border-b border-gray-100"
                    className={isLast ? '!border-b-0' : ''}
                    actions={
                      <span
                        className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider ${meta.badge}`}
                      >
                        {meta.label}
                      </span>
                    }
                  >
                    <p className="truncate font-mono text-xs font-bold text-gray-900">{row.fnsku}</p>
                    <p className="mt-1 text-[9px] font-bold text-gray-500">
                      Plan:{row.tech_scanned_qty} • Packing:{getFbaCurrentlyPackingQty(row)} • Ready:
                      {getFbaReadyToPrintQty(row)}
                    </p>
                  </DetailsPanelRow>
                );
              })
          )}
        </PanelSection>
      </div>

      <AnimatePresence initial={false}>
        {showCreateForm ? (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="border-b border-gray-200"
          >
            <div className="px-3 py-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-[#7c3aed]">Add FBA items</p>
                  <p className="mt-1 text-[11px] text-gray-500">Create shipment + seed first FNSKUs.</p>
                </div>
                <SidebarIconButton icon={<X className="h-4 w-4" />} label="Close shipment form" onClick={() => onCreateFormChange(false)} />
              </div>

              <div className="space-y-0">
                <DetailsPanelRow label="Shipment reference" dividerClassName="border-b border-gray-100">
                  <input
                    type="text"
                    value={form.shipment_ref}
                    onChange={(e) => setForm((f) => ({ ...f, shipment_ref: e.target.value }))}
                    placeholder="FBA15XXXXX"
                    className="h-8 w-full border-0 bg-transparent px-0 text-sm font-bold text-gray-900 outline-none ring-0 placeholder:font-medium placeholder:text-gray-400"
                  />
                </DetailsPanelRow>
                <DetailsPanelRow label="FC code" dividerClassName="border-b border-gray-100">
                  <input
                    type="text"
                    value={form.destination_fc}
                    onChange={(e) => setForm((f) => ({ ...f, destination_fc: e.target.value }))}
                    placeholder="PHX7"
                    className="h-8 w-full border-0 bg-transparent px-0 text-sm font-bold text-gray-900 outline-none ring-0 placeholder:font-medium placeholder:text-gray-400"
                  />
                </DetailsPanelRow>
                <DetailsPanelRow label="Due date" dividerClassName="border-b border-gray-100">
                  <input
                    type="date"
                    value={form.due_date}
                    onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                    className="h-8 w-full border-0 bg-transparent px-0 text-sm font-bold text-gray-900 outline-none ring-0"
                  />
                </DetailsPanelRow>
                <DetailsPanelRow label="Tech" dividerClassName="border-b border-gray-100">
                  <select
                    value={form.assigned_tech_id}
                    onChange={(e) => setForm((f) => ({ ...f, assigned_tech_id: e.target.value }))}
                    className="h-8 w-full border-0 bg-transparent px-0 text-sm font-bold text-gray-900 outline-none ring-0"
                  >
                    <option value="">Select</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </DetailsPanelRow>
                <DetailsPanelRow label="Packer" dividerClassName="border-b border-gray-100">
                  <select
                    value={form.assigned_packer_id}
                    onChange={(e) => setForm((f) => ({ ...f, assigned_packer_id: e.target.value }))}
                    className="h-8 w-full border-0 bg-transparent px-0 text-sm font-bold text-gray-900 outline-none ring-0"
                  >
                    <option value="">Select</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </DetailsPanelRow>
                <DetailsPanelRow label="Notes" dividerClassName="border-b border-gray-100">
                  <input
                    type="text"
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="Optional notes"
                    className="h-8 w-full border-0 bg-transparent px-0 text-sm font-bold text-gray-900 outline-none ring-0 placeholder:font-medium placeholder:text-gray-400"
                  />
                </DetailsPanelRow>

                <div className="border-b border-gray-100 py-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[9px] font-black uppercase tracking-[0.10rem] text-gray-500">FBA items</span>
                    <button
                      type="button"
                      onClick={addItem}
                      className="inline-flex items-center gap-1 rounded-lg border border-violet-200 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-[#7c3aed] transition hover:bg-violet-50"
                    >
                      <Plus className="h-4 w-4" />
                      Add line
                    </button>
                  </div>
                  <div className="space-y-0">
                    {form.items.map((item, i) => (
                      <DetailsPanelRow
                        key={i}
                        label={`Line ${i + 1}`}
                        dividerClassName="border-b border-gray-100"
                        className={i === form.items.length - 1 ? '!border-b-0' : ''}
                        actions={
                          form.items.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => removeItem(i)}
                              className="text-gray-400 transition hover:text-gray-900"
                              title="Remove item"
                              aria-label="Remove item"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ) : null
                        }
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <input
                            type="text"
                            value={item.fnsku}
                            onChange={(e) => updateItem(i, 'fnsku', e.target.value)}
                            placeholder="FNSKU"
                            className="min-w-0 flex-1 border-0 bg-transparent px-0 py-1 font-mono text-sm font-bold text-gray-900 outline-none placeholder:font-medium placeholder:text-gray-400"
                          />
                          <input
                            type="number"
                            min="0"
                            value={item.expected_qty}
                            onChange={(e) => updateItem(i, 'expected_qty', e.target.value)}
                            placeholder="Qty"
                            className="w-full border-0 bg-transparent px-0 py-1 text-sm font-bold text-gray-900 outline-none sm:w-24"
                          />
                        </div>
                      </DetailsPanelRow>
                    ))}
                  </div>
                </div>

                {submitError ? <p className="py-2 text-sm text-red-600">{submitError}</p> : null}

                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={submitting}
                  className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gray-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-60"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
                  Create shipment
                </button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

    </div>
  );
}

export function FbaSidebar(props: LegacySidebarProps) {
  return <FbaControlSidebar {...props} />;
}
