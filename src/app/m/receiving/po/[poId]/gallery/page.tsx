'use client';

import { use as useUnwrap } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PhotoGalleryView } from '@/components/mobile/receiving/PhotoGalleryView';

interface DetailResponse {
  header: { po_number: string; po_id: string; receiving_id: number | null };
}

export default function MobilePoGalleryPage(
  props: { params: Promise<{ poId: string }> },
) {
  const { poId: rawPoId } = useUnwrap(props.params);
  const poId = decodeURIComponent(rawPoId || '');

  const { data } = useQuery<DetailResponse>({
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

  if (!receivingId) {
    return (
      <div className="grid min-h-screen place-items-center bg-black text-[11px] font-bold uppercase tracking-widest text-white/60">
        Loading…
      </div>
    );
  }

  return (
    <PhotoGalleryView
      title="PO photos"
      subtitle={`PO ${data?.header.po_number || data?.header.po_id}`}
      backHref={`/m/receiving/po/${encodeURIComponent(poId)}`}
      scope={{ receivingId, receivingLineId: null }}
      captureHref={`/m/receiving/po/${encodeURIComponent(poId)}/photos`}
    />
  );
}
