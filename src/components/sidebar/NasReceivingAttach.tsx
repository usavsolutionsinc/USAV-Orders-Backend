'use client';

import { useCallback, useEffect, useState } from 'react';
import { attachNasPhoto, listNasDir, nasConfigured, type NasEntry } from '@/lib/nas-photos';

interface Props {
  /** The receiving package (PO) these photos pair to. */
  receivingId: number;
  /** Called after one or more photos are attached, so the gallery can refetch. */
  onAttached: () => void;
  /** Render as a full-width dropzone-style block (used for the empty state). */
  fullWidth?: boolean;
  /** Button label (defaults to "Select from NAS"). */
  label?: string;
}

/**
 * Desktop "Select from NAS" control for the receiving PO photo strip.
 *
 * Renders a small button; clicking it opens a picker dialog that browses the
 * self-hosted NAS file server (Caddy), lets the operator multi-select recent
 * photos, and pairs them to this receiving package by URL via the existing
 * /api/receiving-photos endpoint. No Vercel Blob / Cloudflare — the photo row
 * just stores the NAS URL, which then renders in the same PhotoGallery and
 * flows into Zendesk claims like any other receiving photo.
 *
 * Hidden entirely unless NEXT_PUBLIC_NAS_PHOTOS_BASE_URL is configured.
 */
export function NasReceivingAttach({ receivingId, onAttached, fullWidth = false, label }: Props) {
  const [open, setOpen] = useState(false);
  if (!nasConfigured()) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Pair photos from the NAS to this PO"
        className={
          fullWidth
            ? 'flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-300 bg-gray-50/60 px-4 py-6 text-caption font-bold uppercase tracking-widest text-gray-500 transition-colors hover:border-blue-300 hover:bg-blue-50/40 hover:text-blue-700'
            : 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-micro font-black uppercase tracking-widest text-gray-700 transition-colors hover:bg-gray-50'
        }
      >
        + {label ?? 'Select from NAS'}
      </button>
      {open ? (
        <NasPickerDialog
          receivingId={receivingId}
          onClose={() => setOpen(false)}
          onAttached={onAttached}
        />
      ) : null}
    </>
  );
}

function NasPickerDialog({
  receivingId,
  onClose,
  onAttached,
}: {
  receivingId: number;
  onClose: () => void;
  onAttached: () => void;
}) {
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

  const toggle = (url: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });

  const goUp = () => {
    const parts = dir.split('/');
    parts.pop();
    setDir(parts.join('/'));
  };

  const handleAttach = async () => {
    if (selected.size === 0) return;
    setAttaching(true);
    setError(null);
    const urls = [...selected];
    const results = await Promise.all(
      urls.map((u) => attachNasPhoto({ receivingId, receivingLineId: null }, u)),
    );
    setAttaching(false);
    const failed = results.filter((r) => !r.ok);
    onAttached(); // some may have succeeded — refresh regardless
    if (failed.length > 0) {
      setError(`${failed.length} of ${urls.length} couldn't be attached. ${failed[0].error ?? ''}`);
      setSelected(new Set(failed.map((f) => f.url))); // keep failures selected to retry
      return;
    }
    onClose();
  };

  const folders = entries.filter((e) => e.type === 'directory');
  const files = entries.filter((e) => e.type === 'file');

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-micro font-black uppercase tracking-[0.18em] text-gray-400">
              Select from NAS · pair to PO
            </p>
            <p className="truncate text-sm font-bold text-gray-800">/{dir || 'Photos'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-micro font-black uppercase tracking-widest text-gray-600 hover:bg-gray-50"
          >
            Close
          </button>
        </div>

        {dir ? (
          <button
            type="button"
            onClick={goUp}
            className="border-b border-gray-100 px-4 py-2 text-left text-micro font-bold uppercase tracking-widest text-blue-600 hover:bg-gray-50"
          >
            ↑ Up a folder
          </button>
        ) : null}

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="aspect-square animate-pulse rounded-lg bg-gray-100" />
              ))}
            </div>
          ) : error ? (
            <div className="py-10 text-center">
              <p className="text-caption font-bold text-rose-600">{error}</p>
              <button
                type="button"
                onClick={() => void load(dir)}
                className="mt-3 rounded-lg border border-gray-200 px-3 py-1.5 text-micro font-black uppercase tracking-widest text-gray-700 hover:bg-gray-50"
              >
                Retry
              </button>
            </div>
          ) : entries.length === 0 ? (
            <p className="py-10 text-center text-caption font-bold uppercase tracking-widest text-gray-400">
              This folder is empty.
            </p>
          ) : (
            <>
              {folders.length > 0 ? (
                <div className="mb-2 divide-y divide-gray-100 rounded-lg border border-gray-100">
                  {folders.map((f) => (
                    <button
                      key={f.relPath}
                      type="button"
                      onClick={() => {
                        setSelected(new Set());
                        setDir(f.relPath);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50"
                    >
                      <span>📁</span>
                      <span className="truncate text-caption font-semibold text-gray-700">
                        {f.name}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              {files.length > 0 ? (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {files.map((f) => {
                    const isSel = selected.has(f.url);
                    return (
                      <button
                        key={f.relPath}
                        type="button"
                        onClick={() => toggle(f.url)}
                        className={`relative aspect-square overflow-hidden rounded-lg ring-2 transition ${
                          isSel ? 'ring-blue-500' : 'ring-transparent hover:ring-gray-200'
                        }`}
                        title={f.name}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={f.url}
                          alt={f.name}
                          loading="lazy"
                          className={`h-full w-full object-cover ${isSel ? 'opacity-70' : ''}`}
                        />
                        {isSel ? (
                          <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-blue-600 text-[11px] font-black text-white">
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

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-3">
          <span className="text-micro font-bold uppercase tracking-widest text-gray-400">
            {selected.size > 0 ? `${selected.size} selected` : 'Tap photos to select'}
          </span>
          <button
            type="button"
            disabled={selected.size === 0 || attaching}
            onClick={handleAttach}
            className="inline-flex h-9 items-center rounded-lg bg-blue-600 px-4 text-caption font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {attaching ? 'Attaching…' : selected.size > 0 ? `Pair ${selected.size} to PO` : 'Pair to PO'}
          </button>
        </div>
      </div>
    </div>
  );
}
