'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import {
  AlertTriangle,
  ExternalLink,
  FileText,
  Flag,
  Loader2,
  Calendar,
  ClipboardList,
  PackageCheck,
  User,
} from '@/components/Icons';
import { getActiveStaff, type StaffMember } from '@/lib/staffCache';
import { OrderStaffAssignmentButtons } from '@/components/ui/OrderStaffAssignmentButtons';
import { PanelActionBar } from '@/components/shipped/details-panel/PanelActionBar';
import { ShippingInformationSection } from '@/components/shipped/details-panel/ShippingInformationSection';
import { ProductDetailsSection } from '@/components/shipped/details-panel/ProductDetailsSection';
import { MarkAsShippedForm } from '@/components/shipped/stacks/MarkAsShippedForm';
import { OutOfStockEditorBlock } from '@/components/ui/OutOfStockEditorBlock';
import { useOrderFieldSave } from '@/hooks/useOrderFieldSave';
import type { ShippedOrder } from '@/lib/neon/orders-queries';
import { dispatchNavigateShippedDetails } from '@/utils/events';
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
  disableMoveUp?: boolean;
  disableMoveDown?: boolean;
}

type PriorityPreset = 'NORMAL' | 'MUST_GO' | 'LATER';

const PRIORITY_OPTIONS: Array<{ value: PriorityPreset; label: string }> = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'MUST_GO', label: 'Must Go' },
  { value: 'LATER', label: 'Later' },
];

function getPriorityPreset(priority: number | null | undefined): PriorityPreset {
  const value = Number(priority || 100);
  if (value <= 25) return 'MUST_GO';
  if (value >= 250) return 'LATER';
  return 'NORMAL';
}

function getPriorityValue(priority: PriorityPreset): number {
  if (priority === 'MUST_GO') return 10;
  if (priority === 'LATER') return 500;
  return 100;
}

function getPriorityLabel(priority: PriorityPreset): string {
  return PRIORITY_OPTIONS.find((option) => option.value === priority)?.label || 'Normal';
}

function buildOrderDetailsRecord(row: WorkOrderRow): ShippedOrder | null {
  if (row.entityType !== 'ORDER') return null;

  return {
    id: row.entityId,
    deadline_at: row.deadlineAt,
    ship_by_date: row.deadlineAt,
    order_id: row.orderId || row.recordLabel,
    product_title: row.title,
    quantity: row.quantity || null,
    item_number: row.itemNumber || null,
    condition: row.condition || 'USED',
    shipment_id: row.shipmentId ?? null,
    shipping_tracking_number: row.trackingNumber || null,
    serial_number: '',
    sku: row.sku || '',
    tester_id: row.techId ?? null,
    tested_by: row.techId ?? null,
    test_date_time: null,
    packer_id: row.packerId ?? null,
    packed_by: row.packerId ?? null,
    packed_at: null,
    packer_photos_url: [],
    tracking_type: null,
    account_source: row.accountSource || null,
    notes: row.notes || '',
    status_history: [],
    created_at: row.createdAt || null,
    tester_name: row.techName || null,
    packed_by_name: row.packerName || null,
    tested_by_name: row.techName || null,
    is_shipped: false,
  };
}

export function WorkOrderDetailsPanel({
  row,
  onClose,
  onSaved,
  disableMoveUp = false,
  disableMoveDown = false,
}: WorkOrderDetailsPanelProps) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [saving, setSaving] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [outOfStock, setOutOfStock] = useState(String((row as any).out_of_stock || ''));
  const [notes, setNotes] = useState(row.notes || '');
  const [isMarkAsShippedOpen, setIsMarkAsShippedOpen] = useState(false);
  const [activeInput, setActiveInput] = useState<'none' | 'out_of_stock' | 'notes'>('none');
  const workflowScrollerRef = useRef<HTMLDivElement | null>(null);
  const [form, setForm] = useState({
    assignedTechId: row.techId ? String(row.techId) : '',
    assignedPackerId: row.packerId ? String(row.packerId) : '',
    status: row.status as WorkStatus,
    priority: getPriorityPreset(row.priority),
    deadlineAt: toDateInputValue(row.deadlineAt),
  });

  const orderDetailsRecord = useMemo(() => buildOrderDetailsRecord(row), [row]);
  const fieldSave = useOrderFieldSave({
    orderId: row.entityType === 'ORDER' ? row.entityId : -1,
    initialOrderNumber: row.orderId || '',
    initialItemNumber: row.itemNumber || '',
    initialTrackingNumber: row.trackingNumber || '',
    onUpdate: onSaved,
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
      priority: getPriorityPreset(row.priority),
      deadlineAt: toDateInputValue(row.deadlineAt),
    });
    setOutOfStock(String((row as any).out_of_stock || ''));
    setNotes(row.notes || '');
    setActiveInput('none');
    setIsMarkAsShippedOpen(false);
  }, [row]);

  useEffect(() => {
    if (!copiedAll) return;
    const timer = window.setTimeout(() => setCopiedAll(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copiedAll]);

  useEffect(() => {
    const handlePanelAction = (e: CustomEvent<{ action?: string }>) => {
      if (!orderDetailsRecord) return;
      switch (e.detail?.action) {
        case 'status':
          setIsMarkAsShippedOpen((prev) => !prev);
          break;
        case 'out_of_stock':
          setActiveInput((prev) => prev === 'out_of_stock' ? 'none' : 'out_of_stock');
          break;
        case 'notes':
          setActiveInput((prev) => prev === 'notes' ? 'none' : 'notes');
          break;
        default:
          break;
      }
    };

    window.addEventListener('shipped-panel-action' as any, handlePanelAction as any);
    return () => {
      window.removeEventListener('shipped-panel-action' as any, handlePanelAction as any);
    };
  }, [orderDetailsRecord]);

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
          priority: getPriorityValue(form.priority),
          deadlineAt: form.deadlineAt || null,
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

  const handleCopyAll = async () => {
    if (!orderDetailsRecord) return;
    const payload = [
      `Tracking: ${orderDetailsRecord.shipping_tracking_number || 'N/A'}`,
      `Ship By: ${orderDetailsRecord.ship_by_date || 'N/A'}`,
      `Order ID: ${orderDetailsRecord.order_id || 'N/A'}`,
      `Item Number: ${orderDetailsRecord.item_number || 'N/A'}`,
      `SKU: ${orderDetailsRecord.sku || 'N/A'}`,
      `Product: ${orderDetailsRecord.product_title || 'N/A'}`,
    ].join('\n');
    await navigator.clipboard.writeText(payload);
    setCopiedAll(true);
  };

  const statusBadgeClass = STATUS_COLOR[form.status] || 'text-slate-600 bg-slate-100';
  const panelActions = [
    {
      label: 'Goals',
      onClick: () => { window.location.href = `/admin?orderId=${row.entityId}`; },
      icon: <Flag className="h-3.5 w-3.5" />,
      toneClassName: 'text-blue-600',
    },
    {
      label: 'Mark as shipped',
      onClick: () => { window.dispatchEvent(new CustomEvent('shipped-panel-action', { detail: { action: 'status' } })); },
      icon: <PackageCheck className="h-3.5 w-3.5" />,
      toneClassName: 'text-emerald-600',
    },
    {
      label: 'Out of stock',
      onClick: () => { window.dispatchEvent(new CustomEvent('shipped-panel-action', { detail: { action: 'out_of_stock' } })); },
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      toneClassName: 'text-orange-600',
    },
    {
      label: 'Notes',
      onClick: () => { window.dispatchEvent(new CustomEvent('shipped-panel-action', { detail: { action: 'notes' } })); },
      icon: <FileText className="h-3.5 w-3.5" />,
      toneClassName: 'text-gray-600',
    },
  ];

  const handleWorkflowWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const container = workflowScrollerRef.current;
    if (!container) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    container.scrollLeft += event.deltaY;
    event.preventDefault();
  };

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 26, stiffness: 360, mass: 0.45 }}
      className="fixed right-0 top-0 z-[100] flex h-screen w-[400px] flex-col overflow-hidden border-l border-gray-200 bg-white shadow-[-24px_0_48px_rgba(0,0,0,0.06)]"
    >
      <div className="shrink-0 border-b border-gray-100 bg-white px-6 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-[9px] font-black uppercase tracking-[0.3em] text-emerald-700">
                {row.queueLabel}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] ${statusBadgeClass}`}>
                {form.status.replace('_', ' ')}
              </span>
            </div>
            <h2 className="truncate text-[17px] font-black uppercase tracking-tight text-slate-950">
              {row.recordLabel}
            </h2>
            <p className="mt-1 line-clamp-1 text-[12px] font-medium text-slate-500">{row.title}</p>
          </div>
          <Link
            href={buildSourceHref(row)}
            target="_blank"
            rel="noopener"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
            aria-label="Open source record"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <PanelActionBar
        onClose={onClose}
        onMoveUp={() => dispatchNavigateShippedDetails('up')}
        onMoveDown={() => dispatchNavigateShippedDetails('down')}
        disableMoveUp={disableMoveUp}
        disableMoveDown={disableMoveDown}
        rightActions={panelActions}
      />

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="space-y-6">
          {orderDetailsRecord ? (
            <section className="space-y-2">
              {isMarkAsShippedOpen && (
                <MarkAsShippedForm
                  shippingTrackingNumber={orderDetailsRecord.shipping_tracking_number || ''}
                  packerOptions={packerOptions}
                  onSuccess={() => {
                    setIsMarkAsShippedOpen(false);
                    onSaved();
                  }}
                />
              )}

              {activeInput === 'out_of_stock' && (
                <OutOfStockEditorBlock
                  value={outOfStock}
                  onChange={setOutOfStock}
                  onCancel={() => {
                    setOutOfStock(String((row as any).out_of_stock || ''));
                    setActiveInput('none');
                  }}
                  onSubmit={() => void fieldSave.saveOutOfStock(outOfStock)}
                  isSaving={fieldSave.isSavingOutOfStock}
                  autoFocus
                />
              )}

              {activeInput === 'notes' && (
                <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50/70 p-3">
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder="Add notes..."
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                    autoFocus
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveInput('none')}
                      className="h-8 rounded-lg border border-gray-200 bg-white text-[9px] font-black uppercase tracking-wider text-gray-700"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void fieldSave.saveNotes(notes)}
                      disabled={fieldSave.isSavingNotes}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-gray-900 text-[9px] font-black uppercase tracking-wider text-white hover:bg-gray-800 disabled:opacity-50"
                    >
                      {fieldSave.isSavingNotes ? 'Saving' : 'Submit'}
                    </button>
                  </div>
                </div>
              )}
            </section>
          ) : null}

          <section>
            <div className="mb-3 flex items-center gap-2">
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

          <section>
            <div className="mb-3 flex items-center gap-2">
              <ClipboardList className="h-3.5 w-3.5 text-slate-400" />
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Workflow</p>
            </div>

            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500">Status</p>
                <div
                  ref={workflowScrollerRef}
                  onWheel={handleWorkflowWheel}
                  className="-mx-1 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                >
                  <div className="flex min-w-max snap-x snap-mandatory gap-1.5 px-1">
                    {STATUS_OPTIONS.map((status) => {
                      const isActive = form.status === status;
                      return (
                        <button
                          key={status}
                          type="button"
                          onClick={() => setForm((prev) => ({ ...prev, status }))}
                          className={`h-8 snap-start whitespace-nowrap rounded-full border px-3 text-[9px] font-black uppercase tracking-wide transition-all ${
                            isActive
                              ? 'border-slate-900 bg-slate-900 text-white'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {status.replace('_', ' ')}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

            </div>
          </section>

          <div className="h-px bg-gray-100" />

          <section>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-500">
                  P
                </span>
                <select
                  value={form.priority}
                  onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value as PriorityPreset }))}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none transition-colors focus:border-slate-400 focus:ring-0"
                >
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500">
                  <Calendar className="h-3 w-3" />
                  D
                </span>
                <input
                  type="date"
                  value={form.deadlineAt}
                  onChange={(e) => setForm((prev) => ({ ...prev, deadlineAt: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none transition-colors focus:border-slate-400 focus:ring-0"
                />
              </label>
            </div>
          </section>

          <div className="h-px bg-gray-100" />

          <section>
            <p className="mb-2.5 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Current State</p>
            <dl className="space-y-1.5 text-[12px]">
              {[
                { label: 'Queue', value: row.queueLabel },
                { label: 'Status', value: form.status.replace('_', ' ') },
                { label: 'Priority', value: getPriorityLabel(form.priority) },
                { label: 'Deadline', value: formatDate(form.deadlineAt || row.deadlineAt) },
                ...(row.notes ? [{ label: 'Notes', value: row.notes }] : []),
                ...(row.updatedAt ? [{ label: 'Updated', value: formatDate(row.updatedAt) }] : []),
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between gap-4">
                  <dt className="font-medium text-slate-400">{label}</dt>
                  <dd className="max-w-[220px] text-right font-black text-slate-800">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {orderDetailsRecord ? (
            <>
              <div className="h-px bg-gray-100" />
              <ShippingInformationSection
                shipped={orderDetailsRecord}
                copiedAll={copiedAll}
                onCopyAll={() => void handleCopyAll()}
                showSerialNumber={false}
              />
              <div className="h-px bg-gray-100" />
              <ProductDetailsSection shipped={orderDetailsRecord} />
            </>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-gray-100 bg-white px-6 py-4">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {saving ? 'Saving…' : 'Save Work Order'}
        </button>
      </div>
    </motion.div>
  );
}
