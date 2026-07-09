'use client';

import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { dispatchNavigateShippedDetails } from '@/utils/events';
import { usePanelActions } from '@/hooks/usePanelActions';
import { DetailStackRailRegistrar } from '@/components/right-rail/DetailStackRailRegistrar';
import { WorkOrderAssignmentCard } from '@/components/work-orders/WorkOrderAssignmentCard';
import { type PaneHeaderActionBarAction } from '@/components/ui/pane-header';
import type { DetailsStackDurationData, ShippedActiveInput } from './stacks/types';
import { buildAssignmentRow, deriveShippedHeaderMeta } from './details-panel/shipped-details-logic';
import {
  useShippedAssignment,
  useShippedCopyActions,
  useShippedDeletion,
  useShippedDetailState,
  useShippedPanelViewState,
} from './details-panel/shipped-details-hooks';
import { ShippedDetailsHeader } from './details-panel/ShippedDetailsHeader';
import { ShippedDetailsBody } from './details-panel/ShippedDetailsBody';

export type { ShippedActiveInput };

interface ShippedDetailsPanelProps {
  shipped: ShippedOrder;
  onClose: () => void;
  onUpdate: () => void;
  context?: 'dashboard' | 'queue' | 'fulfillment' | 'labels' | 'staged' | 'shipped' | 'station' | 'packer';
}

export function ShippedDetailsPanel({
  shipped: initialShipped,
  onClose,
  onUpdate,
  context = 'dashboard',
}: ShippedDetailsPanelProps) {
  const isFulfillmentPanel = context === 'queue' || context === 'fulfillment';
  const isLabelsPanel = context === 'labels';
  const isStagedPanel = context === 'staged';
  // Dashboard-style contexts get the panel-action bar, the Customer tab, and the
  // shipping-label drop-zone (labels only).
  const showDashboardExtras = context === 'dashboard' || isFulfillmentPanel || isLabelsPanel;
  // Outbound documents (label + slip) get their own tab wherever the tray used
  // to render inline (docs/outbound-documents-plan.md §9.1/9.2) — full tray on
  // labels, read-only on dashboard/fulfillment/staged.
  const showDocumentsTab = showDashboardExtras || isStagedPanel;

  const [durationData] = useState<DetailsStackDurationData>({});

  const {
    shipped,
    setShipped,
    orderNumber,
    setOrderNumber,
    itemNumber,
    setItemNumber,
    shippingTrackingNumber,
    setShippingTrackingNumber,
    notes,
    setNotes,
    outOfStock,
    setOutOfStock,
    shipByDate,
    setShipByDate,
    isSavingInlineFields,
    isSavingNotes,
    isSavingOutOfStock,
    isSavingShipByDate,
    saveInlineFields,
    saveShipByDate,
    handleSaveNotes,
    handleSaveOutOfStock,
  } = useShippedDetailState(initialShipped, onUpdate);

  const meta = deriveShippedHeaderMeta(shipped);

  const {
    activeSection,
    setActiveSection,
    activeInput,
    setActiveInput,
  } = useShippedPanelViewState({ initialShipped });

  const { copiedAll, copiedOrderId, handleCopyAll, handleCopyOrderId } = useShippedCopyActions(
    shipped,
    meta.orderIdDisplay,
  );
  const { isDeleteArmed, isDeleting, handleDelete } = useShippedDeletion(shipped, onUpdate);
  const {
    showAssignmentCard,
    setShowAssignmentCard,
    openAssignmentCard,
    handleAssignmentConfirm,
    technicianOptions,
    packerOptions,
  } = useShippedAssignment({ shipped, setShipped, onUpdate });

  // Goals / status / out-of-stock / notes actions, rendered in the header
  // action bar instead of inside each stack.
  const panelActions = usePanelActions(
    { entityType: 'order', entityId: shipped.id, orderId: shipped.order_id },
    {
      status: () => setActiveInput((prev) => (prev === 'mark_shipped' ? 'none' : 'mark_shipped')),
      out_of_stock: () => setActiveInput((prev) => (prev === 'out_of_stock' ? 'none' : 'out_of_stock')),
      notes: () => setActiveInput((prev) => (prev === 'notes' ? 'none' : 'notes')),
    },
  );

  // Compose the action list directly (assign + entity actions) for the flat,
  // full-width bar in PaneHeader.belowSlot — bypassing the rounded-card adapter.
  const mappedPanelActions = panelActions.map((action) => ({
    key: action.key,
    label: action.label,
    icon: <span className={action.toneClassName}>{action.icon}</span>,
    onClick: action.onAction,
    // Highlight the button while its panel is open, so the selected action is clear.
    active:
      action.key === 'status'
        ? activeInput === 'mark_shipped'
        : action.key === 'out_of_stock'
          ? activeInput === 'out_of_stock'
          : action.key === 'notes'
            ? activeInput === 'notes'
            : false,
    // The "Status" action opens the Mark-as-shipped form — name the tooltip for
    // what it does, not the generic catalog label.
    ...(action.key === 'status' ? { title: 'Mark as shipped' } : {}),
  }));
  const notesAction = mappedPanelActions.find((action) => action.key === 'notes');
  const headerBarActions: PaneHeaderActionBarAction[] = [
    ...(showDashboardExtras
      ? mappedPanelActions.filter((action) => action.key !== 'notes' && action.key !== 'goals')
      : []),
    ...(notesAction ? [notesAction] : []),
  ];

  const stackActionBar = {
    onClose,
    onMoveUp: () => dispatchNavigateShippedDetails('up'),
    onMoveDown: () => dispatchNavigateShippedDetails('down'),
    onAssign: meta.canEditAssignment ? openAssignmentCard : undefined,
  };

  return (
    <DetailStackRailRegistrar id={`detail:order:${shipped.id}`} onClose={onClose}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <ShippedDetailsHeader
          orderIdDisplay={meta.orderIdDisplay}
          showExceptionsFallback={meta.showExceptionsFallback}
          copiedOrderId={copiedOrderId}
          onCopyOrderId={handleCopyOrderId}
          onClose={onClose}
          actions={headerBarActions}
          onMoveUp={stackActionBar.onMoveUp}
          onMoveDown={stackActionBar.onMoveDown}
          showCustomerTab={showDashboardExtras}
          showDocumentsTab={showDocumentsTab}
          activeSection={activeSection}
          onSectionChange={setActiveSection}
        />

        <ShippedDetailsBody
          context={context}
          isFulfillmentPanel={isFulfillmentPanel}
          isLabelsPanel={isLabelsPanel}
          showDashboardExtras={showDashboardExtras}
          activeSection={activeSection}
          shipped={shipped}
          durationData={durationData}
          copiedAll={copiedAll}
          onCopyAll={handleCopyAll}
          onUpdate={onUpdate}
          activeInput={activeInput}
          setActiveInput={setActiveInput}
          stackActionBar={stackActionBar}
          editableFields={{
            orderNumber,
            itemNumber,
            trackingNumber: shippingTrackingNumber,
            shipByDate,
            isSavingInlineFields,
            isSavingShipByDate,
            setOrderNumber,
            setItemNumber,
            setTrackingNumber: setShippingTrackingNumber,
            setShipByDate,
            onSaveInline: saveInlineFields,
            onSaveShipByDate: saveShipByDate,
          }}
          notes={notes}
          setNotes={setNotes}
          isSavingNotes={isSavingNotes}
          onSaveNotes={() => { void handleSaveNotes(() => setActiveInput('none')); }}
          outOfStock={outOfStock}
          setOutOfStock={setOutOfStock}
          isSavingOutOfStock={isSavingOutOfStock}
          onSaveOutOfStock={() => { void handleSaveOutOfStock(() => setActiveInput('none')); }}
          onMarkShippedSuccess={() => {
            setActiveInput('none');
            onUpdate();
          }}
          isDeleteArmed={isDeleteArmed}
          isDeletingOrder={isDeleting}
          onDeleteOrder={handleDelete}
        />

        <AnimatePresence>
          {showAssignmentCard && meta.canEditAssignment ? (
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
      </div>
    </DetailStackRailRegistrar>
  );
}
