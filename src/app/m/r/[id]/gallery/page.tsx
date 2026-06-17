'use client';

import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { PhotoGalleryView } from '@/components/mobile/receiving/PhotoGalleryView';

function GalleryPageInner() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const receivingId = Number(params?.id);
  const titleParam = (searchParams.get('title') || '').trim();
  const poRefParam = (searchParams.get('poRef') || '').trim();
  const backParam = (searchParams.get('back') || '').trim();

  const validReceivingId = Number.isFinite(receivingId) && receivingId > 0;
  const headerLabel = titleParam || `RCV-${receivingId}`;
  const backHref = backParam || '/m/receiving';

  const captureParams = new URLSearchParams();
  if (titleParam) captureParams.set('title', titleParam);
  if (poRefParam) captureParams.set('poRef', poRefParam);
  const captureQs = captureParams.toString();
  const captureHref = validReceivingId
    ? `/m/r/${receivingId}/photos${captureQs ? `?${captureQs}` : ''}`
    : '/m/receiving';

  if (!validReceivingId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black px-6 text-center">
        <p className="text-sm font-bold text-white/70">Invalid receiving id</p>
      </div>
    );
  }

  return (
    <PhotoGalleryView
      title="Unboxing photos"
      subtitle={headerLabel}
      backHref={backHref}
      scope={{ receivingId, receivingLineId: null, poRef: poRefParam || null }}
      captureHref={captureHref}
    />
  );
}

export default function ReceivingGalleryPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <GalleryPageInner />
    </Suspense>
  );
}
