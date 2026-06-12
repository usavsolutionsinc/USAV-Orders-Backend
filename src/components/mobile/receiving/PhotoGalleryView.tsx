'use client';

import Image from 'next/image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { MobileTopBar } from '@/components/mobile/receiving/MobileTopBar';
import { useUploadQueue, photoUploadQueue, type PhotoScope } from '@/components/mobile/receiving/PhotoUploadQueue';
import { NasPhotoPicker } from '@/components/mobile/receiving/NasPhotoPicker';
import { nasConfigured } from '@/lib/nas-photos';
import { useNasConfig } from '@/hooks/useNasConfig';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';

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
  // Seed the active NAS base URL so the "NAS" picker button shows at runtime.
  useNasConfig();
  const queryKey = ['receiving-photos', scope.receivingId, scope.receivingLineId ?? 'po'];
  const queueEntries = useUploadQueue(scope);
  const [zoom, setZoom] = useState<string | null>(null);
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

  // Pending uploads are rendered as tiles with their state ring; once "done",
  // they appear in the committed list via the next refetch. We still keep the
  // failed/queued ones visible until the user explicitly clears them.
  const pendingTiles = queueEntries.filter((e) => e.state !== 'done');

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this photo?')) return;
    const res = await fetch(`/api/receiving-photos?id=${id}`, { method: 'DELETE' });
    if (res.ok) qc.invalidateQueries({ queryKey });
  };

  return (
    <div className="min-h-screen bg-black pb-24 text-white">
      <MobileTopBar
        title={title}
        subtitle={subtitle}
        backHref={backHref}
        right={
          <div className="flex items-center gap-2">
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
              className="rounded-full bg-blue-600 px-3.5 py-2 text-caption font-black uppercase tracking-widest text-white active:bg-blue-700"
            >
              + Photo
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
              {/* eslint-disable-next-line @next/next/no-img-element */}
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
              onClick={() => setZoom(p.photoUrl)}
              className="relative aspect-square bg-gray-900"
            >
              {/* Photos served through the same-origin /api/nas proxy are
                  auth-gated, so the Next image optimizer (which fetches the URL
                  server-side WITHOUT the session cookie) 401s on them. Render
                  those unoptimized so the browser loads them directly with the
                  cookie; public absolute NAS URLs still optimize normally. */}
              <Image
                src={p.photoUrl}
                alt=""
                fill
                sizes="33vw"
                className="object-cover"
                unoptimized={p.photoUrl.startsWith('/api/nas')}
              />
            </button>
          ))}
        </div>
      )}

      {zoom ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-modal grid place-items-center bg-black/95 p-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="" className="max-h-full max-w-full object-contain" />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const match = photos.find((p) => p.photoUrl === zoom);
              if (match) handleDelete(match.id);
              setZoom(null);
            }}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-rose-600 px-5 py-2.5 text-caption font-black uppercase tracking-widest text-white active:bg-rose-700"
          >
            Delete
          </button>
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
