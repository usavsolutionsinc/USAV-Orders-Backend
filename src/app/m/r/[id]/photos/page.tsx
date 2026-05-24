'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useAblyClient } from '@/contexts/AblyContext';
import {
  MobilePackerSpamCamera,
  type CapturedShot,
} from '@/components/mobile/station/MobilePackerSpamCamera';
import { PhotoCaptureSurface } from '@/components/mobile/receiving/PhotoCaptureSurface';
import { compressPhotoForUpload } from '@/lib/image/compress-for-upload';

// ─── Types ──────────────────────────────────────────────────────────────────

type UploadState = 'pending' | 'uploading' | 'done' | 'error';

interface UploadEntry {
  id: string;
  blob: Blob;
  previewUrl: string;
  state: UploadState;
  photoId: number | null;
  photoUrl: string | null;
  error: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Page ───────────────────────────────────────────────────────────────────

function PhotoPageInner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const receivingId = Number(params?.id);
  // Identity from the verified session cookie.
  const { user } = useAuth();
  const staffId = user?.staffId ?? 0;
  const requestId = searchParams.get('requestId');
  const { getClient } = useAblyClient();

  const [stage, setStage] = useState<'camera' | 'uploading' | 'done'>('camera');
  const [entries, setEntries] = useState<UploadEntry[]>([]);

  const validReceivingId = Number.isFinite(receivingId) && receivingId > 0;

  // ── Publish helper ──
  const publishUpload = useCallback(
    async (payload: {
      photo_id: number;
      photo_url: string;
      idx: number;
      total: number;
    }) => {
      if (staffId <= 0) return;
      try {
        const client = await getClient();
        if (!client) return;
        const ch = client.channels.get(`phone:${staffId}`);
        await ch.publish('receiving_photo_uploaded', {
          receiving_id: receivingId,
          request_id: requestId,
          ...payload,
        });
      } catch (err) {
        console.warn('photos page: publish failed', err);
      }
    },
    [getClient, receivingId, requestId, staffId],
  );

  // ── Upload one entry ──
  const uploadEntry = useCallback(
    async (entry: UploadEntry, idx: number, total: number) => {
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, state: 'uploading', error: null } : e)),
      );
      try {
        // Defense-in-depth: shots from MobilePackerSpamCamera are already
        // compressed, but if this page is ever entered with a raw blob the
        // helper short-circuits via its passthrough for already-small files.
        const compressed = await compressPhotoForUpload(entry.blob, { source: 'm-receiving' });
        const base64 = compressed.base64;
        const res = await fetch('/api/receiving-photos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            receivingId,
            photoBase64: base64,
            uploadedBy: staffId,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        const photoId = Number(data?.id ?? data?.photo?.id ?? data?.photos?.[0]?.id ?? 0) || 0;
        const photoUrl = String(
          data?.photoUrl ?? data?.url ?? data?.photo?.photoUrl ?? '',
        );
        setEntries((prev) =>
          prev.map((e) =>
            e.id === entry.id
              ? { ...e, state: 'done', photoId, photoUrl, error: null }
              : e,
          ),
        );
        if (photoId > 0 && photoUrl) {
          void publishUpload({ photo_id: photoId, photo_url: photoUrl, idx, total });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'upload failed';
        setEntries((prev) =>
          prev.map((e) => (e.id === entry.id ? { ...e, state: 'error', error: message } : e)),
        );
      }
    },
    [publishUpload, receivingId, staffId],
  );

  // ── Camera "Done" → upload sequentially so we can publish in order ──
  const handleCameraDone = useCallback(
    async (shots: CapturedShot[]) => {
      if (shots.length === 0) {
        router.back();
        return;
      }
      const seeded: UploadEntry[] = shots.map((s) => ({
        id: s.id || randomId(),
        blob: s.blob,
        previewUrl: s.previewUrl,
        state: 'pending',
        photoId: null,
        photoUrl: null,
        error: null,
      }));
      setEntries(seeded);
      setStage('uploading');
      const total = seeded.length;
      for (let i = 0; i < seeded.length; i++) {
        await uploadEntry(seeded[i], i + 1, total);
      }
      setStage('done');
    },
    [router, uploadEntry],
  );

  // ── Retry a single failed upload ──
  const retry = useCallback(
    async (entryId: string) => {
      const entry = entries.find((e) => e.id === entryId);
      if (!entry) return;
      await uploadEntry(entry, 1, 1);
    },
    [entries, uploadEntry],
  );

  // ── Revoke object URLs on unmount ──
  useEffect(() => {
    return () => {
      entries.forEach((e) => {
        try {
          URL.revokeObjectURL(e.previewUrl);
        } catch {
          /* ignore */
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!validReceivingId) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6 text-center">
        <p className="text-sm font-bold text-slate-700">Invalid receiving id</p>
      </div>
    );
  }

  // Pipeline flow (Take Photos CTA from /m/receiving): no requestId, no need
  // for the per-upload Ably publish that the desktop QR-scan flow relies on.
  // Hand off to PhotoCaptureSurface so capture queues into the shared
  // background upload pipe and we return to the recent list immediately —
  // consistent with /m/receiving/po/[poId]/photos.
  if (!requestId) {
    return (
      <PhotoCaptureSurface
        receivingId={receivingId}
        headerLabel={`RCV-${receivingId}`}
        returnHref="/m/receiving"
        maxPhotos={10}
      />
    );
  }

  // ── Stage: camera ──
  if (stage === 'camera') {
    return (
      <MobilePackerSpamCamera
        onDone={handleCameraDone}
        onCancel={() => router.back()}
        maxPhotos={10}
        header={
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-white/60">
              Receiving photos
            </p>
            <p className="truncate text-sm font-black text-white">RCV-{receivingId}</p>
          </div>
        }
      />
    );
  }

  // ── Stage: uploading or done ──
  const successCount = entries.filter((e) => e.state === 'done').length;
  const errorCount = entries.filter((e) => e.state === 'error').length;
  const allDone = stage === 'done' && errorCount === 0;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
          Receiving photos
        </p>
        <h1 className="text-lg font-black text-slate-900">RCV-{receivingId}</h1>
        <p className="mt-1 text-caption font-bold text-slate-600">
          {successCount}/{entries.length} uploaded
          {errorCount > 0 ? ` · ${errorCount} failed` : ''}
        </p>
      </header>

      <main className="flex-1 px-4 py-3 space-y-2 pb-24">
        {entries.map((e, i) => (
          <div
            key={e.id}
            className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2 shadow-sm"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={e.photoUrl ?? e.previewUrl}
              alt={`Photo ${i + 1}`}
              className="h-16 w-16 rounded object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="text-caption font-black uppercase tracking-wider text-slate-600">
                Photo {i + 1}
              </p>
              <p
                className={`mt-0.5 text-caption font-bold ${
                  e.state === 'done'
                    ? 'text-emerald-600'
                    : e.state === 'error'
                    ? 'text-rose-600'
                    : 'text-slate-500'
                }`}
              >
                {e.state === 'uploading' && 'Uploading…'}
                {e.state === 'pending' && 'Queued'}
                {e.state === 'done' && '✓ Uploaded'}
                {e.state === 'error' && `✗ ${e.error || 'Failed'}`}
              </p>
            </div>
            {e.state === 'error' && (
              <button
                type="button"
                onClick={() => retry(e.id)}
                className="rounded-md bg-rose-600 px-3 py-2 text-xs font-bold text-white active:bg-rose-700"
              >
                Retry
              </button>
            )}
          </div>
        ))}
      </main>

      <footer className="sticky bottom-0 bg-white border-t border-slate-200 px-4 py-3">
        {allDone ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setEntries([]);
                setStage('camera');
              }}
              className="rounded-md bg-blue-600 px-4 py-3 text-sm font-bold text-white active:bg-blue-700"
            >
              Take more
            </button>
            <button
              type="button"
              onClick={() => router.replace(`/m/r/${receivingId}`)}
              className="rounded-md bg-slate-900 px-4 py-3 text-sm font-bold text-white active:bg-slate-800"
            >
              Done
            </button>
          </div>
        ) : (
          <p className="text-center text-caption font-bold text-slate-500">
            Hold on — uploading…
          </p>
        )}
      </footer>
    </div>
  );
}

export default function ReceivingPhotosPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <PhotoPageInner />
    </Suspense>
  );
}
