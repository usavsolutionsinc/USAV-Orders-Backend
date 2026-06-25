'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download } from '@/components/Icons';
import {
  MobilePackerSpamCamera,
  type CapturedShot,
} from '@/components/mobile/station/MobilePackerSpamCamera';
import {
  MobileSwipePhotoViewer,
  type SwipePhotoSlide,
} from '@/components/mobile/station/MobileSwipePhotoViewer';
import { MobileTopBar } from '@/components/mobile/receiving/MobileTopBar';
import {
  photoUploadQueue,
  useClearDoneOnUnmount,
  useUploadQueue,
  type PhotoScope,
} from '@/components/mobile/receiving/PhotoUploadQueue';
import { NasPhotoPicker } from '@/components/mobile/receiving/NasPhotoPicker';
import { nasConfigured } from '@/lib/nas-photos';
import { buildPhotoZipDownloadUrl, triggerBrowserDownload } from '@/lib/photos/download-zip';
import { useNasConfig } from '@/hooks/useNasConfig';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';
import { useScopedReceivingPhotos } from '@/hooks/useScopedReceivingPhotos';
import { useAblyClient } from '@/contexts/AblyContext';
import { useAuth } from '@/contexts/AuthContext';
import { safeChannelName, getPhoneBridgeChannelName } from '@/lib/realtime/channels';
import { publishReceivingPhotoRequest } from '@/lib/realtime/receiving-photo-request';
import { invalidateReceivingFeeds } from '@/lib/queries/receiving-queries';
import { toast as appToast } from '@/lib/toast';

export type MobilePhotoStudioMode = 'capture' | 'gallery';

export interface MobileReceivingPhotoStudioProps {
  mode: MobilePhotoStudioMode;
  scope: PhotoScope;
  headerLabel: string;
  galleryTitle: string;
  gallerySubtitle: string;
  backHref: string;
  returnHref: string;
  maxPhotos?: number;
  requestId?: string | null;
}

/**
 * Unified receiving photo station: capture (camera) and gallery (grid + viewer)
 * for one scope. Lives under the immersive layout — camera renders in-tree.
 */
export function MobileReceivingPhotoStudio({
  mode,
  scope,
  headerLabel,
  galleryTitle,
  gallerySubtitle,
  backHref,
  returnHref,
  maxPhotos = 12,
  requestId = null,
}: MobileReceivingPhotoStudioProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  useClearDoneOnUnmount();
  useNasConfig();
  useRealtimeInvalidation({ receiving: true });

  const { getClient } = useAblyClient();
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const notifyStaffId = user?.staffId ?? 0;
  const phoneChannelName = safeChannelName(() => getPhoneBridgeChannelName(orgId!, notifyStaffId));

  const { photos, priorPhotos, deletePhoto, queryKey, query } = useScopedReceivingPhotos(scope);
  const queueEntries = useUploadQueue(scope);

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [nasOpen, setNasOpen] = useState(false);

  const returnToCaller = useCallback(() => {
    router.replace(returnHref);
  }, [router, returnHref]);

  useEffect(() => {
    if (notifyStaffId <= 0 || !phoneChannelName) return;
    photoUploadQueue.configureNotifier(async (notice) => {
      try {
        invalidateReceivingFeeds(queryClient);
        queryClient.invalidateQueries({
          queryKey: ['receiving-photos', notice.receivingId],
        });
        const client = await getClient();
        if (!client) return;
        const ch = client.channels.get(phoneChannelName);
        await ch.publish('receiving_photo_uploaded', {
          receiving_id: notice.receivingId,
          receiving_line_id: notice.receivingLineId,
          photo_id: notice.photoId,
          photo_url: notice.photoUrl,
          ...(requestId ? { request_id: requestId } : {}),
        });
      } catch (err) {
        console.warn('photo queue: receiving_photo_uploaded publish failed', err);
      }
    });
  }, [getClient, notifyStaffId, phoneChannelName, queryClient, requestId]);

  const handleDeletePrior = useCallback(
    async (photoId: number) => {
      const ok = await deletePhoto(photoId);
      if (ok) queryClient.invalidateQueries({ queryKey });
    },
    [deletePhoto, queryClient, queryKey],
  );

  const handleDone = useCallback(
    (shots: CapturedShot[]) => {
      if (shots.length === 0) {
        returnToCaller();
        return;
      }
      const existingCount = query.data?.photos?.length ?? 0;
      shots.forEach((s, index) => {
        photoUploadQueue.enqueue(
          { ...scope, fileIndex: existingCount + index + 1 },
          s.blob,
          s.previewUrl,
        );
      });
      toast.message(`Uploading ${shots.length} photo${shots.length === 1 ? '' : 's'}…`, {
        description: 'Saving to storage in the background.',
        position: 'top-center',
        duration: 5000,
      });
      returnToCaller();
    },
    [query.data?.photos?.length, returnToCaller, scope],
  );

  const swipeSlides = useMemo<SwipePhotoSlide[]>(
    () =>
      photos.map((p) => ({
        id: String(p.id),
        previewUrl: p.displayUrl,
        deletable: true,
      })),
    [photos],
  );

  const openViewer = useCallback(
    (index: number) => {
      if (photos.length === 0) return;
      setViewerIndex(index);
      setViewerOpen(true);
    },
    [photos.length],
  );

  const handleViewerDelete = useCallback(
    async (slide: SwipePhotoSlide) => {
      const photoId = Number(slide.id);
      if (!Number.isFinite(photoId)) return;
      const ok = await deletePhoto(photoId);
      if (ok && photos.length <= 1) setViewerOpen(false);
    },
    [deletePhoto, photos.length],
  );

  const pendingTiles = queueEntries.filter((e) => e.state !== 'done');
  const downloadZipUrl = buildPhotoZipDownloadUrl(photos.map((p) => p.id), galleryTitle || 'photos');

  const handleSendToPhone = async () => {
    try {
      const client = await getClient();
      await publishReceivingPhotoRequest(client, orgId, notifyStaffId, scope.receivingId);
      appToast.success('Sent to phone');
    } catch (err) {
      console.warn('photo-studio: photo request publish failed', err);
      appToast.error('Could not send to phone');
    }
  };

  const switchToCapture = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('mode');
    router.replace(url.pathname + url.search);
  }, [router]);

  useEffect(() => {
    if (!nasOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setNasOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nasOpen]);

  if (mode === 'capture') {
    return (
      <MobilePackerSpamCamera
        embedded
        onDone={handleDone}
        onCancel={returnToCaller}
        maxPhotos={maxPhotos}
        priorPhotos={priorPhotos}
        onDeletePrior={handleDeletePrior}
        header={
          <div className="min-w-0">
            <p className="text-micro font-black uppercase tracking-[0.22em] text-white/60">
              Add unboxing photos
            </p>
            <p className="truncate text-sm font-black text-white">{headerLabel}</p>
          </div>
        }
      />
    );
  }

  const { isLoading, error } = query;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto pb-24">
      <MobileTopBar
        title={galleryTitle}
        subtitle={gallerySubtitle}
        backHref={backHref}
        right={
          <div className="flex items-center gap-2">
            {downloadZipUrl ? (
              <button
                type="button"
                onClick={() => triggerBrowserDownload(downloadZipUrl)}
                className="rounded-full bg-white/10 px-3.5 py-2 text-caption font-black uppercase tracking-widest text-white active:bg-white/20"
                aria-label="Download all photos as ZIP"
              >
                <Download className="h-4 w-4" />
              </button>
            ) : null}
            {nasConfigured() ? (
              <button
                type="button"
                onClick={() => setNasOpen(true)}
                className="rounded-full bg-white/10 px-3.5 py-2 text-caption font-black uppercase tracking-widest text-white active:bg-white/20"
              >
                NAS
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void handleSendToPhone()}
              className="rounded-full bg-blue-600 px-3.5 py-2 text-caption font-black uppercase tracking-widest text-white active:bg-blue-700"
            >
              Send to Phone
            </button>
          </div>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-3 gap-1 p-1">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse bg-gray-900" />
          ))}
        </div>
      ) : error ? (
        <p className="px-6 py-12 text-center text-label font-bold text-rose-400">
          Couldn&apos;t load photos.
        </p>
      ) : photos.length === 0 && pendingTiles.length === 0 ? (
        <p className="px-6 py-12 text-center text-label font-bold text-white/70">
          No photos yet.{' '}
          <button type="button" onClick={switchToCapture} className="text-blue-400 underline">
            Take a photo
          </button>
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-0.5 bg-black">
          {pendingTiles.map((p) => (
            <div key={p.id} className="relative aspect-square bg-gray-900">
              <img src={p.previewUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
              <div className="absolute inset-0 grid place-items-center text-micro font-black uppercase tracking-widest">
                {p.state === 'queued' && '⌛ queued'}
                {p.state === 'uploading' && '↑ uploading'}
                {p.state === 'failed' && (
                  <button
                    type="button"
                    onClick={() => photoUploadQueue.retry(p.id)}
                    className="rounded-full bg-rose-600 px-3 py-1 text-white active:bg-rose-700"
                  >
                    Retry
                  </button>
                )}
              </div>
            </div>
          ))}
          {photos.map((p, index) => (
            <button
              key={p.id}
              type="button"
              onClick={() => openViewer(index)}
              className="relative aspect-square bg-gray-900"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.displayUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      <MobileSwipePhotoViewer
        open={viewerOpen}
        initialIndex={viewerIndex}
        slides={swipeSlides}
        onClose={() => setViewerOpen(false)}
        onDelete={handleViewerDelete}
      />

      {nasOpen ? (
        <NasPhotoPicker
          scope={scope}
          onClose={() => setNasOpen(false)}
          onAttached={() => queryClient.invalidateQueries({ queryKey })}
        />
      ) : null}
    </div>
  );
}
