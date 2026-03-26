'use client';

import { useEffect, useState } from 'react';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { PhotoGallery } from './PhotoGallery';
import { getStaffName } from '@/utils/staff';
import { ShippingInformationSection, type EditableShippingFields, type PrepackedSkuInfo } from '@/components/shipped/details-panel/ShippingInformationSection';
import { ProductDetailsSection } from '@/components/shipped/details-panel/ProductDetailsSection';

interface DurationData {
  boxingDuration?: string;
  testingDuration?: string;
}

function formatElapsedDuration(startAt: string | null | undefined, endAt: string | null | undefined): string {
  if (!startAt || !endAt) return '';

  const startMs = new Date(startAt).getTime();
  const endMs = new Date(endAt).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return '';

  const totalSeconds = Math.floor((endMs - startMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
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
  editableShippingFields?: EditableShippingFields;
  showReturnInformation?: boolean;
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
  productDetailsFirst = false,
  editableShippingFields,
  showReturnInformation = true,
}: ShippedDetailsPanelContentProps) {
  const [prepackedSku, setPrepackedSku] = useState<PrepackedSkuInfo | null>(null);

  useEffect(() => {
    const tracking = String(shipped.shipping_tracking_number || '').trim();
    if (!tracking) return;

    let cancelled = false;
    fetch(`/api/sku/by-tracking?tracking=${encodeURIComponent(tracking)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data?.found || !data?.sku) return;
        setPrepackedSku({
          staticSku: String(data.sku.static_sku || ''),
          productTitle: data.sku.product_title ?? null,
          photos: Array.isArray(data.sku.photos) ? data.sku.photos : [],
        });
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [shipped.shipping_tracking_number]);

  const productDetailsSection = <ProductDetailsSection shipped={shipped} />;
  const packedById = shipped.packed_by ?? null;
  const testedById = shipped.tested_by ?? null;
  const derivedPackingDuration = String(shipped.pack_duration || '').trim()
    || (formatElapsedDuration(
      shipped.pack_activity_at || shipped.packed_at || null,
      shipped.next_pack_activity_at || null,
    ));
  const derivedTestingDuration = String(shipped.test_duration || '').trim()
    || (formatElapsedDuration(
      shipped.test_activity_at || shipped.test_date_time || null,
      shipped.next_test_activity_at || null,
    ));
  const packingMetaValue = String(durationData.boxingDuration || '').trim()
    || derivedPackingDuration
    || '--:--';
  const testingMetaValue = String(durationData.testingDuration || '').trim()
    || derivedTestingDuration
    || '--:--';
  const packedByName = packedById ? getStaffName(packedById) : '';
  const testedByName = testedById ? getStaffName(testedById) : '';

  return (
    <div className="px-8 pb-8 pt-0.5 space-y-10">
      {showPackingPhotos && (
        <>
          {prepackedSku && Array.isArray(prepackedSku.photos) && prepackedSku.photos.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">SKU Integrity Photos</h3>
                    <p className="text-[10px] font-bold text-indigo-600 mt-0.5">{prepackedSku.staticSku}</p>
                  </div>
                </div>
              </div>
              <PhotoGallery photos={prepackedSku.photos} orderId={prepackedSku.staticSku} />
            </section>
          )}

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
        </>
      )}

      {productDetailsFirst && productDetailsSection}

      <ShippingInformationSection
        shipped={shipped}
        copiedAll={copiedAll}
        onCopyAll={onCopyAll}
        onUpdate={onUpdate}
        showShippingTimestamp={showShippingTimestamp}
        showSerialNumber={showSerialNumber}
        showReturnInformation={showReturnInformation}
        editableShippingFields={editableShippingFields}
        prepackedSku={prepackedSku}
        metaFields={
          packedByName || testedByName
            ? {
                packedByName,
                packingDuration: packingMetaValue,
                testedByName,
                testingDuration: testingMetaValue,
              }
            : undefined
        }
      />

      {!productDetailsFirst && productDetailsSection}
    </div>
  );
}
