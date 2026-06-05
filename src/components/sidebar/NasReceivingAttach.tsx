'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { RightPaneOverlay } from '@/components/ui/RightPaneOverlay';
import { attachNasPhoto, listNasDir, nasConfigured, type NasEntry } from '@/lib/nas-photos';
import { useNasConfig } from '@/hooks/useNasConfig';
import { useMediaQuery } from '@/hooks/_ui';
import { NasBreadcrumb, NasFolderCard, NasSectionLabel } from '@/components/nas/NasBrowserChrome';

/**
 * Shell for the NAS picker: a centered modal on desktop, a slide-up bottom
 * sheet on mobile (so it stacks naturally over the carton sheet / photo flow).
 */
function NasPickerShell({
  isMobile,
  onClose,
  children,
}: {
  isMobile: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!isMobile) {
    return (
      <RightPaneOverlay
        open
        onClose={onClose}
        align="center"
        closeOnEscape={false}
        aria-label="Select from NAS, pair to PO"
        className="w-[min(92%,42rem)] rounded-2xl border-0 shadow-2xl ring-1 ring-gray-200"
      >
        {children}
      </RightPaneOverlay>
    );
  }
  return createPortal(
    <div className="fixed inset-0 z-[210] flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="Select from NAS, pair to PO">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 32, stiffness: 340 }}
        className="relative flex max-h-[88vh] min-h-0 flex-col rounded-t-2xl bg-white shadow-2xl pb-[env(safe-area-inset-bottom)]"
      >
        <div className="mx-auto mb-1 mt-2 h-1 w-10 shrink-0 rounded-full bg-gray-300" />
        {children}
      </motion.div>
    </div>,
    document.body,
  );
}

type SortKey = 'po' | 'recent' | 'oldest' | 'name';
// Photos shown per page in the picker list (paged to avoid loading every
// full-size NAS image in a large folder at once).
const PAGE_SIZE = 10;
// The "PO scan time" view starts this far BEFORE the scan, then runs forward —
// captures shots taken right as scanning began.
const PO_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

// Parse a NAS entry's mtime to epoch ms. Date.parse handles both the dev
// server's ISO strings and nginx autoindex's RFC-1123 GMT strings, so sorting
// is correct against either backend (a plain lexical compare would not be).
function entryTime(e: NasEntry): number {
  const t = e.mtime ? Date.parse(e.mtime) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

// `anchor` (epoch ms) is the PO scan time. The 'po' view shows photos from 10
// minutes before the scan onward, in chronological order (forward in time), so
// the operator reads the receiving session top-to-bottom as it happened. Photos
// from before that window (earlier sessions) drop below it, newest-first.
function compareEntries(a: NasEntry, b: NasEntry, key: SortKey, anchor: number | null): number {
  if (key === 'name') return a.name.localeCompare(b.name, undefined, { numeric: true });
  const at = entryTime(a);
  const bt = entryTime(b);
  if (key === 'po' && anchor != null) {
    const windowStart = anchor - PO_WINDOW_MS;
    const aIn = at >= windowStart;
    const bIn = bt >= windowStart;
    if (aIn !== bIn) return aIn ? -1 : 1; // in-window photos first
    if (aIn) return at - bt; // within window: ascending (forward in time)
    return bt - at; // before window: newest-first, after the window block
  }
  return key === 'oldest' ? at - bt : bt - at;
}

// Shrink the multi-MB NAS original to a fast thumbnail. Two paths, because the
// source differs by environment:
//   • Public NAS tunnel (absolute https) → the Next.js image optimizer, which
//     downscales to a tiny cached webp. Works because the tunnel is
//     unauthenticated (CORS-open) and its host is allowlisted in next.config
//     `images.remotePatterns`. `size` must be an allowed Next width, and `q`
//     must be an allowed quality — Next 16 rejects anything but 75 by default
//     (q=60 → HTTP 400 / broken image), so keep q=75 unless next.config sets
//     `images.qualities`.
//   • Dev route (/api/nas-dev, same-origin) → fetch directly with ?thumb. The
//     optimizer can't be used here: that route is behind the session auth gate
//     and the optimizer fetches server-side WITHOUT the browser cookie (→ 401,
//     broken image). A direct browser request carries the cookie and the dev
//     route honours ?thumb to downscale.
// The full-res `url` is always what gets attached to the PO.
function thumbUrl(url: string, size = 128): string {
  if (/^https?:\/\//i.test(url)) {
    return `/_next/image?url=${encodeURIComponent(url)}&w=${size}&q=75`;
  }
  return url + (url.includes('?') ? '&' : '?') + `thumb=${size}`;
}

function formatMtime(mtime?: string): string {
  if (!mtime) return '';
  const t = Date.parse(mtime);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function sortOptions(hasAnchor: boolean): { value: SortKey; label: string }[] {
  return [
    { value: 'recent', label: 'Most recent' },
    ...(hasAnchor ? [{ value: 'po' as const, label: 'PO scan time' }] : []),
    { value: 'oldest', label: 'Oldest' },
    { value: 'name', label: 'Name (A–Z)' },
  ];
}

interface Props {
  /** The receiving package (PO) these photos pair to. */
  receivingId: number;
  /**
   * When this PO was scanned (ISO). When provided, the picker defaults to a
   * "PO scan time" sort so photos taken around the scan surface first.
   */
  poCreatedAt?: string | null;
  /**
   * Folder the picker opens to (relative path, "" = root). Admin-configured per
   * station — see StationNasFoldersTab. Lets a receiving station land directly
   * in, e.g., "JUN 2026" instead of the root.
   */
  initialFolder?: string;
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
export function NasReceivingAttach({ receivingId, poCreatedAt = null, initialFolder = '', onAttached, fullWidth = false, label }: Props) {
  const [open, setOpen] = useState(false);
  // Seed the active NAS base URL at runtime (admin test/prod setting) so the
  // control appears and Browse works even when the build has no NAS env var.
  useNasConfig();
  if (!nasConfigured()) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Pair photos from the NAS to this PO"
        className={
          fullWidth
            ? 'flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 bg-gray-50/60 px-3 text-micro font-bold uppercase tracking-widest text-gray-500 transition-colors hover:border-blue-300 hover:bg-blue-50/40 hover:text-blue-700'
            : 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-micro font-black uppercase tracking-widest text-gray-700 transition-colors hover:bg-gray-50'
        }
      >
        + {label ?? 'Select from NAS'}
      </button>
      {open ? (
        <NasPickerDialog
          receivingId={receivingId}
          poCreatedAt={poCreatedAt}
          initialFolder={initialFolder}
          onClose={() => setOpen(false)}
          onAttached={onAttached}
        />
      ) : null}
    </>
  );
}

function NasPickerDialog({
  receivingId,
  poCreatedAt,
  initialFolder,
  onClose,
  onAttached,
}: {
  receivingId: number;
  poCreatedAt: string | null;
  initialFolder: string;
  onClose: () => void;
  onAttached: () => void;
}) {
  // PO scan time as epoch ms (null when unknown / unparseable).
  const anchor = useMemo(() => {
    if (!poCreatedAt) return null;
    const t = Date.parse(poCreatedAt);
    return Number.isNaN(t) ? null : t;
  }, [poCreatedAt]);
  const options = useMemo(() => sortOptions(anchor != null), [anchor]);

  // Open straight to the station's configured folder (admin setting), trimming
  // any stray slashes. Falls back to the root when unset.
  const [dir, setDir] = useState(() => (initialFolder || '').replace(/^\/+|\/+$/g, ''));
  const [entries, setEntries] = useState<NasEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Anchor for shift-click range selection (the last row clicked without shift).
  const [anchorUrl, setAnchorUrl] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  // Larger preview opened by clicking a row's thumbnail (null = closed).
  const [preview, setPreview] = useState<NasEntry | null>(null);
  // Default to newest-first. "PO scan time" stays available as an option when
  // the scan time is known, but most-recent is the default view.
  const [sortKey, setSortKey] = useState<SortKey>('recent');
  const [page, setPage] = useState(0);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  // Viewport-based (not UA) so the bottom-sheet reliably triggers on phones —
  // UA detection was returning desktop and falling back to the centered modal.
  const isMobile = useMediaQuery('(max-width: 767px)');

  // Portal target for the preview lightbox (RightPaneOverlay handles its own).
  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  // Esc closes the preview lightbox first (if open), otherwise the whole picker.
  // onClose is read through a ref so its changing identity doesn't re-subscribe
  // the listener (and keeps the dep array stable).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (preview) setPreview(null);
      else onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

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

  // Row click: plain click toggles + sets the anchor; shift-click applies the
  // anchor's current state to the whole range (within the current page), like a
  // file manager — so it selects OR deselects a range. To bulk-deselect: click a
  // selected row (toggles it off → anchor), then shift-click the range end.
  const handleRowSelect = (url: string, shiftKey: boolean) => {
    if (shiftKey && anchorUrl) {
      const a = pagedFiles.findIndex((f) => f.url === anchorUrl);
      const b = pagedFiles.findIndex((f) => f.url === url);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = pagedFiles.slice(lo, hi + 1).map((f) => f.url);
        const fillSelected = selected.has(anchorUrl); // match the anchor's state
        setSelected((prev) => {
          const next = new Set(prev);
          for (const u of range) {
            if (fillSelected) next.add(u);
            else next.delete(u);
          }
          return next;
        });
        return; // keep the existing anchor for further range extension
      }
    }
    toggle(url);
    setAnchorUrl(url);
  };

  // Navigating folders drops the current selection (the chosen URLs belong to
  // the folder you're leaving) and resets to the first page.
  const navigate = useCallback((relDir: string) => {
    setSelected(new Set());
    setAnchorUrl(null);
    setPage(0);
    setDir(relDir);
  }, []);

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

  const folders = useMemo(
    () => entries.filter((e) => e.type === 'directory').sort((a, b) => compareEntries(a, b, sortKey, anchor)),
    [entries, sortKey, anchor],
  );
  const files = useMemo(
    () => entries.filter((e) => e.type === 'file').sort((a, b) => compareEntries(a, b, sortKey, anchor)),
    [entries, sortKey, anchor],
  );

  const pageCount = Math.max(1, Math.ceil(files.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1); // clamp if the folder shrank
  const pagedFiles = files.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <>
      <NasPickerShell isMobile={isMobile} onClose={onClose}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-micro font-black uppercase tracking-[0.18em] text-gray-400">
              Select from NAS · pair to PO
            </p>
            <p className="truncate text-sm font-bold text-gray-800">/{dir || 'Photos'}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label className="flex items-center gap-1.5">
              <span className="text-micro font-black uppercase tracking-widest text-gray-400">Sort</span>
              <select
                value={sortKey}
                onChange={(e) => {
                  setSortKey(e.target.value as SortKey);
                  setPage(0);
                }}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-micro font-bold uppercase tracking-wider text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-micro font-black uppercase tracking-widest text-gray-600 hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>

        {dir || pageCount > 1 ? (
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2">
            <div className="min-w-0 flex-1 overflow-x-auto">
              <NasBreadcrumb dir={dir} onNavigate={navigate} />
            </div>
            {pageCount > 1 ? (
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Previous page"
                  disabled={safePage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-sm font-black text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ‹
                </button>
                <span className="text-micro font-bold uppercase tracking-widest tabular-nums text-gray-400">
                  {safePage + 1} / {pageCount}
                </span>
                <button
                  type="button"
                  aria-label="Next page"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-sm font-black text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ›
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="space-y-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-gray-100 px-2 py-1.5">
                  <div className="h-10 w-10 shrink-0 animate-pulse rounded-md bg-gray-100" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-2/3 animate-pulse rounded bg-gray-100" />
                    <div className="h-2 w-1/3 animate-pulse rounded bg-gray-100" />
                  </div>
                </div>
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
            <div className="space-y-3">
              {folders.length > 0 ? (
                <div className="space-y-1.5">
                  <NasSectionLabel>
                    Folders · {folders.length}
                  </NasSectionLabel>
                  {folders.map((f) => (
                    <NasFolderCard key={f.relPath} name={f.name} onOpen={() => navigate(f.relPath)} />
                  ))}
                </div>
              ) : null}

              {files.length > 0 ? (
                <div className="space-y-1.5">
                  <NasSectionLabel>
                    Photos · {files.length}
                  </NasSectionLabel>
                  <div className="space-y-1">
                  {pagedFiles.map((f) => {
                    const isSel = selected.has(f.url);
                    return (
                      <div
                        key={f.relPath}
                        className={`flex w-full items-center gap-3 rounded-lg border px-2 py-1.5 transition ${
                          isSel
                            ? 'border-blue-400 bg-blue-50/60 ring-1 ring-inset ring-blue-200'
                            : 'border-gray-100 hover:bg-gray-50'
                        }`}
                      >
                        {/* Thumbnail → open a larger preview (doesn't select). */}
                        <button
                          type="button"
                          onClick={() => setPreview(f)}
                          className="shrink-0 overflow-hidden rounded-md ring-1 ring-inset ring-gray-200 transition hover:ring-blue-300"
                          title="Preview"
                          aria-label={`Preview ${f.name}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={thumbUrl(f.url)}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="h-10 w-10 bg-gray-100 object-cover"
                          />
                        </button>
                        {/* Rest of the row → toggle selection (shift-click = range). */}
                        <button
                          type="button"
                          onClick={(e) => handleRowSelect(f.url, e.shiftKey)}
                          className="flex min-w-0 flex-1 select-none items-center gap-3 text-left"
                          title={isSel ? 'Deselect' : 'Select · Shift-click for a range'}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-caption font-semibold text-gray-800">{f.name}</p>
                            <p className="text-micro font-medium text-gray-400">{formatMtime(f.mtime)}</p>
                          </div>
                          <span
                            className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] font-black transition ${
                              isSel ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 text-transparent'
                            }`}
                          >
                            ✓
                          </span>
                        </button>
                      </div>
                    );
                  })}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-3">
          <span className="text-micro font-bold uppercase tracking-widest text-gray-400">
            {selected.size > 0 ? `${selected.size} selected` : 'Tap to select · Shift-click for a range'}
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
      </NasPickerShell>

      {/* Larger preview lightbox (opened from a row's thumbnail). A 1080px webp
          via the optimizer — crisp but still far smaller than the original.
          Portaled to <body> so it escapes the workspace's framer transforms. */}
      {preview && portalTarget ? createPortal((
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[130] flex flex-col items-center justify-center gap-3 bg-black/85 p-4"
          onClick={() => setPreview(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbUrl(preview.url, 1080)}
            alt={preview.name}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[82vh] max-w-full rounded-lg object-contain shadow-2xl"
          />
          <div className="flex items-center gap-3 rounded-full bg-white/10 px-4 py-1.5 text-center backdrop-blur">
            <span className="truncate text-caption font-bold text-white">{preview.name}</span>
            <span className="text-micro font-medium text-white/60">{formatMtime(preview.mtime)}</span>
          </div>
          <button
            type="button"
            onClick={() => setPreview(null)}
            className="absolute right-4 top-4 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-micro font-black uppercase tracking-widest text-white hover:bg-white/20"
          >
            Close
          </button>
        </div>
      ), portalTarget) : null}
    </>
  );
}
