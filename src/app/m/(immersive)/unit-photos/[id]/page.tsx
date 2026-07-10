'use client';

import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { MobileUnitPhotoStudio } from '@/components/mobile/photos/MobileUnitPhotoStudio';

/**
 * Immersive (fullscreen) SERIAL_UNIT testing-photo capture surface — the phone
 * lands here from the packer testing-label scan (`unit_photo_request`). The
 * `[id]` segment is the numeric serial_units.id the desktop resolved.
 *
 * Lives at `/m/unit-photos/[id]` (NOT `/m/u/[id]/photos`) because `/m/u/[id]`
 * is owned by the (shell) unit-detail route — two route groups can't both own
 * the `u/[id]` segment. This keeps the camera in the (immersive) group,
 * matching the receiving capture UX.
 * See docs/todo/packer-testing-photo-scan-timeline-plan.md.
 */
function UnitPhotoPageInner() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const serialUnitId = Number(params?.id);
  const requestId = (searchParams.get('requestId') || '').trim() || null;
  const unitKey = (searchParams.get('unit') || '').trim() || null;
  const titleParam = (searchParams.get('title') || '').trim();
  const backParam = (searchParams.get('back') || '').trim();

  const validId = Number.isFinite(serialUnitId) && serialUnitId > 0;
  const headerLabel = titleParam || (unitKey ? `Unit ${unitKey}` : `Unit #${serialUnitId}`);
  const backHref = backParam || '/m/scan';

  if (!validId) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center px-6 text-center">
        <p className="text-sm font-bold text-white/70">Invalid unit id</p>
      </div>
    );
  }

  return (
    <MobileUnitPhotoStudio
      serialUnitId={serialUnitId}
      unitKey={unitKey}
      headerLabel={headerLabel}
      returnHref={backHref}
      requestId={requestId}
      maxPhotos={10}
    />
  );
}

export default function UnitPhotosPage() {
  return (
    <Suspense fallback={<div className="min-h-[100dvh] bg-stage" />}>
      <UnitPhotoPageInner />
    </Suspense>
  );
}
