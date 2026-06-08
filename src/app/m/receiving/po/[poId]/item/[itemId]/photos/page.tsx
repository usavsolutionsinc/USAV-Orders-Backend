'use client';

import { use as useUnwrap } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PhotoCaptureSurface } from '@/components/mobile/receiving/PhotoCaptureSurface';

interface ItemRow {
  id: number;
  receiving_id: number | null;
  sku: string | null;
  item_name: string | null;
}

interface DetailResponse {
  header: { po_number: string; po_id: string };
  items: ItemRow[];
}

export default function MobileItemPhotoCapturePage(
  props: { params: Promise<{ poId: string; itemId: string }> },
) {
  const { poId: rawPoId, itemId: rawItemId } = useUnwrap(props.params);
  const poId = decodeURIComponent(rawPoId || '');
  const itemId = Number(rawItemId);

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
  // Return to the item gallery so the receiver sees their uploads (and any
  // retries for failures) immediately after the camera closes.
  const returnHref =
    `/m/receiving/po/${encodeURIComponent(poId)}/item/${itemId}/gallery`;

  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-black text-caption font-bold uppercase tracking-widest text-white/60">
        Opening camera…
      </div>
    );
  }

  if (error || !item?.receiving_id) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 px-6 text-center">
        <p className="text-label font-bold text-gray-600">
          This item isn't ready for photos yet.
        </p>
      </div>
    );
  }

  const headerLabel =
    `PO ${data?.header.po_number || data?.header.po_id} · ${item.item_name || item.sku || `Item ${itemId}`}`;

  return (
    <PhotoCaptureSurface
      receivingId={item.receiving_id}
      receivingLineId={itemId}
      headerLabel={headerLabel}
      poRef={data?.header.po_number || data?.header.po_id || null}
      returnHref={returnHref}
    />
  );
}
