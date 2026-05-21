'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  MobilePackerSpamCamera,
  type CapturedShot,
} from '@/components/mobile/station/MobilePackerSpamCamera';

type UploadState = 'pending' | 'uploading' | 'done' | 'error';

interface UploadEntry {
  id: string;
  blob: Blob;
  previewUrl: string;
  state: UploadState;
  photoUrl: string | null;
  error: string | null;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function PhotoPageInner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const packerLogId = Number(params?.id);
  const orderIdParam = searchParams.get('orderId') || `PL-${packerLogId}`;
  const { user } = useAuth();
  const staffId = user?.staffId ?? 0;

  const [stage, setStage] = useState<'camera' | 'uploading' | 'done'>('camera');
  const [entries, setEntries] = useState<UploadEntry[]>([]);

  const validPackerLogId = Number.isFinite(packerLogId) && packerLogId > 0;

  const uploadEntry = useCallback(
    async (entry: UploadEntry, photoIndex: number) => {
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, state: 'uploading', error: null } : e)),
      );
      try {
        const base64 = await blobToBase64(entry.blob);
        const res = await fetch('/api/packing-logs/save-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            photo: base64,
            orderId: orderIdParam,
            photoIndex,
            packerLogId,
            photoType: 'PACK',
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        const photoUrl = String(data?.url ?? data?.photoUrl ?? data?.photo?.url ?? '');
        setEntries((prev) =>
          prev.map((e) =>
            e.id === entry.id ? { ...e, state: 'done', photoUrl, error: null } : e,
          ),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'upload failed';
        setEntries((prev) =>
          prev.map((e) => (e.id === entry.id ? { ...e, state: 'error', error: message } : e)),
        );
      }
    },
    [orderIdParam, packerLogId],
  );

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
        photoUrl: null,
        error: null,
      }));
      setEntries(seeded);
      setStage('uploading');
      for (let i = 0; i < seeded.length; i++) {
        await uploadEntry(seeded[i], i);
      }
      setStage('done');
    },
    [router, uploadEntry],
  );

  const retry = useCallback(
    async (entryId: string) => {
      const idx = entries.findIndex((e) => e.id === entryId);
      if (idx < 0) return;
      await uploadEntry(entries[idx], idx);
    },
    [entries, uploadEntry],
  );

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

  void staffId;

  if (!validPackerLogId) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6 text-center">
        <p className="text-sm font-bold text-slate-700">Invalid packer log id</p>
      </div>
    );
  }

  if (stage === 'camera') {
    return (
      <MobilePackerSpamCamera
        onDone={handleCameraDone}
        onCancel={() => router.back()}
        maxPhotos={10}
        header={
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-white/60">
              Pack photos
            </p>
            <p className="truncate text-[13px] font-black text-white">PL-{packerLogId}</p>
          </div>
        }
      />
    );
  }

  const successCount = entries.filter((e) => e.state === 'done').length;
  const errorCount = entries.filter((e) => e.state === 'error').length;
  const allDone = stage === 'done' && errorCount === 0;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
          Pack photos
        </p>
        <h1 className="text-lg font-black text-slate-900">PL-{packerLogId}</h1>
        <p className="mt-1 text-[11px] font-bold text-slate-600">
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
              <p className="text-[11px] font-black uppercase tracking-wider text-slate-600">
                Photo {i + 1}
              </p>
              <p
                className={`mt-0.5 text-[11px] font-bold ${
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
              onClick={() => router.replace('/packer')}
              className="rounded-md bg-slate-900 px-4 py-3 text-sm font-bold text-white active:bg-slate-800"
            >
              Done
            </button>
          </div>
        ) : (
          <p className="text-center text-[11px] font-bold text-slate-500">
            Hold on — uploading…
          </p>
        )}
      </footer>
    </div>
  );
}

export default function PackerPhotosPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <PhotoPageInner />
    </Suspense>
  );
}
