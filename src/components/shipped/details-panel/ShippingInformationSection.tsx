'use client';

import { ShippedOrder } from '@/lib/neon/orders-queries';
import { getAccountSourceLabel, getOrderIdUrl } from '@/utils/order-links';
import { ShipmentStatusBadge } from '@/components/shipping/ShipmentStatusBadge';
import { formatDateTimePST, getDaysLateNumber } from '@/utils/date';
import { getStaffName } from '@/utils/staff';
import { Pencil } from '@/components/Icons';
import { DetailsPanelRow } from '@/design-system/components/DetailsPanelRow';
import { TrackingNumberRow } from '@/components/ui/TrackingNumberRow';

import { buildAllTrackingRows, serialNumberRowsFromShipped } from './shipping-information/helpers';
import { ShippingEditableRow } from './shipping-information/ShippingEditableRow';
import { ShippingSerialNumberRow } from './shipping-information/ShippingSerialNumberRow';
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
  copiedAll: _copiedAll,
  onCopyAll: _onCopyAll,
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

  const daysLate = getDaysLateNumber(shipped.ship_by_date || shipped.created_at || null);
  const daysLateClassName =
    daysLate > 1
      ? 'text-micro font-black uppercase tracking-wide text-red-600'
      : daysLate === 1
        ? 'text-micro font-black uppercase tracking-wide text-yellow-600'
        : 'text-micro font-black uppercase tracking-wide text-gray-500';
  const packedAtSource =
    (shipped.pack_activity_at && shipped.pack_activity_at !== '1' ? shipped.pack_activity_at : null)
    ?? (shipped.packed_at && shipped.packed_at !== '1' ? shipped.packed_at : null);
  const shippedAtDisplay = packedAtSource ? formatDateTimePST(packedAtSource) : 'N/A';
  const testedAtDateTimeDisplay = shipped.test_date_time
    ? formatDateTimePST(shipped.test_date_time)
    : 'N/A';
  // Packer from actual SAL/packer_logs scan data only — not from work_assignment packer_id
  const packerNameDisplay = String(
    (shipped as any).packed_by_name
    || (shipped as any).packer_name
    || getStaffName((shipped as any).packed_by ?? null)
  ).trim() || 'Not specified';
  const techNameDisplay = String(
    (shipped as any).tester_name
    || (shipped as any).tested_by_name
    || getStaffName((shipped as any).tested_by ?? (shipped as any).tester_id ?? null)
  ).trim() || 'Not specified';

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
          <div className="space-y-0">
            <DetailsPanelRow label="Packed">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-bold text-gray-900">{packerNameDisplay}</p>
                <p className="shrink-0 text-sm font-bold text-gray-900">{shippedAtDisplay}</p>
              </div>
            </DetailsPanelRow>
            <DetailsPanelRow label="Tested By">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-bold text-gray-900">{techNameDisplay}</p>
                <p className="shrink-0 text-sm font-bold text-gray-900">{testedAtDateTimeDisplay}</p>
              </div>
            </DetailsPanelRow>
            <DetailsPanelRow label="Serial Numbers" className="last:border-b-0">
              {serialNumberRows.length > 0 ? (
                <div className="divide-y divide-gray-100">
                  {serialNumberRows.map((serial, idx) => (
                    <p key={idx} className="truncate py-1 last:pb-0 font-mono text-sm font-bold text-gray-900">{serial}</p>
                  ))}
                </div>
              ) : (
                <p className="py-0.5 text-sm font-bold text-gray-400">N/A</p>
              )}
            </DetailsPanelRow>
          </div>
        </div>
      ) : null}

      {showShippingInformation ? (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">Edit Details</h3>
          <button
            type="button"
            onClick={modal.openEditModal}
            className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Edit shipping information"
            title="Edit shipping information"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="space-y-0">
          {showShippingTimestamp && (
            <DetailsPanelRow label="Shipped">
              <p className="text-sm font-bold text-gray-900">
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
                    <p className="truncate text-sm font-bold text-gray-900">{metaFields.packedByName}</p>
                    <p className="shrink-0 text-sm font-bold text-gray-900">{shippedAtDisplay}</p>
                  </div>
                </DetailsPanelRow>
              ) : null}
              {metaFields.testedByName ? (
                <DetailsPanelRow label="Tested By">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-bold text-gray-900">{metaFields.testedByName}</p>
                    <p className="shrink-0 text-sm font-bold text-gray-900">{testedAtDateTimeDisplay}</p>
                  </div>
                </DetailsPanelRow>
              ) : null}
            </>
          ) : null}

          {showSerialNumber ? (
            <ShippingSerialNumberRow
              rowId={shipped.id}
              trackingNumber={shipped.shipping_tracking_number}
              serialNumber={shipped.serial_number}
              techId={shipped.tested_by ?? shipped.tester_id ?? null}
              fnskuLogId={shipped.fnsku_log_id ?? null}
              salId={shipped.sal_id ?? null}
              onUpdate={onUpdate}
              allowEdit={false}
            />
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
