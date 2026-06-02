'use client';

import { useCallback, useEffect, useState } from 'react';
import { listNasDir, nasConfigured, type NasEntry } from '@/lib/nas-photos';

/**
 * /photos — standalone PREVIEW of the NAS photo source.
 *
 * Read-only: it browses the NAS file server (Caddy on the Ugreen) and renders
 * the images directly, so you can confirm the app ↔ NAS path works end to end
 * without going through a receiving package. This is a testing surface — it
 * does NOT attach anything to the database. The real picker
 * (NasPhotoPicker / "NAS" button) is what attaches photos to a PO/item.
 *
 * Requires NEXT_PUBLIC_NAS_PHOTOS_BASE_URL to be set (e.g. in .env.local).
 */
export default function NasPhotosPreviewPage() {
  const [dir, setDir] = useState('');
  const [entries, setEntries] = useState<NasEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<NasEntry | null>(null);

  const configured = nasConfigured();
  const base = process.env.NEXT_PUBLIC_NAS_PHOTOS_BASE_URL || '(unset)';

  const load = useCallback(async (relDir: string) => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await listNasDir(relDir));
    } catch (e) {
      setEntries([]);
      setError(e instanceof Error ? e.message : 'Failed to load folder.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (configured) void load(dir);
    else setLoading(false);
  }, [dir, load, configured]);

  const goUp = () => {
    const parts = dir.split('/');
    parts.pop();
    setDir(parts.join('/'));
  };

  const folders = entries.filter((e) => e.type === 'directory');
  const files = entries.filter((e) => e.type === 'file');

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-white/10 bg-black/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-400">
              NAS Photos · Preview (read-only, no attach)
            </p>
            <p className="truncate text-sm font-black">/{dir || 'Photos'}</p>
          </div>
          <code className="hidden shrink-0 rounded bg-white/10 px-2 py-1 text-[11px] text-white/70 sm:block">
            {base}
          </code>
        </div>
        {dir ? (
          <button
            type="button"
            onClick={goUp}
            className="mt-2 text-xs font-bold uppercase tracking-widest text-blue-400 active:text-blue-300"
          >
            ↑ Up a folder
          </button>
        ) : null}
      </header>

      {/* Body */}
      {!configured ? (
        <div className="px-6 py-16 text-center">
          <p className="text-lg font-black">NAS base URL not set</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-white/60">
            Add{' '}
            <code className="rounded bg-white/10 px-1.5 py-0.5">
              NEXT_PUBLIC_NAS_PHOTOS_BASE_URL
            </code>{' '}
            to <code className="rounded bg-white/10 px-1.5 py-0.5">.env.local</code> and restart the
            dev server.
          </p>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-3 gap-1 p-1 sm:grid-cols-4 md:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded bg-white/5" />
          ))}
        </div>
      ) : error ? (
        <div className="px-6 py-16 text-center">
          <p className="text-label font-bold text-rose-400">{error}</p>
          <button
            type="button"
            onClick={() => void load(dir)}
            className="mt-4 rounded-full bg-white/10 px-4 py-2 text-caption font-black uppercase tracking-widest active:bg-white/20"
          >
            Retry
          </button>
        </div>
      ) : entries.length === 0 ? (
        <p className="px-6 py-16 text-center text-label font-bold text-white/60">
          This folder is empty.
        </p>
      ) : (
        <div className="p-1">
          {/* Folders */}
          {folders.length > 0 ? (
            <div className="mb-1 divide-y divide-white/5 rounded bg-white/[0.03]">
              {folders.map((f) => (
                <button
                  key={f.relPath}
                  type="button"
                  onClick={() => setDir(f.relPath)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-white/5"
                >
                  <span className="text-lg">📁</span>
                  <span className="truncate text-sm font-bold">{f.name}</span>
                </button>
              ))}
            </div>
          ) : null}

          {/* Files */}
          {files.length > 0 ? (
            <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-6">
              {files.map((f) => (
                <button
                  key={f.relPath}
                  type="button"
                  onClick={() => setZoom(f)}
                  className="group relative aspect-square overflow-hidden rounded bg-white/5"
                  title={f.name}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={f.url}
                    alt={f.name}
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover transition group-active:scale-95"
                  />
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[10px] text-white/80">
                    {f.name}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Lightbox */}
      {zoom ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 grid place-items-center bg-black/95 p-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom.url} alt={zoom.name} className="max-h-full max-w-full object-contain" />
          <p className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-4 py-1.5 text-caption font-bold">
            {zoom.name}
          </p>
        </div>
      ) : null}
    </div>
  );
}
