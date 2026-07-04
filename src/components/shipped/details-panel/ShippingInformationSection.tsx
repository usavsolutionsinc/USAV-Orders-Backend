'use client';

import { ShippedOrder } from '@/lib/neon/orders-queries';
import { getAccountSourceLabel, getOrderIdUrl } from '@/utils/order-links';
import { ShipmentStatusBadge } from '@/components/shipping/ShipmentStatusBadge';
import { formatDateTimePST } from '@/utils/date';
import { Pencil, Copy, Check } from '@/components/Icons';
import { DetailsPanelRow } from '@/design-system/components/DetailsPanelRow';
import { DateTimeValue } from '@/design-system/components/DateTimeValue';
import { CopyActionIcon } from '@/design-system/components/CopyActionIcon';
import { TrackingNumberRow } from '@/components/ui/TrackingNumberRow';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';

import { SerialNumbersRow } from './SerialNumbersRow';
import { buildAllTrackingRows, serialNumberRowsFromShipped, deriveShippingDisplayMeta } from './shipping-information/helpers';
import { ShippingEditableRow } from './shipping-information/ShippingEditableRow';
import { ShippingInfoEditModal } from './shipping-information/ShippingInfoEditModal';
import { PrepackedSkuRow } from './shipping-information/PrepackedSkuRow';
import { useEditableShippingFields } from './shipping-information/hooks/useEditableShippingFields';
import { useInlineTrackingDrafts } from './shipping-information/hooks/useInlineTrackingDrafts';
import { useShippingInfoEditModal } from './shipping-information/hooks/useShippingInfoEditModal';
import type {
  EditableShippingFields,
  PrepackedSkuInfo,
  ShippingMetaFields,
} from './shipping-information/types';

// Re-export the public API so existing consumers keep importing from this path.
export { ShippingEditableRow };
export type { EditableShippingFields, PrepackedSkuInfo };

interface ShippingInformationSectionProps {
  shipped: ShippedOrder;
  copiedAll?: boolean;
  onCopyAll?: () => void;
  onUpdate?: () => void;
  showSerialNumber?: boolean;
  showReturnInformation?: boolean;
  /** Toggle the Shipping Information block (header + rows). Default true. Used by ShippedDetailsPanel's tabs to render Return + Shipping independently. */
  showShippingInformation?: boolean;
  showShippingTimestamp?: boolean;
  editableShippingFields?: EditableShippingFields;
  metaFields?: ShippingMetaFields;
  prepackedSku?: PrepackedSkuInfo | null;
}

export function ShippingInformationSection({
  shipped,
  copiedAll,
  onCopyAll,
  onUpdate,
  showSerialNumber = true,
  showReturnInformation = true,
  showShippingInformation = true,
  showShippingTimestamp = false,
  editableShippingFields,
  metaFields,
  prepackedSku,
}: ShippingInformationSectionProps) {
  const accountSourceLabel = getAccountSourceLabel(shipped.order_id, shipped.account_source);

  const { ef, internalFieldSave } = useEditableShippingFields(shipped, editableShippingFields, onUpdate);

  const allTrackingRows = buildAllTrackingRows(shipped, editableShippingFields);
  const serialNumberRows = serialNumberRowsFromShipped(shipped);

  const { linkedTrackingDrafts, setLinkedTrackingDrafts, saveLinkedTracking } = useInlineTrackingDrafts(
    shipped,
    allTrackingRows,
    onUpdate,
  );

  const modal = useShippingInfoEditModal({
    shipped,
    ef,
    allTrackingRows,
    serialNumberRows,
    internalFieldSave,
    onUpdate,
    setLinkedTrackingDrafts,
  });

  const {
    daysLate,
    packedAtSource,
    isScannedOut,
    scannedOutByDisplay,
    packerNameDisplay,
    techNameDisplay,
    returnsCopyText,
  } = deriveShippingDisplayMeta(shipped, serialNumberRows);
  const daysLateClassName =
    daysLate > 1
      ? 'text-micro font-black uppercase tracking-wide text-red-600'
      : daysLate === 1
        ? 'text-micro font-black uppercase tracking-wide text-yellow-600'
        : 'text-micro font-black uppercase tracking-wide text-text-soft';

  return (
    <section className="space-y-6">
      <ShippingInfoEditModal
        open={modal.isOpen}
        draft={modal.draft}
        setDraft={modal.setDraft}
        isSaving={modal.isSaving}
        isSaveSuccess={modal.isSaveSuccess}
        error={modal.error}
        onClose={modal.requestClose}
        onSave={() => { void modal.handleModalSave(); }}
      />
      {showReturnInformation && shipped.packed_at && shipped.packed_at !== '1' ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-text-default">Return Info</h3>
            <CopyActionIcon
              value={returnsCopyText}
              ariaLabel="Copy all return details"
              title="Copy all return details"
            />
          </div>
          <div className="space-y-0">
            <ShippingEditableRow
              label="Order ID"
              value={shipped.order_id || ''}
              placeholder="N/A"
              onChange={() => {}}
              onBlur={() => {}}
              externalUrl={getOrderIdUrl(shipped.order_id || '')}
              headerAccessory={accountSourceLabel || undefined}
              headerAccessoryClassName="text-micro font-black tracking-wide text-blue-600"
              allowEdit={false}
            />
            <SerialNumbersRow serials={serialNumberRows} />
            <DetailsPanelRow label="Tested By">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-bold text-text-default">{techNameDisplay}</p>
                <DateTimeValue value={shipped.test_date_time} />
              </div>
            </DetailsPanelRow>
            <DetailsPanelRow label="Packed By">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-bold text-text-default">{packerNameDisplay}</p>
                <DateTimeValue value={packedAtSource} />
              </div>
            </DetailsPanelRow>
            <DetailsPanelRow label="Scanned Out">
              {isScannedOut ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-bold text-text-default">{scannedOutByDisplay}</p>
                  <DateTimeValue value={shipped.ship_confirmed_at} />
                </div>
              ) : (
                <p className="text-sm font-bold text-text-faint">N/A</p>
              )}
            </DetailsPanelRow>
          </div>
        </div>
      ) : null}

      {showShippingInformation ? (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-text-default">Edit Details</h3>
          <div className="flex items-center gap-1">
            {onCopyAll ? (
              <HoverTooltip label="Copy all shipped details" asChild>
                <IconButton
                  onClick={onCopyAll}
                  ariaLabel="Copy all shipped details"
                  icon={copiedAll ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  className={`flex h-6 w-6 items-center justify-center rounded-md hover:bg-surface-sunken ${
                    copiedAll ? 'text-emerald-600' : 'text-text-faint hover:text-text-muted'
                  }`}
                />
              </HoverTooltip>
            ) : null}
            <HoverTooltip label="Edit shipping information" asChild>
              <IconButton
                onClick={modal.openEditModal}
                ariaLabel="Edit shipping information"
                icon={<Pencil className="h-3.5 w-3.5" />}
                className="flex h-6 w-6 items-center justify-center rounded-md text-text-faint hover:bg-surface-sunken hover:text-text-muted"
              />
            </HoverTooltip>
          </div>
        </div>

        <div className="space-y-0">
          {showShippingTimestamp && (
            <DetailsPanelRow label="Shipped">
              <p className="text-sm font-bold text-text-default">
                {packedAtSource ? formatDateTimePST(packedAtSource) : 'N/A'}
              </p>
            </DetailsPanelRow>
          )}

          {(shipped.latest_status_category || shipped.has_exception) && shipped.shipment_id != null ? (
            <DetailsPanelRow label="Carrier Status">
              <ShipmentStatusBadge
                carrier={shipped.carrier ?? null}
                category={shipped.latest_status_category ?? null}
                description={shipped.latest_status_description ?? null}
                latestEventAt={shipped.latest_event_at ?? null}
                hasException={shipped.has_exception ?? null}
                isTerminal={shipped.is_terminal ?? null}
              />
            </DetailsPanelRow>
          ) : null}

          <ShippingEditableRow
            label="Ship By Date"
            headerAccessory={String(daysLate)}
            headerAccessoryClassName={daysLateClassName}
            value={ef.shipByDate}
            placeholder="MM-DD-YY"
            onChange={ef.onShipByDateChange}
            onBlur={ef.onShipByDateBlur}
            allowEdit={false}
          />
          {allTrackingRows.length > 0 ? allTrackingRows.map((row, index) => {
            const draftKey = `${row.shipmentId ?? 'none'}:${index}`;
            const draftValue = linkedTrackingDrafts[draftKey] ?? row.tracking;
            return (
              <TrackingNumberRow
                key={`tracking-${index}-${row.shipmentId ?? 'none'}`}
                label={`Tracking Number${allTrackingRows.length > 1 ? ` ${index + 1}` : ''}`}
                value={draftValue}
                placeholder="Enter tracking number"
                onPasteReplace={async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    const pasted = String(text || '').trim();
                    if (!pasted) return;
                    setLinkedTrackingDrafts((prev) => ({ ...prev, [draftKey]: pasted }));
                    if (index === 0) {
                      ef.onTrackingNumberChange(pasted);
                      await internalFieldSave.saveInlineFields(ef.orderNumber, ef.itemNumber, pasted);
                    } else {
                      await saveLinkedTracking(row.shipmentId, pasted);
                    }
                  } catch {}
                }}
              />
            );
          }) : (
            <TrackingNumberRow label="Tracking Number" value="" placeholder="No tracking number" />
          )}
          <ShippingEditableRow
            label="Order ID"
            value={ef.orderNumber}
            placeholder="Enter order ID"
            onChange={ef.onOrderNumberChange}
            onBlur={ef.onBlur}
            externalUrl={getOrderIdUrl(ef.orderNumber)}
            headerAccessory={accountSourceLabel || undefined}
            headerAccessoryClassName="text-micro font-black tracking-wide text-blue-600"
            allowEdit={false}
          />
          {/* Item Number moved to ProductDetailsSection — it's a product
              attribute, not a shipping field. */}

          {prepackedSku ? <PrepackedSkuRow sku={prepackedSku} /> : null}

          {metaFields ? (
            <>
              {metaFields.packedByName ? (
                <DetailsPanelRow label="Packed By">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-bold text-text-default">{metaFields.packedByName}</p>
                    <DateTimeValue value={packedAtSource} />
                  </div>
                </DetailsPanelRow>
              ) : null}
              {metaFields.testedByName ? (
                <DetailsPanelRow label="Tested By">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-bold text-text-default">{metaFields.testedByName}</p>
                    <DateTimeValue value={shipped.test_date_time} />
                  </div>
                </DetailsPanelRow>
              ) : null}
            </>
          ) : null}

          {showSerialNumber ? (
            <SerialNumbersRow serials={serialNumberRows} />
          ) : null}

          {ef.isSaving ? (
            <p className="pt-2 text-micro font-bold uppercase tracking-wide text-blue-600">Saving shipping updates...</p>
          ) : null}
          {ef.isSavingShipByDate ? (
            <p className="pt-1 text-micro font-bold uppercase tracking-wide text-blue-600">Saving ship by date...</p>
          ) : null}
        </div>
      </div>
      ) : null}
    </section>
  );
}
