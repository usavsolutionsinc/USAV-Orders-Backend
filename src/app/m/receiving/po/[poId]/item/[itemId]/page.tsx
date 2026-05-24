'use client';

import Image from 'next/image';
import Link from 'next/link';
import { use as useUnwrap } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Camera } from '@/components/Icons';
import { MobileTopBar } from '@/components/mobile/receiving/MobileTopBar';
import { PhotoFab } from '@/components/mobile/receiving/PhotoFab';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';

interface PhotoRow {
  id: number;
  receivingId: number;
  receivingLineId: number | null;
  photoUrl: string;
  caption: string | null;
  createdAt: string;
}

interface ItemDetail {
  id: number;
  receiving_id: number | null;
  sku: string | null;
  item_name: string | null;
  image_url: string | null;
  quantity_expected: number | null;
  quantity_received: number;
  workflow_status: string | null;
  qa_status: string | null;
  condition_grade: string | null;
  notes: string | null;
  updated_at: string | null;
  item_photo_count: number;
}

interface DetailResponse {
  success: boolean;
  header: { po_number: string; po_id: string; receiving_id: number | null };
  items: ItemDetail[];
}

const STATUS_TONE: Record<string, string> = {
  EXPECTED: 'bg-slate-100 text-slate-600',
  ARRIVED:  'bg-amber-100 text-amber-800',
  MATCHED:  'bg-amber-100 text-amber-800',
  UNBOXED:  'bg-amber-100 text-amber-800',
  PASSED:   'bg-emerald-100 text-emerald-700',
  DONE:     'bg-emerald-100 text-emerald-700',
};

export default function MobilePurchaseOrderItemDetailPage(
  props: { params: Promise<{ poId: string; itemId: string }> },
) {
  const { poId: rawPoId, itemId: rawItemId } = useUnwrap(props.params);
  const poId = decodeURIComponent(rawPoId || '');
  const itemId = Number(rawItemId);
  // Same receiving-log channel — keeps per-item state and photo list fresh.
  useRealtimeInvalidation({ receiving: true });

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
    staleTime: 10_000,
  });

  const item = data?.items.find((i) => i.id === itemId);
  const header = data?.header;

  const { data: photoData } = useQuery<{ photos: PhotoRow[] }>({
    queryKey: ['receiving-item-photos', item?.receiving_id, itemId],
    queryFn: async () => {
      const params = new URLSearchParams({
        receivingId: String(item?.receiving_id),
        receivingLineId: String(itemId),
      });
      const res = await fetch(`/api/receiving-photos?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: Number.isFinite(item?.receiving_id) && Number.isFinite(itemId),
    staleTime: 10_000,
  });

  const photos = photoData?.photos ?? [];
  const captureHref =
    `/m/receiving/po/${encodeURIComponent(poId)}/item/${itemId}/photos`;
  const galleryHref =
    `/m/receiving/po/${encodeURIComponent(poId)}/item/${itemId}/gallery`;

  return (
    <div className="min-h-screen bg-white pb-24">
      <MobileTopBar
        title={item?.item_name || item?.sku || 'Purchase Order Item'}
        subtitle={header ? `PO ${header.po_number || header.po_id}` : ''}
        backHref={`/m/receiving/po/${encodeURIComponent(poId)}`}
      />

      {/* Identity */}
      <section className="border-b border-gray-100 px-4 py-4">
        {isLoading || !item ? (
          <div className="space-y-2">
            <div className="h-4 w-48 animate-pulse rounded bg-gray-100" />
            <div className="h-3 w-40 animate-pulse rounded bg-gray-100" />
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <div className="relative h-16 w-16 flex-none overflow-hidden rounded-xl bg-gray-100">
                {item.image_url ? (
                  <Image src={item.image_url} alt="" fill sizes="64px" className="object-cover" />
                ) : (
                  <span className="absolute inset-0 grid place-items-center text-micro font-black uppercase tracking-wider text-gray-400">
                    {item.sku?.slice(0, 4) || 'SKU'}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-base font-black tracking-tight text-gray-900">
                  {item.item_name || 'Untitled item'}
                </p>
                <p className="mt-0.5 text-caption font-bold uppercase tracking-wider text-gray-500">
                  {item.sku ? `SKU ${item.sku}` : 'No SKU'}
                </p>
                <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-caption font-bold text-gray-700">
                  <span>{item.quantity_received}/{item.quantity_expected ?? '?'}</span>
                  {item.workflow_status ? (
                    <span
                      className={`inline-flex items-center rounded px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-wider ${
                        STATUS_TONE[item.workflow_status] ?? 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {item.workflow_status}
                    </span>
                  ) : null}
                  {item.condition_grade ? (
                    <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-wider text-gray-700">
                      {item.condition_grade.replace('_', ' ')}
                    </span>
                  ) : null}
                </p>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Photos block */}
      <section className="px-4 py-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-caption font-black uppercase tracking-[0.18em] text-gray-700">
            Photos ({photos.length})
          </p>
          {photos.length > 0 ? (
            <Link
              href={galleryHref}
              prefetch={false}
              className="text-caption font-black uppercase tracking-wider text-blue-600 active:text-blue-700"
            >
              View all
            </Link>
          ) : null}
        </div>
        {photos.length === 0 ? (
          <Link
            href={captureHref}
            prefetch={false}
            className="flex h-24 items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 text-caption font-black uppercase tracking-[0.18em] text-gray-500 active:bg-gray-100"
          >
            <Camera className="h-5 w-5" /> Take first photo
          </Link>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {photos.slice(0, 6).map((p) => (
              <Link
                key={p.id}
                href={galleryHref}
                prefetch={false}
                className="relative aspect-square overflow-hidden rounded-xl bg-gray-100"
              >
                <Image src={p.photoUrl} alt="" fill sizes="33vw" className="object-cover" />
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Details block */}
      {item ? (
        <section className="border-t border-gray-100 px-4 py-4 text-label font-bold">
          <p className="mb-2 text-caption font-black uppercase tracking-[0.18em] text-gray-700">
            Details
          </p>
          <dl className="space-y-1.5">
            <Row label="Quantity" value={`${item.quantity_received}/${item.quantity_expected ?? '?'}`} />
            <Row label="Workflow" value={item.workflow_status ?? '—'} />
            <Row label="QA" value={item.qa_status ?? 'PENDING'} />
            <Row label="Condition" value={item.condition_grade ?? '—'} />
            {item.notes ? <Row label="Notes" value={item.notes} /> : null}
          </dl>
        </section>
      ) : null}

      {error ? (
        <p className="px-6 py-10 text-center text-label font-bold text-rose-600">
          Couldn't load this item.
        </p>
      ) : null}

      {item?.receiving_id ? (
        <PhotoFab href={captureHref} label="Take Item Photos" />
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-micro font-black uppercase tracking-wider text-gray-500">
        {label}
      </dt>
      <dd className="truncate text-right text-label font-bold text-gray-900">{value}</dd>
    </div>
  );
}
