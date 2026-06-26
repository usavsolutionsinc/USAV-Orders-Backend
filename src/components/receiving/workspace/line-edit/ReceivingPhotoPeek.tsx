'use client';

/**
 * ReceivingPhotoPeek — data/realtime wrapper around the presentational
 * {@link PhotoPeekFan}. Feeds it the carton's capture photos and keeps them live
 * over Ably (`useReceivingPhotosRealtimeRefresh`: phone-bridge
 * `receiving_photo_uploaded` + station `receiving-photo.changed`), so the newest
 * shot swaps in the instant it lands on mobile.
 *
 * `?photoPeekDemo=1` on the unbox URL swaps in stock images (and stages "live"
 * arrivals) so the peek can be previewed on any open carton without real NAS
 * photos. The gesture/visuals all live in PhotoPeekFan.
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PhotoPeekFan, type PeekCard } from './PhotoPeekFan';
import { useReceivingPhotosRealtimeRefresh } from '@/hooks/useReceivingPhotosRealtimeRefresh';
import { useAuth } from '@/contexts/AuthContext';
import { receivingPhotosQueryKey, refreshReceivingPhotos } from '@/lib/queries/receiving-queries';

interface PhotoRow {
  id: number;
  receivingId: number | null;
  photoUrl: string;
  caption: string | null;
  uploadedBy: number | null;
  createdAt: string;
}

interface PhotosPayload {
  photos: PhotoRow[];
}

/** Stock images for `?photoPeekDemo=1` — preview without real NAS captures. */
const DEMO_CARDS: PeekCard[] = [
  { id: 'd1', imgUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=560&fit=crop', alt: 'Headphones' },
  { id: 'd2', imgUrl: 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=400&h=560&fit=crop', alt: 'Camera gear' },
  { id: 'd3', imgUrl: 'https://images.unsplash.com/photo-1572569511254-d8f925fe2cbb?w=400&h=560&fit=crop', alt: 'Boxed electronics' },
  { id: 'd4', imgUrl: 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=400&h=560&fit=crop', alt: 'Smart watch' },
  { id: 'd5', imgUrl: 'https://images.unsplash.com/photo-1593642632823-8f785ba67e45?w=400&h=560&fit=crop', alt: 'Laptop on bench' },
];

export const ReceivingPhotoPeek = memo(function ReceivingPhotoPeek({
  receivingId,
  staffId,
}: {
  receivingId: number;
  staffId: number;
}) {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => receivingPhotosQueryKey(receivingId), [receivingId]);

  const { data } = useQuery<PhotosPayload>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/receiving-photos?receivingId=${receivingId}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: Number.isFinite(receivingId) && receivingId > 0,
    staleTime: 10_000,
  });

  const refresh = useCallback(
    (deletedPhotoId?: number) => {
      refreshReceivingPhotos(queryClient, receivingId, deletedPhotoId);
    },
    [queryClient, receivingId],
  );

  useReceivingPhotosRealtimeRefresh(receivingId, staffId, refresh, staffId > 0 && !!orgId);

  const searchParams = useSearchParams();
  const demo = searchParams?.get('photoPeekDemo') === '1';

  // Newest-first. Newest is the front of the peek and the right-most expanded card.
  const realCards = useMemo<PeekCard[]>(
    () =>
      (data?.photos ?? [])
        .filter((p) => !!p.photoUrl?.trim())
        .slice()
        .sort((a, b) => (Date.parse(b.createdAt) || b.id) - (Date.parse(a.createdAt) || a.id))
        .map((p) => ({ id: String(p.id), imgUrl: p.photoUrl, alt: p.caption || `Carton photo ${p.id}` })),
    [data],
  );

  const [demoShown, setDemoShown] = useState(2);
  useEffect(() => {
    if (!demo) return;
    setDemoShown(2);
    const id = setInterval(() => setDemoShown((n) => (n >= DEMO_CARDS.length ? n : n + 1)), 3500);
    return () => clearInterval(id);
  }, [demo]);

  const cards = demo ? DEMO_CARDS.slice(0, demoShown) : realCards;

  return <PhotoPeekFan cards={cards} receivingId={receivingId} onPhotoDeleted={(photoId) => refresh(photoId)} />;
});

export default ReceivingPhotoPeek;
