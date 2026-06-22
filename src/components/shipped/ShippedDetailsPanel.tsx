'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Settings } from '@/components/Icons';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { dispatchNavigateShippedDetails } from '@/utils/events';
import { usePanelActions } from '@/hooks/usePanelActions';
import { SlideOverBackdrop } from '@/components/ui/SlideOverBackdrop';
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

  // Return tab leads with operator info ("who packed / tested / with what
  // serials") and is the default once the order is packed.
  const hasReturnContent =
    !!initialShipped.packed_at &&
    initialShipped.packed_at !== '1' &&
    !isFulfillmentPanel &&
    !isLabelsPanel &&
    !isStagedPanel;

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
    shipByDate,
    setShipByDate,
    isSavingInlineFields,
    isSavingShipByDate,
    saveInlineFields,
    saveShipByDate,
  } = useShippedDetailState(initialShipped, onUpdate);

  const meta = deriveShippedHeaderMeta(shipped);

  const {
    activeSection,
    setActiveSection,
    activeInput,
    setActiveInput,
    isMarkAsShippedOpen,
    setIsMarkAsShippedOpen,
  } = useShippedPanelViewState({ initialShipped, hasReturnContent });

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
      status: () => setIsMarkAsShippedOpen((prev) => !prev),
      out_of_stock: () => setActiveInput((prev) => (prev === 'out_of_stock' ? 'none' : 'out_of_stock')),
      notes: () => setActiveInput((prev) => (prev === 'notes' ? 'none' : 'notes')),
    },
  );

  // Compose the action list directly (assign + entity actions) for the flat,
  // full-width bar in PaneHeader.belowSlot — bypassing the rounded-card adapter.
  const headerBarActions: PaneHeaderActionBarAction[] = [
    ...(meta.canEditAssignment
      ? [{
          key: 'assign',
          label: 'Assign',
          icon: <Settings className="h-3.5 w-3.5" />,
          onClick: openAssignmentCard,
          title: 'Open assignment',
        }]
      : []),
    ...(showDashboardExtras
      ? panelActions.map((a) => ({
          key: a.key,
          label: a.label,
          icon: <span className={a.toneClassName}>{a.icon}</span>,
          onClick: a.onAction,
        }))
      : []),
  ];

  const stackActionBar = {
    onClose,
    onMoveUp: () => dispatchNavigateShippedDetails('up'),
    onMoveDown: () => dispatchNavigateShippedDetails('down'),
    onAssign: meta.canEditAssignment ? openAssignmentCard : undefined,
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
        <ShippedDetailsHeader
          orderIdDisplay={meta.orderIdDisplay}
          showExceptionsFallback={meta.showExceptionsFallback}
          copiedOrderId={copiedOrderId}
          onCopyOrderId={handleCopyOrderId}
          onClose={onClose}
          quantity={(shipped as any).quantity}
          showStatusPill={Boolean((meta.hasTechScan && meta.testedById) || meta.hasOutOfStock)}
          statusTone={meta.statusTone}
          statusLabel={meta.statusLabel}
          actions={headerBarActions}
          onMoveUp={stackActionBar.onMoveUp}
          onMoveDown={stackActionBar.onMoveDown}
          hasReturnContent={hasReturnContent}
          showCustomerTab={showDashboardExtras}
          activeSection={activeSection}
          onSectionChange={setActiveSection}
        />

        <ShippedDetailsBody
          context={context}
          isFulfillmentPanel={isFulfillmentPanel}
          isLabelsPanel={isLabelsPanel}
          activeSection={activeSection}
          shipped={shipped}
          durationData={durationData}
          copiedAll={copiedAll}
          onCopyAll={handleCopyAll}
          onUpdate={onUpdate}
          activeInput={activeInput}
          setActiveInput={setActiveInput}
          isMarkAsShippedOpen={isMarkAsShippedOpen}
          setIsMarkAsShippedOpen={setIsMarkAsShippedOpen}
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
      </motion.div>
    </>
  );
}
