'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useMemo, useState, use as useUnwrap } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { ChevronRight, Camera } from '@/components/Icons';
import { MobileTopBar } from '@/components/mobile/receiving/MobileTopBar';
import { PhotoFab } from '@/components/mobile/receiving/PhotoFab';
import { MobileReceivingPhotoStrip } from '@/components/mobile/receiving/MobileReceivingPhotoStrip';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';
import { poHeaderStatusChipClass } from '@/lib/po-header-status';
import { workflowStatusTableLabel } from '@/components/station/receiving-constants';
import { workflowStageBadge } from '@/lib/receiving/workflow-stages';
import { receivingPhotosGalleryUrl } from '@/lib/photos/mobile-gallery-url';

interface PoItem {
  id: number;
  receiving_id: number | null;
  sku: string | null;
  item_name: string | null;
  image_url: string | null;
  quantity_expected: number | null;
  quantity_received: number;
  qa_status: string | null;
  workflow_status: string | null;
  condition_grade: string | null;
  notes: string | null;
  updated_at: string | null;
  created_at: string | null;
  item_photo_count: number;
}

interface PoHeader {
  po_id: string;
  po_number: string;
  receiving_id: number | null;
  item_count: number;
  qty_expected: number;
  qty_received: number;
  open_items: number;
  status: 'OPEN' | 'RECEIVED';
  po_photo_count: number;
  item_photo_count: number;
  total_photo_count: number;
}

interface DetailResponse {
  success: boolean;
  header: PoHeader;
  items: PoItem[];
}

// PO-header rollup status (not a per-line workflow stage). Item rows use the
// shared workflowStageBadge registry instead.
type Tab = 'items' | 'photos';

export default function MobilePoDetailPage(props: { params: Promise<{ poId: string }> }) {
  const { poId: rawPoId } = useUnwrap(props.params);
  const poId = decodeURIComponent(rawPoId || '');
  const [tab, setTab] = useState<Tab>('items');
  const { user } = useAuth();
  const staffId = user?.staffId ?? 0;
  // Refresh header/items/photos when receiving-log events fire (desktop scan,
  // QA update, another phone uploaded a photo for this PO).
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
    refetchOnWindowFocus: true,
  });

  const header = data?.header;
  const items = useMemo(() => data?.items ?? [], [data]);

  const captureHref = `/m/receiving/po/${encodeURIComponent(poId)}/photos`;

  return (
    <div className="min-h-screen bg-white pb-24">
      <MobileTopBar
        title={header?.po_number ? `PO ${header.po_number}` : 'Purchase Order'}
        subtitle={header ? `${header.item_count} items · ${header.qty_received}/${header.qty_expected || '?'} received` : 'Loading…'}
        backHref="/m/receiving/history"
      />

      {/* Identity / summary block */}
      <section className="border-b border-gray-100 px-4 py-4">
        {isLoading || !header ? (
          <div className="space-y-2">
            <div className="h-4 w-32 animate-pulse rounded bg-gray-100" />
            <div className="h-3 w-48 animate-pulse rounded bg-gray-100" />
            <div className="h-3 w-40 animate-pulse rounded bg-gray-100" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <p className="text-xl font-black tracking-tight text-gray-900">
                PO {header.po_number || header.po_id}
              </p>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-micro font-black uppercase tracking-wide ${poHeaderStatusChipClass(
                  header.status,
                )}`}
              >
                {header.status}
              </span>
            </div>
            <p className="mt-1 text-label font-bold text-gray-600">
              {header.qty_received}/{header.qty_expected || '?'} received
              {' · '}
              {header.open_items} open
              {' · '}
              <Camera className="-mt-0.5 mr-0.5 inline h-3.5 w-3.5 text-gray-500" />
              {header.total_photo_count} photos
            </p>
          </>
        )}
      </section>

      {/* Tab strip */}
      <div className="sticky top-14 z-sticky flex border-b border-gray-100 bg-white">
        {(['items', 'photos'] as Tab[]).map((t) => {
          const active = tab === t;
          return (
            // ds-raw-button: segmented tab with underline indicator (role=tab)
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`h-12 flex-1 text-label font-black uppercase tracking-[0.18em] transition-colors ${
                active ? 'text-gray-900' : 'text-gray-400'
              }`}
            >
              {t === 'items'
                ? `Items${header ? ` (${header.item_count})` : ''}`
                : `Photos${header ? ` (${header.total_photo_count})` : ''}`}
              <span
                className={`mx-auto mt-2 block h-[3px] w-12 rounded-full ${
                  active ? 'bg-gray-900' : 'bg-transparent'
                }`}
              />
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {error ? (
        <p className="px-6 py-12 text-center text-label font-bold text-rose-600">
          Couldn't load PO {poId}.
        </p>
      ) : tab === 'items' ? (
        <ItemsList poId={poId} items={items} />
      ) : (
        <PoPhotosTab header={header} staffId={staffId} />
      )}

      {/* Camera FAB — PO-level capture */}
      {header?.receiving_id ? <PhotoFab href={captureHref} label="Add PO Photo" /> : null}
    </div>
  );
}

function ItemsList({ poId, items }: { poId: string; items: PoItem[] }) {
  if (items.length === 0) {
    return (
      <p className="px-6 py-10 text-center text-label font-bold text-gray-500">
        No purchase order items yet.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-gray-100">
      {items.map((it) => {
        const status = (it.workflow_status || 'EXPECTED').toUpperCase();
        return (
          <li key={it.id}>
            <Link
              href={`/m/receiving/po/${encodeURIComponent(poId)}/item/${it.id}`}
              prefetch={false}
              className="flex items-center gap-3 px-4 py-3 active:bg-gray-50"
            >
              <div className="relative h-14 w-14 flex-none overflow-hidden rounded-xl bg-gray-100">
                {it.image_url ? (
                  <Image
                    src={it.image_url}
                    alt=""
                    fill
                    sizes="56px"
                    className="object-cover"
                  />
                ) : (
                  <span className="absolute inset-0 grid place-items-center text-micro font-black uppercase tracking-wider text-gray-400">
                    {it.sku?.slice(0, 4) || 'SKU'}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black tracking-tight text-gray-900">
                  {it.item_name || it.sku || 'Untitled item'}
                </p>
                <p className="mt-0.5 text-caption font-bold text-gray-500">
                  {it.sku ? `${it.sku} · ` : ''}
                  {it.quantity_received}/{it.quantity_expected ?? '?'}
                  {' · '}
                  <span
                    className={`inline-flex items-center rounded px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-wider ${workflowStageBadge(status)}`}
                  >
                    {workflowStatusTableLabel(status)}
                  </span>
                </p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-caption font-black text-gray-700">
                <Camera className="h-3.5 w-3.5" />
                {it.item_photo_count}
              </span>
              <ChevronRight className="h-5 w-5 text-gray-300" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function PoPhotosTab({ header, staffId }: { header: PoHeader | undefined; staffId: number }) {
  if (!header?.receiving_id) {
    return (
      <p className="px-6 py-10 text-center text-label font-bold text-gray-500">
        No receiving package yet — scan tracking from desktop first.
      </p>
    );
  }
  const poSlug = encodeURIComponent(header.po_id);
  const galleryHref = receivingPhotosGalleryUrl(`/m/receiving/po/${poSlug}/photos`);
  return (
    <div className="px-4 py-4">
      <MobileReceivingPhotoStrip
        receivingId={header.receiving_id}
        staffId={staffId}
        galleryHref={galleryHref}
        countHint={header.total_photo_count}
      />
    </div>
  );
}
