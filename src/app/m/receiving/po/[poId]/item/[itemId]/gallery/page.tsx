'use client';

import { use as useUnwrap } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PhotoGalleryView } from '@/components/mobile/receiving/PhotoGalleryView';

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

export default function MobileItemGalleryPage(
  props: { params: Promise<{ poId: string; itemId: string }> },
) {
  const { poId: rawPoId, itemId: rawItemId } = useUnwrap(props.params);
  const poId = decodeURIComponent(rawPoId || '');
  const itemId = Number(rawItemId);

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

  const item = data?.items.find((i) => i.id === itemId);

  if (!item?.receiving_id) {
    return (
      <div className="grid min-h-screen place-items-center bg-black text-[11px] font-bold uppercase tracking-widest text-white/60">
        Loading…
      </div>
    );
  }

  return (
    <PhotoGalleryView
      title={item.item_name || item.sku || `Item ${itemId}`}
      subtitle={`PO ${data?.header.po_number || data?.header.po_id}`}
      backHref={`/m/receiving/po/${encodeURIComponent(poId)}/item/${itemId}`}
      scope={{ receivingId: item.receiving_id, receivingLineId: itemId }}
      captureHref={`/m/receiving/po/${encodeURIComponent(poId)}/item/${itemId}/photos`}
    />
  );
}
