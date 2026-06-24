'use client';

import { Trash2 } from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { DashboardDetailsStack } from '@/components/shipped/stacks/DashboardDetailsStack';
import { TechDetailsStack } from '@/components/shipped/stacks/TechDetailsStack';
import { PackerDetailsStack } from '@/components/shipped/stacks/PackerDetailsStack';
import type { DetailsStackDurationData, ShippedActiveInput } from '@/components/shipped/stacks/types';
import { ShippedDetailsPanelContent, type ShippedActiveSection } from '@/components/shipped/ShippedDetailsPanelContent';
import { OrderTimelineSection } from '@/components/shipped/OrderTimelineSection';
import { OrderLabelsSection } from '@/components/shipped/OrderLabelsSection';
import { ShippedNotesComposer } from './ShippedNotesComposer';
import { DeleteOrderControl } from '@/components/shipped/stacks/DeleteOrderControl';

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
  activeSection: ShippedActiveSection;
  shipped: ShippedOrder;
  durationData: DetailsStackDurationData;
  copiedAll: boolean;
  onCopyAll: () => void;
  onUpdate: () => void;
  // Dashboard stack — lifted inline editors:
  activeInput: ShippedActiveInput;
  setActiveInput: React.Dispatch<React.SetStateAction<ShippedActiveInput>>;
  isMarkAsShippedOpen: boolean;
  setIsMarkAsShippedOpen: React.Dispatch<React.SetStateAction<boolean>>;
  // Tech / packer stacks:
  stackActionBar: ShippedStackActionBar;
  // Default content — inline-editable shipping fields:
  editableFields: ShippedEditableFields;
  notes: string;
  setNotes: (value: string) => void;
  isSavingNotes: boolean;
  onSaveNotes: () => void;
  // Delete (shipped context only):
  isDeleteArmed: boolean;
  isDeletingOrder: boolean;
  onDeleteOrder: () => void;
}

/**
 * The scrollable body of the shipped details panel. Routes to the timeline, the
 * dashboard / tech / packer stacks, or the default editable content, and
 * appends the shipped-context delete button and the labels drop-zone.
 */
export function ShippedDetailsBody({
  context,
  isFulfillmentPanel,
  isLabelsPanel,
  activeSection,
  shipped,
  durationData,
  copiedAll,
  onCopyAll,
  onUpdate,
  activeInput,
  setActiveInput,
  isMarkAsShippedOpen,
  setIsMarkAsShippedOpen,
  stackActionBar,
  editableFields,
  notes,
  setNotes,
  isSavingNotes,
  onSaveNotes,
  isDeleteArmed,
  isDeletingOrder,
  onDeleteOrder,
}: ShippedDetailsBodyProps) {
  const hasSavedNotes = String(shipped.notes || '').trim().length > 0;
  const showDashboardDelete = context === 'dashboard' || isFulfillmentPanel || isLabelsPanel;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto no-scrollbar">
      {activeSection === 'timeline' && shipped?.id ? (
        // Timeline tab — swaps the stack body to the order activity trail
        // (label → tech verdict → packed → scanned out), same pattern as the
        // Customer tab. Only reachable in contexts where the tab is shown.
        <div className="flex min-h-full flex-col pb-8 pt-2">
          <div className="flex-1 pt-2">
            <OrderTimelineSection orderId={Number(shipped.id)} />
          </div>
          {(activeInput === 'notes' || hasSavedNotes) && (
            activeInput === 'notes' ? (
              <ShippedNotesComposer
                value={notes}
                onChange={setNotes}
                onCancel={() => {
                  setNotes(shipped.notes || '');
                  setActiveInput('none');
                }}
                onSubmit={onSaveNotes}
                isSaving={isSavingNotes}
              />
            ) : (
              <ShippedNotesComposer
                value={String(shipped.notes || '')}
                readOnly
                onClick={() => setActiveInput('notes')}
              />
            )
          )}
          {showDashboardDelete ? (
            <section className="mx-8 pt-2 space-y-2">
              <DeleteOrderControl
                orderId={shipped.id}
                packerLogId={(shipped as any).packer_log_id ?? null}
                stationActivityLogId={(shipped as any).station_activity_log_id ?? (shipped as any).sal_id ?? null}
                trackingType={shipped.tracking_type}
                onDeleted={() => onUpdate?.()}
              />
            </section>
          ) : context === 'shipped' ? (
            <section className="mx-8 pt-2">
              <button
                type="button"
                onClick={onDeleteOrder}
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
          ) : null}
        </div>
      ) : context === 'dashboard' || isFulfillmentPanel || isLabelsPanel ? (
        <DashboardDetailsStack
          shipped={shipped}
          durationData={durationData}
          copiedAll={copiedAll}
          onCopyAll={onCopyAll}
          onUpdate={onUpdate}
          showShippingTimestamp={false}
          showReturnInformation={!isFulfillmentPanel && !isLabelsPanel}
          activeSection={activeSection}
          activeInput={activeInput}
          setActiveInput={setActiveInput}
          isMarkAsShippedOpen={isMarkAsShippedOpen}
          setIsMarkAsShippedOpen={setIsMarkAsShippedOpen}
          notes={notes}
          setNotes={setNotes}
          isSavingNotes={isSavingNotes}
          onSaveNotes={onSaveNotes}
        />
      ) : context === 'station' ? (
        <TechDetailsStack
          shipped={shipped}
          durationData={durationData}
          copiedAll={copiedAll}
          onCopyAll={onCopyAll}
          onUpdate={onUpdate}
          showShippingTimestamp={false}
          actionBar={stackActionBar}
          activeSection={activeSection}
          activeInput={activeInput}
          setActiveInput={setActiveInput}
          notes={notes}
          setNotes={setNotes}
          isSavingNotes={isSavingNotes}
          onSaveNotes={onSaveNotes}
        />
      ) : context === 'packer' ? (
        <PackerDetailsStack
          shipped={shipped}
          durationData={durationData}
          copiedAll={copiedAll}
          onCopyAll={onCopyAll}
          onUpdate={onUpdate}
          showShippingTimestamp={false}
          actionBar={stackActionBar}
          activeSection={activeSection}
          activeInput={activeInput}
          setActiveInput={setActiveInput}
          notes={notes}
          setNotes={setNotes}
          isSavingNotes={isSavingNotes}
          onSaveNotes={onSaveNotes}
        />
      ) : (
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
          {(activeInput === 'notes' || hasSavedNotes) && (
            activeInput === 'notes' ? (
              <ShippedNotesComposer
                value={notes}
                onChange={setNotes}
                onCancel={() => {
                  setNotes(shipped.notes || '');
                  setActiveInput('none');
                }}
                onSubmit={onSaveNotes}
                isSaving={isSavingNotes}
              />
            ) : (
              <ShippedNotesComposer
                value={String(shipped.notes || '')}
                readOnly
                onClick={() => setActiveInput('notes')}
              />
            )
          )}

          {context === 'shipped' && (
            <section className="mx-8 pt-2">
              <button
                type="button"
                onClick={onDeleteOrder}
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

      {/* Shipping-label drop-zone is UNSHIPPED-only (`queue`): a shipped order
          has already left with its label printed, so the shipped/dashboard
          stacks don't repeat it (the label still lives under its own tab). */}
      {isLabelsPanel && shipped?.id && activeSection !== 'timeline' ? (
        <OrderLabelsSection orderId={Number(shipped.id)} orderRef={shipped.order_id || `order-${shipped.id}`} />
      ) : null}
    </div>
  );
}
