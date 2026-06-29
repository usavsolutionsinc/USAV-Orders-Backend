'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/design-system/primitives';
import {
  attachNasPhoto,
  listNasDir,
  type NasEntry,
} from '@/lib/nas-photos';
import type { PhotoScope } from '@/components/mobile/receiving/PhotoUploadQueue';

interface NasPhotoPickerProps {
  scope: PhotoScope;
  /** Closes the picker. */
  onClose: () => void;
  /** Called after one or more photos are attached, so the gallery can refetch. */
  onAttached: () => void;
}

/**
 * Full-screen modal that browses the receiving NAS folder via GET /api/nas
 * (same-origin proxy) and attaches selected files to the current scope.
 *
 * No camera — selected URLs are linked through POST /api/receiving-photos.
 */
export function NasPhotoPicker({ scope, onClose, onAttached }: NasPhotoPickerProps) {
  const [dir, setDir] = useState('');
  const [entries, setEntries] = useState<NasEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [attaching, setAttaching] = useState(false);

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
    void load(dir);
  }, [dir, load]);

  const toggle = (url: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const goUp = () => {
    if (!dir) return;
    const parts = dir.split('/');
    parts.pop();
    setDir(parts.join('/'));
  };

  const handleAttach = async () => {
    if (selected.size === 0) return;
    setAttaching(true);
    setError(null);
    const urls = [...selected];
    const results = await Promise.all(urls.map((u) => attachNasPhoto(scope, u)));
    const failed = results.filter((r) => !r.ok);
    setAttaching(false);

    if (failed.length > 0) {
      setError(`${failed.length} of ${urls.length} couldn't be attached. ${failed[0].error ?? ''}`);
      // Keep only the failures selected so the receiver can retry them.
      setSelected(new Set(failed.map((f) => f.url)));
      onAttached(); // some may have succeeded — refresh anyway
      return;
    }
    onAttached();
    onClose();
  };

  const folders = entries.filter((e) => e.type === 'directory');
  const files = entries.filter((e) => e.type === 'file');

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-modal flex flex-col bg-black text-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <p className="text-micro font-black uppercase tracking-[0.22em] text-white/60">
            Select from NAS
          </p>
          <p className="truncate text-sm font-black text-white">/{dir || 'Photos'}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          className="h-auto rounded-full bg-white/10 px-3.5 py-2 text-caption font-black uppercase tracking-widest text-white hover:bg-white/20 hover:text-white active:bg-white/20"
        >
          Close
        </Button>
      </div>

      {/* Breadcrumb / up */}
      {dir ? (
        // ds-raw-button: full-width text-left breadcrumb row (not a label/icon button)
        <button
          type="button"
          onClick={goUp}
          className="border-b border-white/10 px-4 py-2 text-left text-caption font-bold uppercase tracking-widest text-blue-400 active:bg-white/5"
        >
          ↑ Up a folder
        </button>
      ) : null}

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="grid grid-cols-3 gap-0.5 p-0.5">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="aspect-square animate-pulse bg-gray-900" />
            ))}
          </div>
        ) : error ? (
          <div className="px-6 py-12 text-center">
            <p className="text-label font-bold text-rose-400">{error}</p>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void load(dir)}
              className="mt-4 h-auto rounded-full bg-white/10 px-4 py-2 text-caption font-black uppercase tracking-widest text-white hover:bg-white/20 hover:text-white active:bg-white/20"
            >
              Retry
            </Button>
          </div>
        ) : entries.length === 0 ? (
          <p className="px-6 py-12 text-center text-label font-bold text-white/70">
            This folder is empty.
          </p>
        ) : (
          <>
            {/* Folders */}
            {folders.length > 0 ? (
              <div className="divide-y divide-white/5">
                {folders.map((f) => (
                  <button
                    key={f.relPath}
                    type="button"
                    onClick={() => setDir(f.relPath)}
                    className="ds-raw-button flex w-full items-center gap-3 px-4 py-3 text-left active:bg-white/5"
                  >
                    <span className="text-lg">📁</span>
                    <span className="truncate text-sm font-bold">{f.name}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {/* Files */}
            {files.length > 0 ? (
              <div className="grid grid-cols-3 gap-0.5 bg-black p-0.5">
                {files.map((f) => {
                  const isSel = selected.has(f.url);
                  return (
                    <button
                      key={f.relPath}
                      type="button"
                      onClick={() => toggle(f.url)}
                      className="ds-raw-button relative aspect-square bg-gray-900"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={f.url}
                        alt={f.name}
                        loading="lazy"
                        className={`absolute inset-0 h-full w-full object-cover ${isSel ? 'opacity-50' : ''}`}
                      />
                      {isSel ? (
                        <span className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-blue-600 text-xs font-black text-white">
                          ✓
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Footer action */}
      <div className="border-t border-white/10 p-3">
        <Button
          variant="primary"
          disabled={selected.size === 0 || attaching}
          onClick={handleAttach}
          className="w-full rounded-full px-4 py-3"
        >
          {attaching
            ? 'Attaching…'
            : selected.size === 0
              ? 'Select photos'
              : `Attach ${selected.size} photo${selected.size === 1 ? '' : 's'}`}
        </Button>
      </div>
    </div>
  );
}
