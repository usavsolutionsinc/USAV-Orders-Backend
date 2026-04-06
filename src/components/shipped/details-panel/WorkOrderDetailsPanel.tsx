'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import {
  ExternalLink,
} from '@/components/Icons';
import { getPresentStaffForToday, type StaffMember } from '@/lib/staffCache';
import { PanelActionBar } from '@/components/shipped/details-panel/PanelActionBar';
import { usePanelActions } from '@/hooks/usePanelActions';
import { ShippingInformationSection } from '@/components/shipped/details-panel/ShippingInformationSection';
import { ProductDetailsSection } from '@/components/shipped/details-panel/ProductDetailsSection';
import { MarkAsShippedForm } from '@/components/shipped/stacks/MarkAsShippedForm';
import { OutOfStockField } from '@/components/ui/OutOfStockField';
import { OutOfStockEditorBlock } from '@/components/ui/OutOfStockEditorBlock';
import { DeleteOrderControl } from '@/components/shipped/stacks/DeleteOrderControl';
import { useOrderFieldSave } from '@/hooks/useOrderFieldSave';
import type { ShippedOrder } from '@/lib/neon/orders-queries';
import { dispatchNavigateShippedDetails } from '@/utils/events';
import { saveWorkOrder } from '@/lib/work-orders/saveWorkOrder';
import {
  WorkOrderAssignmentCard,
  type AssignmentConfirmPayload,
} from '@/design-system/components/WorkOrderAssignmentCard';
import {
  type WorkOrderRow,
  type WorkStatus,
  STATUS_COLOR,
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

function buildOrderDetailsRecord(row: WorkOrderRow): ShippedOrder | null {
  if (row.entityType !== 'ORDER') return null;

  const detailsRecord: ShippedOrder & { out_of_stock: string | null } = {
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
    tracking_numbers: Array.isArray((row as any).trackingNumbers)
      ? (row as any).trackingNumbers
      : (row.trackingNumber ? [row.trackingNumber] : []),
    tracking_number_rows: Array.isArray(row.trackingNumberRows)
      ? row.trackingNumberRows.map((r) => ({
          shipment_id: r.shipment_id,
          tracking: r.tracking_number_raw,
          is_primary: r.is_primary,
        }))
      : [],
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
    out_of_stock: row.outOfStock || null,
  };

  return detailsRecord;
}

export function WorkOrderDetailsPanel({
  row,
  onClose,
  onSaved,
  disableMoveUp = false,
  disableMoveDown = false,
}: WorkOrderDetailsPanelProps) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [copiedAll, setCopiedAll] = useState(false);
  const [outOfStock, setOutOfStock] = useState(String(row.outOfStock || ''));
  const [notes, setNotes] = useState(row.notes || '');
  const [isMarkAsShippedOpen, setIsMarkAsShippedOpen] = useState(false);
  const [isAssignmentOpen, setIsAssignmentOpen] = useState(false);
  const [activeInput, setActiveInput] = useState<'none' | 'out_of_stock' | 'notes'>('none');
  const [form, setForm] = useState({
    assignedTechId: row.techId ? String(row.techId) : '',
    assignedPackerId: row.packerId ? String(row.packerId) : '',
    status: row.status as WorkStatus,
    deadlineAt: toDateInputValue(row.deadlineAt),
  });

  const orderDetailsRecord = useMemo(() => buildOrderDetailsRecord(row), [row]);
  const hasOutOfStockValue = outOfStock.trim().length > 0;
  const fieldSave = useOrderFieldSave({
    orderId: row.entityType === 'ORDER' ? row.entityId : -1,
    initialOrderNumber: row.orderId || '',
    initialItemNumber: row.itemNumber || '',
    initialTrackingNumber: row.trackingNumber || '',
    onUpdate: onSaved,
  });

  useEffect(() => {
    let active = true;
    getPresentStaffForToday()
      .then((members) => { if (active) setStaff(members); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setForm({
      assignedTechId: row.techId ? String(row.techId) : '',
      assignedPackerId: row.packerId ? String(row.packerId) : '',
      status: row.status,
      deadlineAt: toDateInputValue(row.deadlineAt),
    });
    setOutOfStock(String(row.outOfStock || ''));
    setNotes(row.notes || '');
    setActiveInput('none');
    setIsMarkAsShippedOpen(false);
  }, [row]);

  useEffect(() => {
    setIsAssignmentOpen(false);
  }, [row.id]);

  useEffect(() => {
    if (!copiedAll) return;
    const timer = window.setTimeout(() => setCopiedAll(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copiedAll]);

  const panelActions = usePanelActions(
    { entityType: 'work_order', entityId: row.entityId, orderId: row.orderId },
    orderDetailsRecord
      ? {
          status: () => setIsMarkAsShippedOpen((prev) => !prev),
          out_of_stock: () => setActiveInput((prev) => prev === 'out_of_stock' ? 'none' : 'out_of_stock'),
          notes: () => setActiveInput((prev) => prev === 'notes' ? 'none' : 'notes'),
        }
      : {},
  );

  const technicianOptions = staff
    .filter((m) => m.role === 'technician')
    .map((m) => ({ id: Number(m.id), name: m.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const packerOptions = staff
    .filter((m) => m.role === 'packer')
    .map((m) => ({ id: Number(m.id), name: m.name }));

  const formRef = useRef(form);
  formRef.current = form;

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

  const statusBadgeClass = STATUS_COLOR[form.status] || 'text-gray-600 bg-gray-100';
  const handleAssignmentConfirm = useCallback(async (_assignmentRow: WorkOrderRow, payload: AssignmentConfirmPayload) => {
    const nextForm = {
      ...formRef.current,
      assignedTechId: payload.techId ? String(payload.techId) : '',
      assignedPackerId: payload.packerId ? String(payload.packerId) : '',
      status: payload.status ?? formRef.current.status,
      deadlineAt: payload.deadline || '',
    };

    formRef.current = nextForm;
    setForm(nextForm);

    try {
      await saveWorkOrder({
        entityType: row.entityType,
        entityId: row.entityId,
        assignedTechId: payload.techId,
        assignedPackerId: payload.packerId,
        status: nextForm.status,
        priority: Number(row.priority || 100),
        deadlineAt: payload.deadline,
      });
      onSaved();
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch (err: any) {
      window.alert(err?.message || 'Failed to save work order');
    }
  }, [onSaved, row.entityId, row.entityType]);

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 26, stiffness: 360, mass: 0.45 }}
      className="fixed right-0 top-0 z-[100] flex h-screen w-[400px] flex-col overflow-hidden border-l border-gray-200 bg-white shadow-[-24px_0_48px_rgba(0,0,0,0.06)]"
    >
      {/* Header */}
      <div className="shrink-0 border-b border-gray-100 bg-white px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <span className={`${sectionLabel} text-emerald-700`}>{row.queueLabel}</span>
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] ${statusBadgeClass}`}>
                {form.status.replace('_', ' ')}
              </span>
            </div>
            <h2 className="truncate text-[15px] font-black uppercase tracking-tight text-gray-950">
              {row.recordLabel}
            </h2>
          </div>
          <Link
            href={buildSourceHref(row)}
            target="_blank"
            rel="noopener"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-800"
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
        onAssign={() => setIsAssignmentOpen(true)}
        disableMoveUp={disableMoveUp}
        disableMoveDown={disableMoveDown}
        actions={panelActions}
      />

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-3">
          {/* Inline editors (OOS, notes, mark-as-shipped) */}
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

              {(activeInput === 'out_of_stock' || hasOutOfStockValue) && (
                activeInput === 'out_of_stock' ? (
                  <OutOfStockEditorBlock
                    value={outOfStock}
                    onChange={setOutOfStock}
                    onCancel={() => {
                      setOutOfStock(String(row.outOfStock || ''));
                      setActiveInput('none');
                    }}
                    onSubmit={() => void fieldSave.saveOutOfStock(outOfStock)}
                    isSaving={fieldSave.isSavingOutOfStock}
                    autoFocus
                  />
                ) : (
                  <OutOfStockField
                    value={outOfStock}
                    onEdit={() => setActiveInput('out_of_stock')}
                  />
                )
              )}

              {activeInput === 'notes' && (
                <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/70 p-3">
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
                      className="h-8 rounded-lg border border-gray-200 bg-white text-[10px] font-black uppercase tracking-wider text-gray-700"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void fieldSave.saveNotes(notes)}
                      disabled={fieldSave.isSavingNotes}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-gray-900 text-[10px] font-black uppercase tracking-wider text-white hover:bg-gray-800 disabled:opacity-50"
                    >
                      {fieldSave.isSavingNotes ? 'Saving' : 'Submit'}
                    </button>
                  </div>
                </div>
              )}
            </section>
          ) : null}

          {/* Shipping + Product Details */}
          {orderDetailsRecord ? (
            <>
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

          {/* Delete */}
          {row.entityType === 'ORDER' && (
            <>
              <div className="h-px bg-gray-100" />
              <DeleteOrderControl
                orderId={row.entityId}
                onDeleted={() => {
                  window.dispatchEvent(new CustomEvent('dashboard-refresh'));
                  window.dispatchEvent(new CustomEvent('usav-refresh-data'));
                  onSaved();
                  onClose();
                }}
              />
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isAssignmentOpen ? (
          <WorkOrderAssignmentCard
            rows={[{
              ...row,
              techId: form.assignedTechId ? Number(form.assignedTechId) : null,
              packerId: form.assignedPackerId ? Number(form.assignedPackerId) : null,
              status: form.status,
              deadlineAt: form.deadlineAt || null,
              priority: Number(row.priority || 100),
            }]}
            startIndex={0}
            technicianOptions={technicianOptions}
            packerOptions={packerOptions}
            onConfirm={handleAssignmentConfirm}
            allowEditConfirmed
            closeWhenCompleted={false}
            onClose={() => setIsAssignmentOpen(false)}
          />
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
