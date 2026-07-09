'use client';

import { Suspense, use as useUnwrap } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { MobileReceivingPhotoStudio } from '@/components/mobile/photos/MobileReceivingPhotoStudio';

interface DetailResponse {
  header: { po_number: string; po_id: string; receiving_id: number | null };
}

function PoPhotoPageInner(props: { params: Promise<{ poId: string }> }) {
  const { poId: rawPoId } = useUnwrap(props.params);
  const poId = decodeURIComponent(rawPoId || '');
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

  const receivingId = data?.header.receiving_id ?? null;
  const photosBase = `/m/receiving/po/${encodeURIComponent(poId)}/photos`;
  const poDetailHref = `/m/receiving/po/${encodeURIComponent(poId)}`;
  const headerLabel = `PO ${data?.header.po_number || data?.header.po_id || poId}`;
  const poRef = data?.header.po_number || data?.header.po_id || null;

  if (isLoading) {
    return (
      <div className="grid min-h-[100dvh] place-items-center text-caption font-bold uppercase tracking-widest text-white/60">
        Opening camera…
      </div>
    );
  }

  if (error || !receivingId) {
    return (
      <div className="grid min-h-[100dvh] place-items-center px-6 text-center">
        <p className="text-sm font-black uppercase tracking-wider text-white/80">
          No receiving package yet
        </p>
        <p className="mt-1 text-caption font-bold text-white/50">
          Scan the package tracking on the desktop first, then come back.
        </p>
      </div>
    );
  }

  const scope = { receivingId, receivingLineId: null as number | null, poRef };

  return (
    <MobileReceivingPhotoStudio
      mode={mode}
      scope={scope}
      headerLabel={headerLabel}
      galleryTitle="PO photos"
      gallerySubtitle={headerLabel}
      backHref={poDetailHref}
      returnHref={poDetailHref}
    />
  );
}

export default function MobilePoPhotoCapturePage(
  props: { params: Promise<{ poId: string }> },
) {
  return (
    <Suspense fallback={<div className="min-h-[100dvh] bg-stage" />}>
      <PoPhotoPageInner params={props.params} />
    </Suspense>
  );
}
