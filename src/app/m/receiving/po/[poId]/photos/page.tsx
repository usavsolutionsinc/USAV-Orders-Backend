'use client';

import { use as useUnwrap } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PhotoCaptureSurface } from '@/components/mobile/receiving/PhotoCaptureSurface';

interface DetailResponse {
  header: { po_number: string; po_id: string; receiving_id: number | null };
}

export default function MobilePoPhotoCapturePage(
  props: { params: Promise<{ poId: string }> },
) {
  const { poId: rawPoId } = useUnwrap(props.params);
  const poId = decodeURIComponent(rawPoId || '');

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
  // Return to the gallery so the receiver sees their uploads (and any retries
  // for failures) immediately after the camera closes.
  const returnHref = `/m/receiving/po/${encodeURIComponent(poId)}/gallery`;

  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-black text-[11px] font-bold uppercase tracking-widest text-white/60">
        Opening camera…
      </div>
    );
  }

  if (error || !receivingId) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 px-6 text-center">
        <div>
          <p className="text-[13px] font-black uppercase tracking-wider text-gray-700">
            No receiving package yet
          </p>
          <p className="mt-1 text-[11px] font-bold text-gray-500">
            Scan the package tracking on the desktop first, then come back.
          </p>
        </div>
      </div>
    );
  }

  return (
    <PhotoCaptureSurface
      receivingId={receivingId}
      headerLabel={`PO ${data?.header.po_number || data?.header.po_id}`}
      returnHref={returnHref}
    />
  );
}
