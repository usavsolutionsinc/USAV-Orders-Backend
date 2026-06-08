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
import { useNasConfig } from '@/hooks/useNasConfig';
import { attachNasPhoto, buildNasPhotoUrl, getNasBaseUrl, putNasPhoto } from '@/lib/nas-photos';

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
  // Title to show in the camera header — the PO title / "Unfound PO". When the
  // entry point (carton sheet, share-to-phone) passes ?title= we use it
  // verbatim; otherwise (desktop QR `requestId` flow, deep links) we resolve it
  // from the receiving id so the camera never leaks the internal "RCV-<id>".
  const titleParam = (searchParams.get('title') || '').trim();
  // Human PO# used to name the saved NAS file (falls back to the package id).
  const poRefParam = (searchParams.get('poRef') || '').trim() || null;
  // Title/PO# resolved from the receiving id when not supplied via the URL.
  const [resolved, setResolved] = useState<{ title: string; poRef: string | null } | null>(null);
  const cameraTitle = titleParam || resolved?.title || `RCV-${receivingId}`;
  const poRef = poRefParam || resolved?.poRef || null;
  const { getClient } = useAblyClient();
  // Active NAS (test/prod) + this operator's folder — captured photos write
  // straight to the NAS share, no Vercel Blob.
  const nas = useNasConfig();

  const [stage, setStage] = useState<'camera' | 'uploading' | 'done'>('camera');
  const [entries, setEntries] = useState<UploadEntry[]>([]);

  const validReceivingId = Number.isFinite(receivingId) && receivingId > 0;

  // ── Resolve the PO title from the receiving id when the URL didn't carry one.
  // Mirrors the receiving rail's precedence (item_name → catalog title → sku →
  // zoho_item_id), and "Unfound PO" arrives as item_name for unmatched cartons.
  useEffect(() => {
    if (titleParam || !validReceivingId) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/receiving-lines?receiving_id=${receivingId}&limit=1`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const body = await res.json();
        if (!alive) return;
        const line = body?.receiving_lines?.[0];
        if (line) {
          const title = String(
            line.item_name || line.catalog_product_title || line.sku || line.zoho_item_id || '',
          ).trim();
          const po =
            line.zoho_purchaseorder_number || line.receiving_zoho_purchaseorder_number || null;
          if (title) setResolved({ title, poRef: po });
        } else if (body?.receiving_package) {
          // Carton exists but has no matched PO lines → an unmatched/unfound
          // carton. The `?receiving_id=` endpoint doesn't synthesise the
          // "Unfound PO" placeholder (only the list views do), so label it here
          // to match exactly what the receiving rail shows for these cartons.
          setResolved({ title: 'Unfound PO', poRef: null });
        }
      } catch {
        /* best-effort — fall back to RCV-<id> */
      }
    })();
    return () => {
      alive = false;
    };
  }, [titleParam, receivingId, validReceivingId]);

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
        const baseUrl = nas?.baseUrl || getNasBaseUrl();
        if (!baseUrl) {
          throw new Error('NAS not configured — set the NAS address in Admin → Receiving Photos.');
        }
        // Defense-in-depth: shots from MobilePackerSpamCamera are already
        // compressed, but if this page is ever entered with a raw blob the
        // helper short-circuits via its passthrough for already-small files.
        const compressed = await compressPhotoForUpload(entry.blob, { source: 'm-receiving' });
        const scope = { receivingId, poRef };
        const targetUrl = buildNasPhotoUrl({
          baseUrl,
          folder: nas?.folder ?? '',
          scope,
          filename: `photo_${entry.id}.jpg`,
        });
        const put = await putNasPhoto(targetUrl, compressed.blob);
        if (!put.ok) throw new Error(put.error || 'NAS write failed');
        const attach = await attachNasPhoto(scope, put.url);
        if (!attach.ok) throw new Error(attach.error || 'Failed to link photo to PO');
        const photoId = attach.photoId ?? 0;
        const photoUrl = put.url;
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
    [publishUpload, receivingId, staffId, nas, poRef],
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
        headerLabel={cameraTitle}
        poRef={poRef}
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
            <p className="text-micro font-black uppercase tracking-[0.22em] text-white/60">
              Add unboxing photos
            </p>
            <p className="truncate text-sm font-black text-white">{cameraTitle}</p>
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
