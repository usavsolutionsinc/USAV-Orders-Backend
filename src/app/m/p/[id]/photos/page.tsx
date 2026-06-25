'use client';

import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { PackerPhotoCaptureSurface } from '@/components/mobile/packer/PackerPhotoCaptureSurface';

function PhotoPageInner() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const packerLogId = Number(params?.id);
  // The Recent feed / sheet pass the real order number; fall back to the pack
  // log id so a photo is never filed under a blank reference.
  const orderId = searchParams.get('orderId') || `PL-${packerLogId}`;

  const validPackerLogId = Number.isFinite(packerLogId) && packerLogId > 0;
  if (!validPackerLogId) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6 text-center">
        <p className="text-sm font-bold text-slate-700">Invalid packer log id</p>
      </div>
    );
  }

  const headerLabel = orderId.startsWith('PL-') ? `Pack ${orderId}` : `Order ${orderId}`;

  return (
    <PackerPhotoCaptureSurface
      packerLogId={packerLogId}
      orderId={orderId}
      headerLabel={headerLabel}
      returnHref="/m/pack"
      maxPhotos={10}
    />
  );
}

export default function PackerPhotosPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <PhotoPageInner />
    </Suspense>
  );
}
