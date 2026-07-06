'use client';

import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { MobilePackerPhotoStudio } from '@/components/mobile/photos/MobilePackerPhotoStudio';

function PhotoPageInner() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const packerLogId = Number(params?.id);
  const orderId = searchParams.get('orderId') || `PL-${packerLogId}`;

  const validPackerLogId = Number.isFinite(packerLogId) && packerLogId > 0;
  if (!validPackerLogId) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center px-6 text-center">
        <p className="text-sm font-bold text-white/70">Invalid packer log id</p>
      </div>
    );
  }

  const headerLabel = orderId.startsWith('PL-') ? `Pack ${orderId}` : `Order ${orderId}`;

  return (
    <MobilePackerPhotoStudio
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
    <Suspense fallback={<div className="min-h-[100dvh] bg-stage" />}>
      <PhotoPageInner />
    </Suspense>
  );
}
