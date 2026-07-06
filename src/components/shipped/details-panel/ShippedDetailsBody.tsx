'use client';

import { Trash2 } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { DashboardDetailsStack } from '@/components/shipped/stacks/DashboardDetailsStack';
import { TechDetailsStack } from '@/components/shipped/stacks/TechDetailsStack';
import { PackerDetailsStack } from '@/components/shipped/stacks/PackerDetailsStack';
import type { DetailsStackDurationData, ShippedActiveInput } from '@/components/shipped/stacks/types';
import { ShippedDetailsPanelContent, type ShippedActiveSection } from '@/components/shipped/ShippedDetailsPanelContent';
import { OrderTimelineSection } from '@/components/shipped/OrderTimelineSection';
import { SerialJourneySection } from '@/components/serial/SerialJourneySection';
import { OrderDocumentsSection } from '@/components/shipped/OrderDocumentsSection';
import { DeleteOrderControl } from '@/components/shipped/stacks/DeleteOrderControl';
import { ShippedPanelEditorDock } from '@/components/shipped/details-panel/ShippedPanelEditorDock';

export interface ShippedStackActionBar {
  onClose: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onAssign?: () => void;
}

export interface ShippedEditableFields {
  orderNumber: string;
  itemNumber: string;
  trackingNumber: string;
  shipByDate: string;
  isSavingInlineFields: boolean;
  isSavingShipByDate: boolean;
  setOrderNumber: (v: string) => void;
  setItemNumber: (v: string) => void;
  setTrackingNumber: (v: string) => void;
  setShipByDate: (v: string) => void;
  onSaveInline: () => void | Promise<void>;
  onSaveShipByDate: (shipByDate: string) => void | Promise<void>;
}

export interface ShippedDetailsBodyProps {
  context: NonNullable<'dashboard' | 'queue' | 'fulfillment' | 'labels' | 'staged' | 'shipped' | 'station' | 'packer'>;
  isFulfillmentPanel: boolean;
  isLabelsPanel: boolean;
  showDashboardExtras: boolean;
  activeSection: ShippedActiveSection;
  shipped: ShippedOrder;
  durationData: DetailsStackDurationData;
  copiedAll: boolean;
  onCopyAll: () => void;
  onUpdate: () => void;
  activeInput: ShippedActiveInput;
  setActiveInput: React.Dispatch<React.SetStateAction<ShippedActiveInput>>;
  stackActionBar: ShippedStackActionBar;
  editableFields: ShippedEditableFields;
  notes: string;
  setNotes: (value: string) => void;
  isSavingNotes: boolean;
  onSaveNotes: () => void;
  outOfStock: string;
  setOutOfStock: (value: string) => void;
  isSavingOutOfStock: boolean;
  onSaveOutOfStock: () => void | Promise<void>;
  onMarkShippedSuccess: () => void;
  isDeleteArmed: boolean;
  isDeletingOrder: boolean;
  onDeleteOrder: () => void;
}

/**
 * The scrollable body of the shipped details panel. Detail stacks render in the
 * upper scroll region; header-action editors live in {@link ShippedPanelEditorDock}.
 */
export function ShippedDetailsBody({
  context,
  isFulfillmentPanel,
  isLabelsPanel,
  showDashboardExtras,
  activeSection,
  shipped,
  durationData,
  copiedAll,
  onCopyAll,
  onUpdate,
  activeInput,
  setActiveInput,
  stackActionBar,
  editableFields,
  notes,
  setNotes,
  isSavingNotes,
  onSaveNotes,
  outOfStock,
  setOutOfStock,
  isSavingOutOfStock,
  onSaveOutOfStock,
  onMarkShippedSuccess,
  isDeleteArmed,
  isDeletingOrder,
  onDeleteOrder,
}: ShippedDetailsBodyProps) {
  const showDashboardDelete = context === 'dashboard' || isFulfillmentPanel || isLabelsPanel;
  const showEditorDock =
    showDashboardExtras
    || context === 'staged'
    || context === 'station'
    || context === 'packer'
    || context === 'shipped';

  const orderSerials = [
    ...new Set(
      String(shipped.serial_number || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];

  const scrollContent = (() => {
    if (activeSection === 'documents' && shipped?.id) {
      return (
        <div className="flex min-h-full flex-col pb-8 pt-4">
          <OrderDocumentsSection
            orderId={Number(shipped.id)}
            orderRef={shipped.order_id || `order-${shipped.id}`}
            readOnly={!isLabelsPanel}
          />
        </div>
      );
    }

    if (activeSection === 'timeline' && shipped?.id) {
      return (
        <div className="flex min-h-full flex-col pb-8 pt-2">
          <div className="flex-1 pt-2">
            <OrderTimelineSection orderId={Number(shipped.id)} />
            {orderSerials.map((sn) => (
              <SerialJourneySection
                key={sn}
                serialNumber={sn}
                title={orderSerials.length > 1 ? `Serial journey · ${sn}` : 'Serial journey'}
              />
            ))}
          </div>
        </div>
      );
    }

    if (context === 'dashboard' || isFulfillmentPanel || isLabelsPanel) {
      return (
        <DashboardDetailsStack
          shipped={shipped}
          durationData={durationData}
          copiedAll={copiedAll}
          onCopyAll={onCopyAll}
          onUpdate={onUpdate}
          showShippingTimestamp={false}
          activeSection={activeSection}
        />
      );
    }

    if (context === 'station') {
      return (
        <TechDetailsStack
          shipped={shipped}
          durationData={durationData}
          copiedAll={copiedAll}
          onCopyAll={onCopyAll}
          onUpdate={onUpdate}
          showShippingTimestamp={false}
          actionBar={stackActionBar}
          activeSection={activeSection}
        />
      );
    }

    if (context === 'packer') {
      return (
        <PackerDetailsStack
          shipped={shipped}
          durationData={durationData}
          copiedAll={copiedAll}
          onCopyAll={onCopyAll}
          onUpdate={onUpdate}
          showShippingTimestamp={false}
          actionBar={stackActionBar}
          activeSection={activeSection}
        />
      );
    }

    return (
      <div className="flex min-h-full flex-col pb-8 pt-4">
        <div className="flex-1 space-y-4">
          <ShippedDetailsPanelContent
            activeSection={activeSection}
            shipped={{
              ...shipped,
              order_id: editableFields.orderNumber,
              item_number: editableFields.itemNumber,
              shipping_tracking_number: editableFields.trackingNumber,
            }}
            durationData={durationData}
            copiedAll={copiedAll}
            onCopyAll={onCopyAll}
            onUpdate={onUpdate}
            editableShippingFields={{
              orderNumber: editableFields.orderNumber,
              itemNumber: editableFields.itemNumber,
              trackingNumber: editableFields.trackingNumber,
              shipByDate: editableFields.shipByDate,
              isSaving: editableFields.isSavingInlineFields,
              isSavingShipByDate: editableFields.isSavingShipByDate,
              onOrderNumberChange: editableFields.setOrderNumber,
              onItemNumberChange: editableFields.setItemNumber,
              onTrackingNumberChange: editableFields.setTrackingNumber,
              onShipByDateChange: editableFields.setShipByDate,
              onBlur: () => { void editableFields.onSaveInline(); },
              onShipByDateBlur: () => { void editableFields.onSaveShipByDate(editableFields.shipByDate); },
            }}
            showShippingTimestamp={false}
          />
        </div>
      </div>
    );
  })();

  const deleteFooter = showDashboardDelete ? (
    <section className="mx-8 shrink-0 pb-8 pt-2 space-y-2">
      <DeleteOrderControl
        orderId={shipped.id}
        packerLogId={(shipped as { packer_log_id?: number }).packer_log_id ?? null}
        stationActivityLogId={
          (shipped as { station_activity_log_id?: number }).station_activity_log_id
          ?? (shipped as { sal_id?: number }).sal_id
          ?? null
        }
        trackingType={shipped.tracking_type}
        onDeleted={() => onUpdate?.()}
      />
    </section>
  ) : context === 'shipped' ? (
    <section className="mx-8 shrink-0 pb-8 pt-2">
      <Button
        type="button"
        variant="danger"
        size="lg"
        onClick={onDeleteOrder}
        disabled={isDeletingOrder}
        icon={<Trash2 className="w-3.5 h-3.5" />}
        className={`w-full rounded-xl bg-red-600 hover:bg-red-700 ${sectionLabel} text-white tracking-wider disabled:opacity-50`}
      >
        {isDeletingOrder
          ? 'Deleting...'
          : isDeleteArmed
            ? 'Click Again To Confirm'
            : 'Delete'}
      </Button>
    </section>
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
        {scrollContent}
      </div>

      {showEditorDock ? (
        <ShippedPanelEditorDock
          shipped={shipped}
          activeInput={activeInput}
          setActiveInput={setActiveInput}
          showMarkAsShipped={showDashboardExtras}
          showOutOfStock={showDashboardExtras}
          showNotes
          notes={notes}
          setNotes={setNotes}
          isSavingNotes={isSavingNotes}
          onSaveNotes={onSaveNotes}
          outOfStock={outOfStock}
          setOutOfStock={setOutOfStock}
          isSavingOutOfStock={isSavingOutOfStock}
          onSaveOutOfStock={onSaveOutOfStock}
          shippingTrackingNumber={editableFields.trackingNumber}
          onMarkShippedSuccess={onMarkShippedSuccess}
        />
      ) : null}

      {deleteFooter}
    </div>
  );
}
