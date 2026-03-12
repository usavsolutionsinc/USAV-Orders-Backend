'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Package, Wrench } from '../Icons';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { PhotoGallery } from './PhotoGallery';
import { getStaffName } from '@/utils/staff';
import { getTrackingUrl, getAccountSourceLabel } from '@/utils/order-links';
import { useExternalItemUrl } from '@/hooks/useExternalItemUrl';
import { formatDateTimePST } from '@/utils/date';
import { useOrderAssignment } from '@/hooks';
import { CopyableValueFieldBlock } from '@/components/shipped/details-panel/blocks/CopyableValueFieldBlock';
import { OrderIdFieldBlock } from '@/components/shipped/details-panel/blocks/OrderIdFieldBlock';
import { SerialNumberFieldBlock } from '@/components/shipped/details-panel/blocks/SerialNumberFieldBlock';
import { ViewDropdown } from '@/components/ui/ViewDropdown';

interface DurationData {
  boxingDuration?: string;
  testingDuration?: string;
}

interface ShippedDetailsPanelContentProps {
  shipped: ShippedOrder;
  durationData: DurationData;
  copiedAll: boolean;
  onCopyAll: () => void;
  onUpdate?: () => void;
  showPackingPhotos?: boolean;
  showPackingInformation?: boolean;
  showTestingInformation?: boolean;
  showShippingTimestamp?: boolean;
  showSerialNumber?: boolean;
  productDetailsFirst?: boolean;
}

type ConditionValue = 'NEW' | 'USED' | 'PARTS';

const CONDITION_OPTIONS: Array<{ value: ConditionValue; label: string }> = [
  { value: 'NEW', label: 'NEW' },
  { value: 'USED', label: 'USED' },
  { value: 'PARTS', label: 'PARTS' },
];

function normalizeCondition(value: string | null | undefined): ConditionValue {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'NEW') return 'NEW';
  if (normalized === 'PARTS' || normalized === 'PARTS USED') return 'PARTS';
  if (normalized === 'USED') return 'USED';
  return 'USED';
}

export function ShippedDetailsPanelContent({
  shipped,
  durationData,
  copiedAll,
  onCopyAll,
  onUpdate,
  showPackingPhotos = true,
  showPackingInformation = true,
  showTestingInformation = true,
  showShippingTimestamp = false,
  showSerialNumber = true,
  productDetailsFirst = false
}: ShippedDetailsPanelContentProps) {
  const [conditionValue, setConditionValue] = useState<ConditionValue>(normalizeCondition(shipped.condition));
  const [isSavingCondition, setIsSavingCondition] = useState(false);
  const orderAssignmentMutation = useOrderAssignment();

  useEffect(() => {
    setConditionValue(normalizeCondition(shipped.condition));
  }, [shipped.id, shipped.condition]);

  const handleConditionChange = async (nextCondition: ConditionValue) => {
    if (isSavingCondition) return;
    setConditionValue(nextCondition);
    setIsSavingCondition(true);
    try {
      await orderAssignmentMutation.mutateAsync({
        orderId: shipped.id,
        condition: nextCondition,
      });
    } catch (error) {
      console.error('Failed to update condition:', error);
    } finally {
      setIsSavingCondition(false);
    }
  };

  const accountSourceLabel = getAccountSourceLabel(shipped.order_id, shipped.account_source);
  const { getExternalUrlByItemNumber, openExternalByItemNumber } = useExternalItemUrl();

  const productDetailsSection = (
    <section className="space-y-6">
      <div className="space-y-4 bg-gray-50/50 rounded-[2rem] p-6 border border-gray-100">
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] text-gray-400 font-black uppercase tracking-widest block">Product Title</span>
            <button
              type="button"
              onClick={() => openExternalByItemNumber(shipped.item_number)}
              disabled={!getExternalUrlByItemNumber(shipped.item_number)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 border border-blue-100 text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-[9px] font-black uppercase tracking-[0.14em] shrink-0"
            >
              <ExternalLink className="w-3 h-3" />
              Product Page
            </button>
          </div>
          <p className="font-bold text-sm text-gray-900 leading-relaxed break-words whitespace-normal" title={shipped.product_title}>
            {shipped.product_title || 'Not provided'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-100">
          <div>
            <span className="text-[10px] text-gray-400 font-black uppercase tracking-widest block mb-1">Condition</span>
            <div className="relative">
              <ViewDropdown
                options={CONDITION_OPTIONS}
                value={conditionValue}
                onChange={handleConditionChange}
                className="w-full"
                buttonClassName="h-8 w-full rounded-lg border border-gray-200 bg-white px-2.5 pr-8 text-left text-xs font-bold uppercase tracking-wide text-gray-900 outline-none transition-colors hover:bg-gray-50"
                optionClassName="text-xs font-bold tracking-wide text-gray-800"
              />
              {isSavingCondition && (
                <span className="absolute -bottom-4 left-0 text-[9px] font-bold text-gray-400 normal-case tracking-normal">
                  Saving...
                </span>
              )}
            </div>
          </div>
          <div>
            <span className="text-[10px] text-gray-400 font-black uppercase tracking-widest block mb-1">SKU</span>
            <p className="font-mono text-xs text-gray-900 font-bold">{shipped.sku || 'N/A'}</p>
          </div>
        </div>
      </div>
    </section>
  );

  return (
    <div className="px-8 pb-8 pt-4 space-y-10">
      {showPackingPhotos && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">Packing Photos</h3>
            </div>
          </div>

          <PhotoGallery photos={shipped.packer_photos_url || []} orderId={shipped.order_id} />
        </section>
      )}

      {productDetailsFirst && productDetailsSection}

      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
              <Package className="w-4 h-4" />
            </div>
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">Shipping Information</h3>
          </div>
          <button
            onClick={onCopyAll}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all hover:shadow-md active:scale-95"
            aria-label="Copy all shipping information"
          >
            {copiedAll ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span className="text-[10px] font-black uppercase tracking-wider">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span className="text-[10px] font-black uppercase tracking-wider">Copy</span>
              </>
            )}
          </button>
        </div>

        <div className="space-y-4">
          <CopyableValueFieldBlock
            label="Tracking Number"
            value={shipped.shipping_tracking_number || 'Not available'}
            externalUrl={getTrackingUrl(shipped.shipping_tracking_number || '')}
            externalLabel="Open shipment tracking in new tab"
          />

          <OrderIdFieldBlock orderId={shipped.order_id} accountSourceLabel={accountSourceLabel} />

          {showSerialNumber && (
            <SerialNumberFieldBlock
              rowId={shipped.id}
              trackingNumber={shipped.shipping_tracking_number}
              serialNumber={shipped.serial_number}
              techId={shipped.tested_by ?? shipped.tester_id ?? null}
              onUpdate={onUpdate}
            />
          )}

          {showShippingTimestamp && (
            <div>
              <span className="text-[10px] text-gray-400 font-black uppercase tracking-widest block mb-1.5">Shipped Date & Time</span>
              <p className="text-sm font-bold text-gray-900 bg-gray-50 px-4 py-2.5 rounded-xl border border-gray-100">
                {shipped.pack_date_time && shipped.pack_date_time !== '1'
                  ? formatDateTimePST(shipped.pack_date_time)
                  : 'N/A'}
              </p>
            </div>
          )}
        </div>
      </section>

      {!productDetailsFirst && productDetailsSection}

      {showPackingInformation && (
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-50 rounded-lg text-orange-600">
              <Package className="w-4 h-4" />
            </div>
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">Packing Information</h3>
          </div>

          <div className="space-y-4 bg-orange-50/30 rounded-[2rem] p-6 border border-orange-100">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] text-orange-600/60 font-black uppercase tracking-widest block mb-1">Packed By</span>
                <p className="font-black text-sm text-gray-900">{getStaffName(shipped.packed_by)}</p>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-orange-600/60 font-black uppercase tracking-widest block mb-1">Duration</span>
                <p className="font-mono text-sm font-black text-orange-600">{durationData.boxingDuration || '--:--'}</p>
              </div>
            </div>
            <div className="pt-4 border-t border-orange-100/50">
              <span className="text-[10px] text-orange-600/60 font-black uppercase tracking-widest block mb-1">Timestamp</span>
              <p className="text-xs font-bold text-gray-600">
                {shipped.pack_date_time && shipped.pack_date_time !== '1'
                  ? formatDateTimePST(shipped.pack_date_time)
                  : 'N/A'}
              </p>
            </div>
          </div>
        </section>
      )}

      {showTestingInformation && (
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-50 rounded-lg text-purple-600">
              <Wrench className="w-4 h-4" />
            </div>
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">Testing Information</h3>
          </div>

          <div className="space-y-4 bg-purple-50/30 rounded-[2rem] p-6 border border-purple-100">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] text-purple-600/60 font-black uppercase tracking-widest block mb-1">Tested By</span>
                <p className="font-black text-sm text-gray-900">{getStaffName(shipped.tested_by)}</p>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-purple-600/60 font-black uppercase tracking-widest block mb-1">Duration</span>
                <p className="font-mono text-sm font-black text-purple-600">{durationData.testingDuration || '--:--'}</p>
              </div>
            </div>
            <div className="pt-4 border-t border-purple-100/50">
              <span className="text-[10px] text-purple-600/60 font-black uppercase tracking-widest block mb-1">Timestamp</span>
              <p className="text-xs font-bold text-gray-600">
                {shipped.test_date_time && shipped.test_date_time !== ''
                  ? formatDateTimePST(shipped.test_date_time)
                  : 'N/A'}
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
