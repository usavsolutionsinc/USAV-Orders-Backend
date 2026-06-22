'use client';

import Image from 'next/image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Download, Trash2, X } from '@/components/Icons';
import { MobileTopBar } from '@/components/mobile/receiving/MobileTopBar';
import { useUploadQueue, photoUploadQueue, type PhotoScope } from '@/components/mobile/receiving/PhotoUploadQueue';
import { NasPhotoPicker } from '@/components/mobile/receiving/NasPhotoPicker';
import { deleteNasPhoto, isNasPhotoUrl, nasConfigured, normalizePhotoDisplayUrl } from '@/lib/nas-photos';
import { buildPhotoZipDownloadUrl, triggerBrowserDownload } from '@/lib/photos/download-zip';
import { useNasConfig } from '@/hooks/useNasConfig';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';
import { useAblyClient } from '@/contexts/AblyContext';
import { useAuth } from '@/contexts/AuthContext';
import { publishReceivingPhotoRequest } from '@/lib/realtime/receiving-photo-request';
import { toast } from '@/lib/toast';

interface PhotoRow {
  id: number;
  receivingId: number;
  receivingLineId: number | null;
  photoUrl: string;
  createdAt: string;
}

interface GalleryProps {
  title: string;
  subtitle: string;
  backHref: string;
  scope: PhotoScope;
  /** Where to send the user to capture more. */
  captureHref: string;
}

/**
 * Mobile-only photo gallery used by both PO-scope and Item-scope galleries.
 * Combines committed photos from the API with any in-flight uploads from the
 * PhotoUploadQueue so a receiver can see what's queued and retry failures
 * inline without leaving the screen.
 */
export function PhotoGalleryView({ title, subtitle, backHref, scope, captureHref }: GalleryProps) {
  const qc = useQueryClient();
  const { getClient } = useAblyClient();
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const staffId = user?.staffId ?? 0;
  // Seed the active NAS base URL so the "NAS" picker button shows at runtime.
  useNasConfig();
  const queryKey = ['receiving-photos', scope.receivingId, scope.receivingLineId ?? 'po'];
  const queueEntries = useUploadQueue(scope);
  const [zoomPhotoId, setZoomPhotoId] = useState<number | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [nasOpen, setNasOpen] = useState(false);
  // Refresh the photo grid when another station uploads or a desktop QA action
  // fires on the receiving-log channel.
  useRealtimeInvalidation({ receiving: true });

  const { data, isLoading, error } = useQuery<{ photos: PhotoRow[] }>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ receivingId: String(scope.receivingId) });
      if (scope.receivingLineId != null) {
        params.set('receivingLineId', String(scope.receivingLineId));
      } else {
        params.set('scope', 'po');
      }
      const res = await fetch(`/api/receiving-photos?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });

  const photos = data?.photos ?? [];
  const zoomPhoto = zoomPhotoId != null ? photos.find((p) => p.id === zoomPhotoId) : null;
  const zoomUrl = zoomPhoto ? normalizePhotoDisplayUrl(zoomPhoto.photoUrl) : null;
  const downloadZipUrl = buildPhotoZipDownloadUrl(photos.map((p) => p.id), title || 'photos');

  useEffect(() => {
    if (zoomPhotoId == null) setDeleteArmed(false);
  }, [zoomPhotoId]);

  // Esc closes the open overlay — the NAS picker first, otherwise the zoom
  // preview (back to the photo grid).
  useEffect(() => {
    if (zoomPhotoId == null && !nasOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (nasOpen) setNasOpen(false);
        else setZoomPhotoId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomPhotoId, nasOpen]);

  // Pending uploads are rendered as tiles with their state ring; once "done",
  // they appear in the committed list via the next refetch. We still keep the
  // failed/queued ones visible until the user explicitly clears them.
  const pendingTiles = queueEntries.filter((e) => e.state !== 'done');

  const performDelete = async (id: number) => {
    setDeleting(true);
    try {
      const row = photos.find((p) => p.id === id);
      const displayUrl = row ? normalizePhotoDisplayUrl(row.photoUrl) : '';
      if (displayUrl && isNasPhotoUrl(displayUrl)) {
        const nasDel = await deleteNasPhoto(displayUrl);
        if (!nasDel.ok) console.warn('NAS file delete failed:', nasDel.error);
      }
      const res = await fetch(`/api/photos/${id}`, { method: 'DELETE' });
      if (res.ok) {
        qc.invalidateQueries({ queryKey });
        setZoomPhotoId(null);
      }
    } finally {
      setDeleting(false);
      setDeleteArmed(false);
    }
  };

  const handleDeleteClick = () => {
    if (zoomPhotoId == null || deleting) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      window.setTimeout(() => {
        setDeleteArmed((armed) => (armed ? false : armed));
      }, 4000);
      return;
    }
    void performDelete(zoomPhotoId);
  };

  const handleDownloadAll = () => {
    if (!downloadZipUrl) return;
    triggerBrowserDownload(downloadZipUrl);
  };

  const handleSendToPhone = async () => {
    try {
      const client = await getClient();
      await publishReceivingPhotoRequest(client, orgId, staffId, scope.receivingId);
      toast.success('Sent to phone');
    } catch (err) {
      console.warn('photo-gallery-view: photo request publish failed', err);
      toast.error('Could not send to phone');
    }
  };

  return (
    <div className="min-h-screen bg-black pb-24 text-white">
      <MobileTopBar
        title={title}
        subtitle={subtitle}
        backHref={backHref}
        right={
          <div className="flex items-center gap-2">
            {downloadZipUrl ? (
              <button
                type="button"
                onClick={handleDownloadAll}
                className="rounded-full bg-white/10 px-3.5 py-2 text-caption font-black uppercase tracking-widest text-white active:bg-white/20"
                aria-label="Download all photos as ZIP"
                title="Download all photos as ZIP"
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
            <a
              href={captureHref}
              onClick={(e) => {
                e.preventDefault();
                void handleSendToPhone();
              }}
              className="rounded-full bg-blue-600 px-3.5 py-2 text-caption font-black uppercase tracking-widest text-white active:bg-blue-700"
            >
              Send to Phone
            </a>
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
          Couldn't load photos.
        </p>
      ) : photos.length === 0 && pendingTiles.length === 0 ? (
        <p className="px-6 py-12 text-center text-label font-bold text-white/70">
          No photos yet. Tap + Photo to add one.
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
          {photos.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setZoomPhotoId(p.id)}
              className="relative aspect-square bg-gray-900"
            >
              <Image
                src={normalizePhotoDisplayUrl(p.photoUrl)}
                alt=""
                fill
                sizes="33vw"
                className="object-cover"
                unoptimized={
                  p.photoUrl.startsWith('/api/nas') ||
                  p.photoUrl.startsWith('/api/nas-dev') ||
                  p.photoUrl.includes('storage.googleapis.com')
                }
              />
            </button>
          ))}
        </div>
      )}

      {zoomUrl ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setZoomPhotoId(null)}
          className="fixed inset-0 z-modal bg-black/95"
        >
          <div className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/70 to-transparent">
            <div className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-6">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteClick();
                }}
                disabled={deleting}
                aria-label={deleteArmed ? 'Confirm delete photo' : 'Delete photo'}
                title={deleteArmed ? 'Click again to confirm' : 'Delete photo'}
                className={
                  deleteArmed
                    ? 'flex h-11 items-center gap-2 rounded-full bg-red-600 px-4 text-white transition-colors active:bg-red-700 disabled:opacity-60'
                    : 'flex h-11 w-11 items-center justify-center rounded-full bg-red-600 text-white transition-colors active:bg-red-700 disabled:opacity-60'
                }
              >
                <Trash2 className="h-5 w-5 shrink-0" />
                {deleteArmed ? (
                  <span className="text-caption font-black uppercase tracking-wider">
                    {deleting ? 'Deleting…' : 'Confirm'}
                  </span>
                ) : null}
              </button>

              {/* Close — dismiss the zoom preview, back to the photo grid. */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setZoomPhotoId(null);
                }}
                aria-label="Close photo"
                title="Close"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors active:bg-white/20"
              >
                <X className="h-5 w-5 shrink-0" />
              </button>
            </div>
          </div>
          <img
            src={zoomUrl}
            alt=""
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-0 m-auto max-h-full max-w-full object-contain p-4 pt-16 pb-8"
          />
        </div>
      ) : null}

      {nasOpen ? (
        <NasPhotoPicker
          scope={scope}
          onClose={() => setNasOpen(false)}
          onAttached={() => qc.invalidateQueries({ queryKey })}
        />
      ) : null}
    </div>
  );
}
