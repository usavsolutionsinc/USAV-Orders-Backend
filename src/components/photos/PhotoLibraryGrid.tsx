'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import type { LibraryPhoto } from './photo-library-types';
import { Check, Folder, Layers } from '@/components/Icons';
import { formatDateTimePST } from '@/utils/date';
import type { PhotoLibrarySourceScope, PhotoLibraryViewMode } from '@/lib/photos/library-filter-state';
import { usePhotoGallery } from '@/components/shipped/photo-gallery/usePhotoGallery';
import { PhotoViewerModal } from '@/components/shipped/photo-gallery/PhotoViewerModal';
import type { PhotoGalleryInput, PhotoMeta } from '@/components/shipped/photo-gallery/photo-gallery-utils';
import { useZendeskTicketSubject } from '@/hooks/useZendeskTicketSubject';
import { cn } from '@/utils/_cn';

/**
 * Ticket-number grouping key for a photo. `poRef` is the denormalized ticket
 * reference stamped on every row at upload time (PO ref for receiving, order/
 * scan ref for packing, unit/sku ref for serial units — see
 * `lib/photos/resolve-po-ref.ts`). Photos with no ref fall into an "Unlinked"
 * bucket so they stay visible rather than disappearing from the grouped view.
 */
const UNLINKED_TICKET_KEY = '__unlinked__';

interface TicketGroup {
  key: string;
  /** Display label for the ticket header (the ticket number, or "Unlinked"). */
  label: string;
  photos: LibraryPhoto[];
  /** Most-recent capture in the group, for the header timestamp. */
  latestAt: string;
}

/** Group photos by ticket number (`poRef`), preserving the incoming sort order. */
function groupPhotosByTicket(photos: LibraryPhoto[]): TicketGroup[] {
  const order: string[] = [];
  const map = new Map<string, TicketGroup>();
  for (const photo of photos) {
    const ref = photo.poRef?.trim();
    const key = ref || UNLINKED_TICKET_KEY;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        label: ref || 'Unlinked',
        photos: [],
        latestAt: photo.createdAt,
      };
      map.set(key, group);
      order.push(key);
    }
    group.photos.push(photo);
    if (photo.createdAt > group.latestAt) group.latestAt = photo.createdAt;
  }
  return order.map((key) => map.get(key)!);
}

interface PhotoLibraryGridProps {
  photos: LibraryPhoto[];
  view: PhotoLibraryViewMode;
  /** Source scope drives folder labels (PO# for unboxing, Order# for packing). */
  sourceScope?: PhotoLibrarySourceScope;
  selectMode: boolean;
  selected: Set<number>;
  onToggleSelect: (id: number) => void;
  /** Called after a photo is deleted from the folder viewer so the list refreshes. */
  onPhotoDeleted?: (photoId: number) => void;
  isLoading: boolean;
  error: string | null;
}

function photoFileName(photo: LibraryPhoto): string {
  if (photo.poRef) return `PO-${photo.poRef}-${photo.id}.jpg`;
  const type = photo.photoType?.toLowerCase().replace(/_/g, '-') ?? 'photo';
  return `${type}-${photo.id}.jpg`;
}

function photoPrimaryLabel(photo: LibraryPhoto): string {
  if (photo.poRef) return `PO ${photo.poRef}`;
  return photo.photoType?.replace(/_/g, ' ').toLowerCase() ?? `Photo ${photo.id}`;
}

/** Project a `LibraryPhoto` into the gallery's context-panel meta. */
function libraryPhotoMeta(photo: LibraryPhoto, scope: PhotoLibrarySourceScope): PhotoMeta {
  return {
    poRef: photo.poRef,
    photoType: photo.photoType,
    ticketId: photo.ticketId ?? null,
    takenByStaffId: photo.takenByStaffId ?? null,
    takenByStaffName: photo.takenByStaffName ?? null,
    createdAt: photo.createdAt,
    damageDetected: photo.damageDetected ?? null,
    hasAnalysis: photo.hasAnalysis ?? null,
    caption: photo.caption ?? null,
    sourceScope: scope,
  };
}

/** Gallery inputs for a list of library photos, carrying full panel context. */
function toGalleryInputs(photos: LibraryPhoto[], scope: PhotoLibrarySourceScope): PhotoGalleryInput[] {
  return photos.map((p) => ({ id: p.id, url: p.displayUrl, meta: libraryPhotoMeta(p, scope) }));
}

function SelectionMark({
  checked,
}: {
  checked: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute left-2 top-2 z-20 inline-flex h-6 w-6 items-center justify-center rounded-full border shadow-sm transition',
        checked
          ? 'border-blue-600 bg-blue-600 text-white'
          : 'border-white/80 bg-white/90 text-gray-400 backdrop-blur-sm hover:border-blue-200 hover:text-blue-600',
      )}
    >
      <Check className="h-3.5 w-3.5 stroke-[2.5]" />
    </span>
  );
}

export function PhotoLibraryGrid({
  photos,
  view,
  sourceScope = 'all',
  selectMode,
  selected,
  onToggleSelect,
  onPhotoDeleted,
  isLoading,
  error,
}: PhotoLibraryGridProps) {
  // The folders view owns its own per-folder viewer; the flat views (list,
  // grid, grid-ticket) share one page-level lightbox opened at the clicked
  // photo. Gallery inputs carry full context so the viewer's info panel works.
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const galleryInputs = useMemo(() => toGalleryInputs(photos, sourceScope), [photos, sourceScope]);
  const indexById = useMemo(
    () => new Map(photos.map((p, i) => [p.id, i] as const)),
    [photos],
  );
  const openAt = (id: number) => setOpenIndex(indexById.get(id) ?? 0);

  // Rendered inside each flat-view branch (folders excluded). Mounts lazily so
  // images preload only once a photo is actually opened.
  const lightbox =
    openIndex !== null ? (
      <LightboxPortal
        photos={galleryInputs}
        startIndex={openIndex}
        onClose={() => setOpenIndex(null)}
        onPhotoDeleted={onPhotoDeleted}
      />
    ) : null;

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading photos…</p>;
  }
  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }
  if (photos.length === 0) {
    return <p className="text-sm text-muted-foreground">No photos match these filters.</p>;
  }

  if (view === 'list') {
    return (
      <>
      <ul className="divide-y divide-gray-100 rounded-lg border border-border bg-card">
        {photos.map((photo) => {
          const isSelected = selected.has(photo.id);
          const takenAt = formatDateTimePST(photo.createdAt);
          const fileName = photoFileName(photo);
          const rowBody = (
            <>
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                {selectMode ? <SelectionMark checked={isSelected} /> : null}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.thumbUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{fileName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {photoPrimaryLabel(photo)}
                  {photo.damageDetected ? ' · damage' : ''}
                  {photo.hasAnalysis && !photo.damageDetected ? ' · analyzed' : ''}
                </p>
              </div>
              <time className="shrink-0 text-xs tabular-nums text-muted-foreground">{takenAt}</time>
            </>
          );
          return (
            <li key={photo.id}>
              {selectMode ? (
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2.5 text-left',
                    isSelected && 'bg-blue-50/50',
                  )}
                  onClick={() => onToggleSelect(photo.id)}
                >
                  {rowBody}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => openAt(photo.id)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50',
                    isSelected && 'bg-blue-50/50',
                  )}
                >
                  {rowBody}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {lightbox}
      </>
    );
  }

  // Folders: one collapsed folder per group (PO# for unboxing, order# for
  // packing, Zendesk ticket for claims) — open a folder to browse its photos in
  // the shared fullscreen viewer.
  if (view === 'folders') {
    return (
      <FoldersView
        photos={photos}
        scope={sourceScope}
        selectMode={selectMode}
        onPhotoDeleted={onPhotoDeleted}
      />
    );
  }

  // Group-by-ticket: stack ticket sections, each a labeled header + a tight grid
  // of its photos. The grouping key is `poRef` (the ticket number).
  if (view === 'grid-ticket') {
    const groups = groupPhotosByTicket(photos);
    return (
      <>
      <div className="space-y-5">
        {groups.map((group) => (
          <section key={group.key}>
            <header className="mb-2 flex items-center gap-2 border-b border-gray-100 pb-1.5">
              <Layers className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              <span className="truncate text-sm font-semibold text-gray-900">
                {group.key === UNLINKED_TICKET_KEY ? group.label : `Ticket ${group.label}`}
              </span>
              <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-gray-500">
                {group.photos.length}
              </span>
              <time className="ml-auto shrink-0 text-[10px] tabular-nums text-gray-400">
                {formatDateTimePST(group.latestAt)}
              </time>
            </header>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-8">
              {group.photos.map((photo) => (
                <PhotoCard
                  key={photo.id}
                  photo={photo}
                  imageUrl={photo.thumbUrl}
                  showLabel={false}
                  selectMode={selectMode}
                  selected={selected.has(photo.id)}
                  onToggleSelect={onToggleSelect}
                  onOpen={() => openAt(photo.id)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
      {lightbox}
      </>
    );
  }

  const gridClass =
    view === 'grid-sm'
      ? 'grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-8'
      : 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6';

  return (
    <>
    <div className={gridClass}>
      {photos.map((photo) => (
        <PhotoCard
          key={photo.id}
          photo={photo}
          imageUrl={view === 'grid-sm' || view === 'grid-lg' ? photo.displayUrl : photo.thumbUrl}
          showLabel
          selectMode={selectMode}
          selected={selected.has(photo.id)}
          onToggleSelect={onToggleSelect}
          onOpen={() => openAt(photo.id)}
        />
      ))}
    </div>
    {lightbox}
    </>
  );
}

/** A single tile — image + optional label footer — shared by every grid view. */
function PhotoCard({
  photo,
  imageUrl,
  showLabel,
  selectMode,
  selected,
  onToggleSelect,
  onOpen,
}: {
  photo: LibraryPhoto;
  imageUrl: string;
  showLabel: boolean;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: number) => void;
  /** Open the shared fullscreen viewer at this photo (flat views only). */
  onOpen?: () => void;
}) {
  const cardBody = (
    <>
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {selectMode ? <SelectionMark checked={selected} /> : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={photo.poRef ? `PO ${photo.poRef}` : `Photo ${photo.id}`}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>
      {showLabel ? (
        <div className="flex items-start justify-between gap-2 px-2.5 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-semibold text-gray-900">
              {photoPrimaryLabel(photo)}
            </div>
            <div className="truncate text-[10px] text-gray-500">{formatDateTimePST(photo.createdAt)}</div>
          </div>
        </div>
      ) : null}
    </>
  );
  return (
    <div
      className={cn(
        'group overflow-hidden rounded-lg border bg-white text-left transition-colors',
        selected ? 'border-primary ring-2 ring-primary' : 'border-border',
        selectMode && 'cursor-pointer hover:border-primary/70 hover:bg-slate-50',
      )}
    >
      {selectMode ? (
        <button
          type="button"
          className="block w-full text-left"
          onClick={() => onToggleSelect(photo.id)}
        >
          {cardBody}
        </button>
      ) : onOpen ? (
        <button type="button" data-testid="photo-tile" className="block w-full text-left" onClick={onOpen}>
          {cardBody}
        </button>
      ) : (
        <a href={photo.displayUrl} target="_blank" rel="noreferrer" className="block">
          {cardBody}
        </a>
      )}
    </div>
  );
}

// ── Folders view ──────────────────────────────────────────────────────────────

interface PhotoFolder {
  key: string;
  poRef: string | null;
  ticketId: number | null;
  cover: LibraryPhoto;
  photos: LibraryPhoto[];
  latestAt: string;
}

const UNLINKED_FOLDER_KEY = '__unlinked__';

/**
 * Bucket photos into folders. Claims (Zendesk) group by linked ticket id;
 * everything else groups by `poRef` (PO# for receiving, order#/scan ref for
 * packing). Photos with no key fall into a single "Unlinked" folder.
 */
function groupPhotosIntoFolders(
  photos: LibraryPhoto[],
  scope: PhotoLibrarySourceScope,
): PhotoFolder[] {
  const order: string[] = [];
  const map = new Map<string, PhotoFolder>();
  for (const photo of photos) {
    const ticketId = photo.ticketId ?? null;
    const useTicket = scope === 'claims' && ticketId != null;
    const ref = photo.poRef?.trim();
    const key = useTicket ? `t:${ticketId}` : ref ? `po:${ref}` : UNLINKED_FOLDER_KEY;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        poRef: useTicket ? null : ref || null,
        ticketId: useTicket ? ticketId : null,
        cover: photo,
        photos: [],
        latestAt: photo.createdAt,
      };
      map.set(key, group);
      order.push(key);
    }
    group.photos.push(photo);
    if (photo.createdAt > group.latestAt) group.latestAt = photo.createdAt;
  }
  return order.map((key) => map.get(key)!);
}

function folderRefLabel(poRef: string, scope: PhotoLibrarySourceScope): string {
  if (scope === 'unboxing') return `PO ${poRef}`;
  if (scope === 'packing') return `Order ${poRef}`;
  return `#${poRef}`;
}

function FoldersView({
  photos,
  scope,
  selectMode,
  onPhotoDeleted,
}: {
  photos: LibraryPhoto[];
  scope: PhotoLibrarySourceScope;
  selectMode: boolean;
  onPhotoDeleted?: (photoId: number) => void;
}) {
  const folders = groupPhotosIntoFolders(photos, scope);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const openFolder = folders.find((f) => f.key === openKey) ?? null;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {folders.map((folder) => (
          <FolderTile
            key={folder.key}
            folder={folder}
            scope={scope}
            disabled={selectMode}
            onOpen={() => setOpenKey(folder.key)}
          />
        ))}
      </div>
      {openFolder ? (
        <LightboxPortal
          key={openFolder.key}
          photos={toGalleryInputs(openFolder.photos, scope)}
          onPhotoDeleted={onPhotoDeleted}
          onClose={() => setOpenKey(null)}
        />
      ) : null}
    </>
  );
}

/** A single folder tile — folder-tab cover + count + scope-aware label. */
function FolderTile({
  folder,
  scope,
  disabled,
  onOpen,
}: {
  folder: PhotoFolder;
  scope: PhotoLibrarySourceScope;
  disabled: boolean;
  onOpen: () => void;
}) {
  // Claim folders resolve their Zendesk ticket title lazily (best-effort).
  const ticketSubject = useZendeskTicketSubject(folder.ticketId);
  const label =
    folder.ticketId != null
      ? ticketSubject.data || `Ticket #${folder.ticketId}`
      : folder.poRef
        ? folderRefLabel(folder.poRef, scope)
        : 'Unlinked';
  const count = folder.photos.length;

  return (
    <button
      type="button"
      data-testid="photo-folder"
      disabled={disabled}
      onClick={onOpen}
      title={`${label} · ${count} photo${count === 1 ? '' : 's'}`}
      className={cn(
        'group flex flex-col overflow-hidden rounded-lg border border-border bg-white text-left transition-colors',
        disabled ? 'cursor-default opacity-60' : 'hover:border-primary/70 hover:bg-slate-50',
      )}
    >
      <div className="relative h-40 w-full p-1.5">
        {/* Folder-tab peek behind the cover so the tile reads as a folder. */}
        <div className="absolute left-3 right-2 top-0.5 h-3 rounded-t-md bg-gray-200" aria-hidden="true" />
        <div className="relative h-full w-full overflow-hidden rounded-md border border-gray-200 bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={folder.cover.thumbUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          <span className="absolute right-2 top-2 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
            {count}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 px-2.5 py-2">
        <Folder className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        <span className="truncate text-[11px] font-semibold text-gray-900">{label}</span>
      </div>
    </button>
  );
}

/**
 * Mounts the shared fullscreen viewer for a set of photos, opens it at
 * `startIndex` on mount, and calls `onClose` (to unmount) once the viewer is
 * dismissed. Shared by the folders view and the flat (list/grid) views.
 */
function LightboxPortal({
  photos,
  startIndex = 0,
  onClose,
  onPhotoDeleted,
}: {
  photos: PhotoGalleryInput[];
  startIndex?: number;
  onClose: () => void;
  onPhotoDeleted?: (photoId: number) => void;
}) {
  // {id,url,meta} (not bare urls) so the viewer's delete + info panel show.
  const gallery = usePhotoGallery({ photos, showCopyLinks: false, onPhotoDeleted });
  const { openViewer, viewerOpen } = gallery;
  const openedRef = useRef(false);

  // Open exactly once. `openViewer`'s identity changes every render (its deps
  // include the per-render useImageZoom object), so an unguarded effect would
  // re-open the viewer immediately after the user closes it.
  const requestedRef = useRef(false);
  useEffect(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    openViewer(startIndex);
  }, [openViewer, startIndex]);

  useEffect(() => {
    if (viewerOpen) openedRef.current = true;
    else if (openedRef.current) onClose();
  }, [viewerOpen, onClose]);

  if (!gallery.mounted || typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence mode="wait">
      {viewerOpen ? <PhotoViewerModal g={gallery} /> : null}
    </AnimatePresence>,
    document.body,
  );
}
