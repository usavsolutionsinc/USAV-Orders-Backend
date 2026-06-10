'use client';

import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Package, Trash2, X } from '../Icons';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { buildShippedCopyInfo } from '@/utils/copyallshipped';
import { DashboardDetailsStack } from './stacks/DashboardDetailsStack';
import { TechDetailsStack } from './stacks/TechDetailsStack';
import { PackerDetailsStack } from './stacks/PackerDetailsStack';
import { DetailsStackDurationData } from './stacks/types';
import { ShippedDetailsPanelContent, type ShippedActiveSection } from './ShippedDetailsPanelContent';
import { QtyBadge } from '@/components/ui/QtyBadge';
import { useDeleteOrderRow } from '@/hooks';
import { dispatchNavigateShippedDetails } from '@/utils/events';
import { getStaffName, staffHasRole } from '@/utils/staff';
import { useOrderFieldSave } from '@/hooks/useOrderFieldSave';
import { toPSTDateKey } from '@/utils/date';
import { getPresentStaffForToday, type StaffMember } from '@/lib/staffCache';
import { WorkOrderAssignmentCard, type AssignmentConfirmPayload } from '@/components/work-orders/WorkOrderAssignmentCard';
import type { WorkOrderRow } from '@/components/work-orders/types';
import { sectionLabel, microBadge } from '@/design-system/tokens/typography/presets';
import {
  PaneHeader,
  PaneHeaderIconBadge,
  PaneHeaderLabel,
  PaneHeaderCloseButton,
  PaneHeaderStatusPill,
  PaneHeaderTabs,
  PaneHeaderActionBar,
  type PaneHeaderActionBarAction,
} from '@/components/ui/pane-header';
import { Settings } from '@/components/Icons';
import { usePanelActions } from '@/hooks/usePanelActions';
import { SlideOverBackdrop } from '@/components/ui/SlideOverBackdrop';

export type ShippedActiveInput = 'none' | 'out_of_stock' | 'notes';

interface ShippedDetailsPanelProps {
  shipped: ShippedOrder;
  onClose: () => void;
  onUpdate: () => void;
  context?: 'dashboard' | 'queue' | 'shipped' | 'station' | 'packer';
}

function buildAssignmentRow(shipped: ShippedOrder): WorkOrderRow {
  return {
    id: `ORDER:${shipped.id}`,
    entityType: 'ORDER',
    entityId: Number(shipped.id),
    queueKey: 'orders',
    queueLabel: 'Orders',
    title: shipped.product_title || 'Untitled order',
    subtitle: [shipped.order_id, shipped.shipping_tracking_number, shipped.sku].filter(Boolean).join(' • '),
    recordLabel: shipped.order_id || shipped.item_number || `Order #${shipped.id}`,
    sourcePath: '/dashboard',
    techId: shipped.tester_id ?? null,
    techName: shipped.tester_name || null,
    packerId: shipped.packer_id ?? null,
    packerName: shipped.packed_by_name || null,
    status: 'ASSIGNED',
    priority: 100,
    deadlineAt: shipped.ship_by_date || shipped.deadline_at || null,
    notes: shipped.notes || null,
    assignedAt: null,
    updatedAt: shipped.created_at || null,
    orderId: shipped.order_id || null,
    trackingNumber: shipped.shipping_tracking_number || null,
    itemNumber: shipped.item_number || null,
    sku: shipped.sku || null,
    condition: shipped.condition || null,
    shipmentId: shipped.shipment_id ?? null,
    accountSource: shipped.account_source || null,
    quantity: shipped.quantity || null,
    createdAt: shipped.created_at || null,
  };
}

export function ShippedDetailsPanel({
  shipped: initialShipped,
  onClose,
  onUpdate: _onUpdate,
  context = 'dashboard'
}: ShippedDetailsPanelProps) {
  const [shipped, setShipped] = useState<ShippedOrder>(initialShipped);
  const [durationData] = useState<DetailsStackDurationData>({});
  // Tab state — Return is the default when the order is packed (it leads with
  // the operator-relevant "who packed / tested / with what serials" info);
  // otherwise default to Shipping.
  const hasReturnContent =
    !!initialShipped.packed_at &&
    initialShipped.packed_at !== '1' &&
    context !== 'queue';
  const [activeSection, setActiveSection] = useState<ShippedActiveSection>(
    hasReturnContent ? 'return' : 'shipping',
  );
  // Reset to a sensible default when the underlying order changes (e.g. user
  // navigates to a different order via the panel's up/down arrows).
  useEffect(() => {
    setActiveSection(hasReturnContent ? 'return' : 'shipping');
  }, [initialShipped.id, hasReturnContent]);
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedOrderId, setCopiedOrderId] = useState(false);
  const [isDeleteArmed, setIsDeleteArmed] = useState(false);
  const [shipByDate, setShipByDate] = useState('');
  const [orderNumber, setOrderNumber] = useState(initialShipped.order_id || '');
  const [itemNumber, setItemNumber] = useState(initialShipped.item_number || '');
  const [shippingTrackingNumber, setShippingTrackingNumber] = useState(initialShipped.shipping_tracking_number || '');
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [showAssignmentCard, setShowAssignmentCard] = useState(false);
  // Lifted from the stacks so the action bar can live in PaneHeader.belowSlot
  // ABOVE the tabs. Inline editors inside the stacks consume these via props.
  const [activeInput, setActiveInput] = useState<ShippedActiveInput>('none');
  const [isMarkAsShippedOpen, setIsMarkAsShippedOpen] = useState(false);
  useEffect(() => {
    setActiveInput('none');
    setIsMarkAsShippedOpen(false);
  }, [initialShipped.id]);
  const deleteOrderMutation = useDeleteOrderRow();
  const isDeletingOrder = deleteOrderMutation.isPending;
  const outOfStockValue = String((shipped as any).out_of_stock || '').trim();
  const hasOutOfStock = outOfStockValue !== '';
  const testedById = shipped.tested_by ?? null;
  const canEditAssignment = Number(shipped.id) > 0 && (shipped as any).row_source !== 'exception';
  const hasTechScan = Boolean((shipped as any).has_tech_scan);
  const statusTone: 'emerald' | 'red' | 'yellow' = hasTechScan
    ? 'emerald'
    : hasOutOfStock
      ? 'red'
      : 'yellow';
  const statusLabel = hasTechScan
    ? `Tested by ${getStaffName(testedById)}`
    : hasOutOfStock
      ? outOfStockValue
      : 'Pending';
  const fieldSave = useOrderFieldSave({
    orderId: shipped.id,
    initialOrderNumber: initialShipped.order_id || '',
    initialItemNumber: initialShipped.item_number || '',
    initialTrackingNumber: initialShipped.shipping_tracking_number || '',
    onUpdate: _onUpdate,
  });
  const {
    isSavingInlineFields,
    isSavingShipByDate,
    saveInlineFields: persistInlineFields,
    saveShipByDate,
    resetRefs,
  } = fieldSave;

  const toMonthDayYearCurrent = useCallback((value: string | null | undefined) => {
    if (!value) return '';
    const pstDateKey = toPSTDateKey(value);
    if (!pstDateKey) return '';
    const [year, month, day] = pstDateKey.split('-').map(Number);
    return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}-${String(year % 100).padStart(2, '0')}`;
  }, []);

  useEffect(() => {
    setShipped(initialShipped);
    const preferredDate = String(initialShipped.ship_by_date || '').trim() || initialShipped.created_at || '';
    setShipByDate(toMonthDayYearCurrent(preferredDate));
    setOrderNumber(initialShipped.order_id || '');
    setItemNumber(initialShipped.item_number || '');
    setShippingTrackingNumber(initialShipped.shipping_tracking_number || '');
    resetRefs(
      initialShipped.order_id || '',
      initialShipped.item_number || '',
      initialShipped.shipping_tracking_number || ''
    );
  }, [initialShipped, resetRefs, toMonthDayYearCurrent]);

  const saveInlineFields = useCallback(async () => {
    await persistInlineFields(orderNumber, itemNumber, shippingTrackingNumber);
  }, [itemNumber, orderNumber, persistInlineFields, shippingTrackingNumber]);

  const technicianOptions = staff
    .filter((member) => staffHasRole(member, 'technician'))
    .map((member) => ({ id: Number(member.id), name: member.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const packerOptions = staff
    .filter((member) => staffHasRole(member, 'packer'))
    .map((member) => ({ id: Number(member.id), name: member.name }));

  const openAssignmentCard = useCallback(async () => {
    try {
      const members = await getPresentStaffForToday();
      setStaff(members);
      setShowAssignmentCard(true);
    } catch {
      window.alert('Failed to load staff.');
    }
  }, []);

  const handleAssignmentConfirm = useCallback(async (row: WorkOrderRow, payload: AssignmentConfirmPayload) => {
    const nextStatus =
      payload.status ??
      (payload.techId && payload.packerId ? 'ASSIGNED' : 'OPEN');

    try {
      const res = await fetch('/api/work-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: row.entityType,
          entityId: row.entityId,
          assignedTechId: payload.techId,
          assignedPackerId: payload.packerId,
          status: nextStatus,
          priority: row.priority,
          deadlineAt: payload.deadline,
          notes: row.notes,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.details || data?.error || 'Failed to save assignment');
      }

      setShipped((current) => ({
        ...current,
        tester_id: payload.techId,
        packer_id: payload.packerId,
        ship_by_date: payload.deadline ?? current.ship_by_date,
        deadline_at: payload.deadline ?? current.deadline_at,
      }));
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
      _onUpdate();
    } catch (error: any) {
      window.alert(error?.message || 'Failed to save assignment');
    }
  }, [_onUpdate]);

  const handleCopyAll = () => {
    const allInfo = buildShippedCopyInfo(shipped);
    navigator.clipboard.writeText(allInfo);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const stackActionBar = {
    onClose,
    onMoveUp: () => dispatchNavigateShippedDetails('up'),
    onMoveDown: () => dispatchNavigateShippedDetails('down'),
    onAssign: canEditAssignment ? openAssignmentCard : undefined,
  };

  // Build the goals / status / out-of-stock / notes actions once, here, since
  // the action bar now renders in this component's PaneHeader instead of
  // inside each stack. Other contexts (station/packer/shipped) get a bare bar.
  const panelActions = usePanelActions(
    { entityType: 'order', entityId: shipped.id, orderId: shipped.order_id },
    {
      status: () => setIsMarkAsShippedOpen((prev) => !prev),
      out_of_stock: () => setActiveInput((prev) => prev === 'out_of_stock' ? 'none' : 'out_of_stock'),
      notes: () => setActiveInput((prev) => prev === 'notes' ? 'none' : 'notes'),
    },
  );
  const showPanelActions = context === 'dashboard' || context === 'queue';

  // Compose the action list directly (assign + entity actions) so the bar can
  // render in PaneHeader.belowSlot with flat full-width styling. We bypass
  // the PanelActionBar adapter here because that adapter wraps the bar in a
  // rounded-card variant + nested padding — not what this panel needs.
  const headerBarActions: PaneHeaderActionBarAction[] = [
    ...(canEditAssignment
      ? [{
          key: 'assign',
          label: 'Assign',
          icon: <Settings className="h-3.5 w-3.5" />,
          onClick: openAssignmentCard,
          title: 'Open assignment',
        }]
      : []),
    ...(showPanelActions
      ? panelActions.map((a) => ({
          key: a.key,
          label: a.label,
          icon: <span className={a.toneClassName}>{a.icon}</span>,
          onClick: a.onAction,
        }))
      : []),
  ];

  // Display value for the order-id header. When no canonical `order_id` is
  // present (exceptions-table rows, partial intake, etc.), fall back to the
  // raw table id rendered as an EXCEPTIONS reference so the header is never
  // empty AND the eyebrow accurately reflects the source.
  const orderIdTrimmed = String(shipped.order_id || '').trim();
  const showExceptionsFallback = !orderIdTrimmed;
  const orderIdDisplay = orderIdTrimmed || String(Math.abs(Number(shipped.id)));

  const handleCopyOrderId = () => {
    const value = orderIdDisplay.trim();
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopiedOrderId(true);
    setTimeout(() => setCopiedOrderId(false), 1500);
  };

  const handleDeleteOrder = async () => {
    const rowId = Number(shipped.id);
    const isExceptionRow = (shipped as any).row_source === 'exception' || rowId < 0;
    const targetId = isExceptionRow ? Math.abs(rowId) : rowId;
    if (!Number.isFinite(targetId) || targetId <= 0) return;

    if (!isDeleteArmed) {
      setIsDeleteArmed(true);
      window.setTimeout(() => setIsDeleteArmed(false), 3000);
      return;
    }

    setIsDeleteArmed(false);
    try {
      if (isExceptionRow) {
        await deleteOrderMutation.mutateAsync({ rowSource: 'exception', exceptionId: targetId });
      } else {
        const normalizedTrackingType = String((shipped as any).tracking_type || '').toUpperCase();
        const activityLogId = Number((shipped as any).station_activity_log_id || (shipped as any).sal_id) || undefined;
        const packerLogId = Number((shipped as any).packer_log_id) || undefined;
        const isLikelyActivityLogRow =
          activityLogId != null && Number(activityLogId) === Number(shipped.id);
        const shouldDeletePackingLog =
          normalizedTrackingType === 'FBA' ||
          normalizedTrackingType === 'FNSKU' ||
          normalizedTrackingType === 'SKU' ||
          normalizedTrackingType === 'SCAN' ||
          isLikelyActivityLogRow;

        if (shouldDeletePackingLog) {
          await deleteOrderMutation.mutateAsync({
            rowSource: 'packing_log',
            activityLogId,
            packerLogId,
          });
        } else {
          await deleteOrderMutation.mutateAsync({ rowSource: 'order', orderId: targetId });
        }
      }

      _onUpdate();
    } catch (error) {
      console.error('Failed to delete shipped order:', error);
      window.alert('Failed to permanently delete order. Please try again.');
    }
  };

  return (
    <>
      <SlideOverBackdrop onClose={onClose} />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 350, mass: 0.5 }}
        className="fixed right-0 top-0 z-panel flex h-screen w-[420px] flex-col overflow-hidden border-l border-gray-200 bg-white shadow-[-20px_0_50px_rgba(0,0,0,0.05)]"
      >
      <PaneHeader
        className="shrink-0 border-b-0 bg-white/90 backdrop-blur-xl"
        rowClassName="px-6"
        leftSlot={
          <>
            <PaneHeaderIconBadge Icon={Package} bg="bg-blue-600" tint="text-white" />
            <PaneHeaderLabel
              eyebrow={showExceptionsFallback ? 'Exceptions' : 'Order #'}
              value={
                <button
                  type="button"
                  onClick={handleCopyOrderId}
                  className="truncate text-left transition-colors hover:text-blue-700"
                  title={copiedOrderId ? 'Copied' : 'Click to copy'}
                  aria-label={`Copy ${orderIdDisplay}`}
                >
                  {orderIdDisplay}
                  {copiedOrderId && <span className="ml-1 text-emerald-600">✓</span>}
                </button>
              }
              valueTitle={orderIdDisplay}
            />
          </>
        }
        rightSlot={<PaneHeaderCloseButton onClick={onClose} ariaLabel="Close details" />}
        belowSlot={
          <>
            <div className="flex flex-wrap items-center gap-2 px-6 pb-2">
              <QtyBadge quantity={(shipped as any).quantity} />
              <PaneHeaderStatusPill tone={statusTone} pulse>
                {statusLabel}
              </PaneHeaderStatusPill>
            </div>
            <div className="px-6 py-2">
              <PaneHeaderActionBar
                iconOnly
                variant="card"
                actions={headerBarActions}
                onPrev={stackActionBar.onMoveUp}
                onNext={stackActionBar.onMoveDown}
                prevTitle="Move up a row"
                nextTitle="Move down a row"
              />
            </div>
            <PaneHeaderTabs<ShippedActiveSection>
              tabs={[
                ...(hasReturnContent
                  ? [{ value: 'return' as const, label: 'Return' }]
                  : []),
                { value: 'shipping' as const, label: 'Shipping' },
                { value: 'product' as const, label: 'Product' },
              ]}
              value={activeSection}
              onChange={setActiveSection}
              className="px-6"
            />
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto no-scrollbar">
          {context === 'dashboard' || context === 'queue' ? (
            <DashboardDetailsStack
              shipped={shipped}
              durationData={durationData}
              copiedAll={copiedAll}
              onCopyAll={handleCopyAll}
              onUpdate={_onUpdate}
              showShippingTimestamp={false}
              showReturnInformation={context !== 'queue'}
              activeSection={activeSection}
              activeInput={activeInput}
              setActiveInput={setActiveInput}
              isMarkAsShippedOpen={isMarkAsShippedOpen}
              setIsMarkAsShippedOpen={setIsMarkAsShippedOpen}
            />
          ) : context === 'station' ? (
            <TechDetailsStack
              shipped={shipped}
              durationData={durationData}
              copiedAll={copiedAll}
              onCopyAll={handleCopyAll}
              onUpdate={_onUpdate}
              showShippingTimestamp={false}
              actionBar={stackActionBar}
              activeSection={activeSection}
            />
          ) : context === 'packer' ? (
            <PackerDetailsStack
              shipped={shipped}
              durationData={durationData}
              copiedAll={copiedAll}
              onCopyAll={handleCopyAll}
              onUpdate={_onUpdate}
              showShippingTimestamp={false}
              actionBar={stackActionBar}
              activeSection={activeSection}
            />
          ) : (
            <div className="flex min-h-full flex-col pb-8 pt-4">
              <div className="flex-1 space-y-4">
                <ShippedDetailsPanelContent
                  activeSection={activeSection}
                  shipped={{
                    ...shipped,
                    order_id: orderNumber,
                    item_number: itemNumber,
                    shipping_tracking_number: shippingTrackingNumber,
                  }}
                  durationData={durationData}
                  copiedAll={copiedAll}
                  onCopyAll={handleCopyAll}
                  onUpdate={_onUpdate}
                  editableShippingFields={{
                    orderNumber,
                    itemNumber,
                    trackingNumber: shippingTrackingNumber,
                    shipByDate,
                    isSaving: isSavingInlineFields,
                    isSavingShipByDate,
                    onOrderNumberChange: setOrderNumber,
                    onItemNumberChange: setItemNumber,
                    onTrackingNumberChange: setShippingTrackingNumber,
                    onShipByDateChange: setShipByDate,
                    onBlur: () => { void saveInlineFields(); },
                    onShipByDateBlur: () => { void saveShipByDate(shipByDate); },
                  }}
                  showShippingTimestamp={false}
                />
              </div>

              {context === 'shipped' && (
                <section className="mx-8 pt-2">
                  <button
                    type="button"
                    onClick={handleDeleteOrder}
                    disabled={isDeletingOrder}
                    className={`w-full h-10 inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 ${sectionLabel} text-white tracking-wider disabled:opacity-50`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {isDeletingOrder
                      ? 'Deleting...'
                      : isDeleteArmed
                        ? 'Click Again To Confirm'
                        : 'Delete'}
                  </button>
                </section>
              )}
            </div>
          )}
      </div>

      <AnimatePresence>
        {showAssignmentCard && canEditAssignment ? (
          <WorkOrderAssignmentCard
            rows={[buildAssignmentRow(shipped)]}
            startIndex={0}
            technicianOptions={technicianOptions}
            packerOptions={packerOptions}
            onConfirm={handleAssignmentConfirm}
            onClose={() => setShowAssignmentCard(false)}
          />
        ) : null}
      </AnimatePresence>
      </motion.div>
    </>
  );
}
