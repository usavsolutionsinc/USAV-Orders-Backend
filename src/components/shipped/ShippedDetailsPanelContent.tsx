'use client';

import { useEffect, useState } from 'react';
import { Camera, ShieldCheck } from '@/components/Icons';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { PhotoGallery } from './PhotoGallery';
import { ShippingInformationSection, type EditableShippingFields, type PrepackedSkuInfo } from '@/components/shipped/details-panel/ShippingInformationSection';
import { ProductDetailsSection } from '@/components/shipped/details-panel/ProductDetailsSection';

interface DurationData {
  boxingDuration?: string;
  testingDuration?: string;
}

import type { ShippedActiveSection } from './stacks/types';
export type { ShippedActiveSection };

interface ShippedDetailsPanelContentProps {
  shipped: ShippedOrder;
  durationData: DurationData;
  copiedAll: boolean;
  onCopyAll: () => void;
  onUpdate?: () => void;
  showPackingPhotos?: boolean;
  showShippingTimestamp?: boolean;
  showSerialNumber?: boolean;
  productDetailsFirst?: boolean;
  editableShippingFields?: EditableShippingFields;
  /** When set, gates section rendering to just the active tab. Undefined = render all (legacy single-scroll view). */
  activeSection?: ShippedActiveSection;
}

export function ShippedDetailsPanelContent({
  shipped,
  durationData: _durationData,
  copiedAll,
  onCopyAll,
  onUpdate,
  showPackingPhotos = true,
  showShippingTimestamp = false,
  showSerialNumber = true,
  productDetailsFirst = false,
  editableShippingFields,
  activeSection,
}: ShippedDetailsPanelContentProps) {
  // Tab-gated rendering: when activeSection is set, only the matching section
  // shows. When undefined (legacy callers), everything renders in one scroll.
  const showShipping = activeSection ? activeSection === 'shipping' : true;
  const showProduct = activeSection ? activeSection === 'product' : true;
  const photosVisible = showShipping;
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

  const productDetailsSection = (
    <ProductDetailsSection shipped={shipped} editableShippingFields={editableShippingFields} />
  );

  return (
    <div className="px-8 pb-8 pt-0 space-y-6">
      {showPackingPhotos && photosVisible && (
        <>
          {prepackedSku && Array.isArray(prepackedSku.photos) && prepackedSku.photos.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5 text-text-muted" />
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-text-default">SKU Integrity Photos</h3>
                <span className="text-micro font-bold text-text-faint">· {prepackedSku.staticSku}</span>
              </div>
              <PhotoGallery
                photos={prepackedSku.photos}
                orderId={prepackedSku.staticSku}
                onPhotoDeleted={(photoId) =>
                  setPrepackedSku((prev) =>
                    prev
                      ? {
                          ...prev,
                          photos: (prev.photos ?? []).filter((p) => p.id !== photoId),
                        }
                      : prev,
                  )
                }
              />
            </section>
          )}

          <section>
            <div className="mb-3 flex items-center gap-2">
              <Camera className="h-3.5 w-3.5 text-text-muted" />
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-text-default">Packing Photos</h3>
            </div>
            <PhotoGallery
              photos={shipped.packer_photos_url || []}
              orderId={shipped.order_id}
              onPhotoDeleted={() => {
                onUpdate?.();
              }}
            />
          </section>
        </>
      )}

      {productDetailsFirst && showProduct && productDetailsSection}

      {showShipping ? (
        <ShippingInformationSection
          shipped={shipped}
          copiedAll={copiedAll}
          onCopyAll={onCopyAll}
          onUpdate={onUpdate}
          showShippingTimestamp={showShippingTimestamp}
          showSerialNumber={showSerialNumber}
          editableShippingFields={editableShippingFields}
          prepackedSku={prepackedSku}
        />
      ) : null}

      {!productDetailsFirst && showProduct && productDetailsSection}
    </div>
  );
}
