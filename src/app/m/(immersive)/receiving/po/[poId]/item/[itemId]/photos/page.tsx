'use client';

import { Suspense, use as useUnwrap } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { MobileReceivingPhotoStudio } from '@/components/mobile/photos/MobileReceivingPhotoStudio';

interface DetailResponse {
  header: { po_number: string; po_id: string };
  items: Array<{
    id: number;
    receiving_id: number | null;
    item_name: string | null;
    sku: string | null;
  }>;
}

function ItemPhotoPageInner(
  props: { params: Promise<{ poId: string; itemId: string }> },
) {
  const { poId: rawPoId, itemId: rawItemId } = useUnwrap(props.params);
  const poId = decodeURIComponent(rawPoId || '');
  const itemId = Number(rawItemId);
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode') === 'gallery' ? 'gallery' : 'capture';

  const { data, isLoading, error } = useQuery<DetailResponse>({
    queryKey: ['receiving-po-detail', poId],
    queryFn: async () => {
      const res = await fetch(`/api/receiving/po/${encodeURIComponent(poId)}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!poId,
  });

  const item = data?.items.find((i) => i.id === itemId);
  const photosBase = `/m/receiving/po/${encodeURIComponent(poId)}/item/${itemId}/photos`;
  const itemDetailHref = `/m/receiving/po/${encodeURIComponent(poId)}/item/${itemId}`;
  const headerLabel =
    `PO ${data?.header.po_number || data?.header.po_id} · ${item?.item_name || item?.sku || `Item ${itemId}`}`;
  const poRef = data?.header.po_number || data?.header.po_id || null;

  if (isLoading) {
    return (
      <div className="grid min-h-[100dvh] place-items-center text-caption font-bold uppercase tracking-widest text-white/60">
        Opening camera…
      </div>
    );
  }

  if (error || !item?.receiving_id) {
    return (
      <div className="grid min-h-[100dvh] place-items-center px-6 text-center">
        <p className="text-label font-bold text-white/70">This item isn&apos;t ready for photos yet.</p>
      </div>
    );
  }

  const scope = { receivingId: item.receiving_id, receivingLineId: itemId, poRef };

  return (
    <MobileReceivingPhotoStudio
      mode={mode}
      scope={scope}
      headerLabel={headerLabel}
      galleryTitle="Item photos"
      gallerySubtitle={headerLabel}
      backHref={itemDetailHref}
      returnHref={itemDetailHref}
    />
  );
}

export default function MobileItemPhotoCapturePage(
  props: { params: Promise<{ poId: string; itemId: string }> },
) {
  return (
    <Suspense fallback={<div className="min-h-[100dvh] bg-black" />}>
      <ItemPhotoPageInner params={props.params} />
    </Suspense>
  );
}
