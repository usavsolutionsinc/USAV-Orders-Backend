'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { MobileReceivingPhotoStudio } from '@/components/mobile/photos/MobileReceivingPhotoStudio';

function PhotoPageInner() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const receivingId = Number(params?.id);
  const mode = searchParams.get('mode') === 'gallery' ? 'gallery' : 'capture';
  const requestId = (searchParams.get('requestId') || '').trim() || null;
  const titleParam = (searchParams.get('title') || '').trim();
  const poRefParam = (searchParams.get('poRef') || '').trim() || null;
  const backParam = (searchParams.get('back') || '').trim();
  const [resolved, setResolved] = useState<{ title: string; poRef: string | null } | null>(null);

  const validReceivingId = Number.isFinite(receivingId) && receivingId > 0;
  const headerLabel = titleParam || resolved?.title || `RCV-${receivingId}`;
  const poRef = poRefParam || resolved?.poRef || null;
  const backHref = backParam || '/m/receiving';

  useEffect(() => {
    if (titleParam || !validReceivingId) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/receiving-lines?receiving_id=${receivingId}&limit=1`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const body = await res.json();
        if (!alive) return;
        const line = body?.receiving_lines?.[0];
        if (line) {
          const title = String(
            line.item_name || line.catalog_product_title || line.sku || line.zoho_item_id || '',
          ).trim();
          const po =
            line.zoho_purchaseorder_number || line.receiving_zoho_purchaseorder_number || null;
          if (title) setResolved({ title, poRef: po });
        } else if (body?.receiving_package) {
          setResolved({ title: 'Unfound PO', poRef: null });
        }
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      alive = false;
    };
  }, [titleParam, receivingId, validReceivingId]);

  if (!validReceivingId) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center px-6 text-center">
        <p className="text-sm font-bold text-white/70">Invalid receiving id</p>
      </div>
    );
  }

  const scope = { receivingId, receivingLineId: null as number | null, poRef, photosListScope: 'all' as const };

  return (
    <MobileReceivingPhotoStudio
      mode={mode}
      scope={scope}
      headerLabel={headerLabel}
      galleryTitle="Unboxing photos"
      gallerySubtitle={headerLabel}
      backHref={backHref}
      returnHref={backHref}
      requestId={requestId}
      maxPhotos={10}
    />
  );
}

export default function ReceivingPhotosPage() {
  return (
    <Suspense fallback={<div className="min-h-[100dvh] bg-stage" />}>
      <PhotoPageInner />
    </Suspense>
  );
}
