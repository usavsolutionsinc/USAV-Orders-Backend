'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import type { LibraryPhoto } from './photo-library-types';
import { Check, ChevronLeft, ChevronRight, Folder, Image as ImageIcon, Layers } from '@/components/Icons';
import { formatDateTimePST } from '@/utils/date';
import type { PhotoLibrarySourceScope, PhotoLibraryViewMode } from '@/lib/photos/library-filter-state';
import { usePhotoGallery } from '@/components/shipped/photo-gallery/usePhotoGallery';
import { PhotoViewerModal } from '@/components/shipped/photo-gallery/PhotoViewerModal';
import type { PhotoGalleryInput, PhotoMeta } from '@/components/shipped/photo-gallery/photo-gallery-utils';
import { type MouseEvent as ReactMouseEvent } from 'react';
import { PhotoThumb } from './PhotoThumb';
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

/** Modifiers carried from a tile click into the selection model. */
export interface TileSelectMods {
  /** Shift was held — extend a range from the last anchor. */
  shift: boolean;
}

interface PhotoLibraryGridProps {
  photos: LibraryPhoto[];
  view: PhotoLibraryViewMode;
  /** Source scope drives folder labels (PO# for unboxing, Order# for packing). */
  sourceScope?: PhotoLibrarySourceScope;
  /** Whether selection UI (checkmarks, toggle-on-click) is engaged. */
  selectionActive: boolean;
  /** The currently-selected photo ids. */
  selected: Set<number>;
  /** Select/toggle a tile (the page owns range/anchor logic). */
  onSelectTile: (id: number, mods: TileSelectMods) => void;
  /** Right-click a photo tile — the page opens the contextual action menu. */
  onPhotoContextMenu?: (photo: LibraryPhoto, e: ReactMouseEvent) => void;
  /** Called after a photo is deleted from the folder viewer so the list refreshes. */
  onPhotoDeleted?: (photoId: number) => void;
  isLoading: boolean;
  error: string | null;
}

/**
 * Whether a photo's name should read as a Zendesk ticket# rather than a PO#.
 * Claims photos carry the ticket id the claim was opened under (often the same
 * receiving the PO# came from) — in the claims scope we surface that ticket# so
 * the same physical photos are findable by their Zendesk reference.
 */
function ticketIdForLabel(photo: LibraryPhoto, scope: PhotoLibrarySourceScope): number | null {
  return scope === 'claims' && photo.ticketId != null ? photo.ticketId : null;
}

function photoFileName(photo: LibraryPhoto, scope: PhotoLibrarySourceScope): string {
  const ticketId = ticketIdForLabel(photo, scope);
  if (ticketId != null) return `ticket-${ticketId}-${photo.id}.jpg`;
  if (photo.poRef) return `PO-${photo.poRef}-${photo.id}.jpg`;
  const type = photo.photoType?.toLowerCase().replace(/_/g, '-') ?? 'photo';
  return `${type}-${photo.id}.jpg`;
}

function photoPrimaryLabel(photo: LibraryPhoto, scope: PhotoLibrarySourceScope): string {
  const ticketId = ticketIdForLabel(photo, scope);
  if (ticketId != null) return `Ticket ${ticketId}`;
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

/**
 * Decide what a tile click means. A modifier key (Shift / Ctrl / Cmd) or an
 * already-active selection routes the click to selection; otherwise it opens the
 * lightbox. This is the Google-Photos model: browse by default, modifier-click
 * (or the hover checkmark) to start selecting, then plain clicks toggle.
 */
function clickSelectsInstead(e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }, selectionActive: boolean): boolean {
  return selectionActive || e.shiftKey || e.metaKey || e.ctrlKey;
}

/**
 * The hover/active selection checkmark. Rendered as its own button (a sibling of
 * the tile's activation button, never nested inside it) so it toggles selection
 * without nested-interactive markup. Hidden until hover unless selection is
 * active, then always shown so the whole grid reads as selectable.
 */
function SelectionMark({
  checked,
  active,
  onToggle,
}: {
  checked: boolean;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-label={checked ? 'Deselect photo' : 'Select photo'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        'absolute left-2 top-2 z-20 inline-flex h-6 w-6 items-center justify-center rounded-full border shadow-sm transition',
        checked
          ? 'border-blue-600 bg-blue-600 text-white opacity-100'
          : cn(
              'border-white/80 bg-white/90 text-gray-400 backdrop-blur-sm hover:border-blue-200 hover:text-blue-600 focus:opacity-100',
              active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            ),
      )}
    >
      <Check className="h-3.5 w-3.5 stroke-[2.5]" />
    </button>
  );
}

/** Loading shimmer — a grid of placeholder tiles matching the small-grid rhythm. */
function PhotoGridSkeleton() {
  return (
    <div
      className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-8"
      aria-busy="true"
      aria-label="Loading photos"
    >
      {Array.from({ length: 24 }).map((_, i) => (
        <div key={i} className="aspect-square animate-pulse rounded-lg bg-gray-100" />
      ))}
    </div>
  );
}

/** Teaching empty state — explains the filter, doesn't just say "nothing here". */
function PhotoEmptyState() {
  return (
    <div className="mx-auto mt-6 flex max-w-sm flex-col items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-6 py-10 text-center">
      <ImageIcon className="h-6 w-6 text-gray-400" />
      <p className="text-sm font-semibold text-gray-900">No photos in this view</p>
      <p className="text-xs leading-relaxed text-gray-500">
        Unboxing, packing, and claim photos land here as staff capture them. Widen the
        source or date range in the sidebar to see more.
      </p>
    </div>
  );
}

export function PhotoLibraryGrid({
  photos,
  view,
  sourceScope = 'all',
  selectionActive,
  selected,
  onSelectTile,
  onPhotoContextMenu,
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
    return <PhotoGridSkeleton />;
  }
  if (error) {
    return (
      <div className="mx-auto mt-6 flex max-w-sm flex-col items-center gap-2 rounded-xl border border-dashed border-rose-200 bg-rose-50 px-6 py-10 text-center">
        <ImageIcon className="h-6 w-6 text-rose-400" />
        <p className="text-sm font-semibold text-rose-900">Couldn’t load photos</p>
        <p className="text-xs leading-relaxed text-rose-600">{error}</p>
      </div>
    );
  }
  if (photos.length === 0) {
    return <PhotoEmptyState />;
  }

  if (view === 'list') {
    return (
      <>
        <ul className="divide-y divide-gray-100 rounded-lg border border-border bg-card">
          {photos.map((photo) => {
            const isSelected = selected.has(photo.id);
            const takenAt = formatDateTimePST(photo.createdAt);
            const fileName = photoFileName(photo, sourceScope);
            return (
              <li key={photo.id} className="group relative">
                <button
                  type="button"
                  onClick={(e) => {
                    if (clickSelectsInstead(e, selectionActive)) {
                      e.preventDefault();
                      onSelectTile(photo.id, { shift: e.shiftKey });
                    } else {
                      openAt(photo.id);
                    }
                  }}
                  onContextMenu={(e) => onPhotoContextMenu?.(photo, e)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50',
                    isSelected && 'bg-blue-50/50',
                  )}
                >
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border">
                    <PhotoThumb src={photo.thumbUrl} alt="" damage={Boolean(photo.damageDetected)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{fileName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {photoPrimaryLabel(photo, sourceScope)}
                      {photo.damageDetected ? ' · damage' : ''}
                      {photo.hasAnalysis && !photo.damageDetected ? ' · analyzed' : ''}
                    </p>
                  </div>
                  <time className="shrink-0 text-xs tabular-nums text-muted-foreground">{takenAt}</time>
                </button>
                <SelectionMark
                  checked={isSelected}
                  active={selectionActive}
                  onToggle={() => onSelectTile(photo.id, { shift: false })}
                />
              </li>
            );
          })}
        </ul>
        {lightbox}
      </>
    );
  }

  // Folders: one folder per group (PO# for unboxing, order# for packing, Zendesk
  // ticket for claims). Finder-style — click a folder to drill *into* it (a
  // breadcrumb path appears and its photos render inline), then click a photo to
  // open the shared fullscreen viewer.
  if (view === 'folders') {
    return (
      <FoldersView
        photos={photos}
        scope={sourceScope}
        selectionActive={selectionActive}
        selected={selected}
        onSelectTile={onSelectTile}
        onPhotoContextMenu={onPhotoContextMenu}
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
                    scope={sourceScope}
                    showLabel={false}
                    selectionActive={selectionActive}
                    selected={selected.has(photo.id)}
                    onSelect={(mods) => onSelectTile(photo.id, mods)}
                    onOpen={() => openAt(photo.id)}
                    onContextMenu={onPhotoContextMenu}
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

  // grid-sm: dense square contact sheet. grid-lg: editorial masonry of
  // natural-aspect, labeled cards. Both render as one flat sheet (Finder-style —
  // no day-separator bands).
  const isMasonry = view === 'grid-lg';
  const containerClass = isMasonry
    ? 'columns-2 gap-3 sm:columns-3 md:columns-4 xl:columns-6'
    : 'grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-8';

  return (
    <>
      <div className={containerClass}>
        {photos.map((photo) => (
          <PhotoCard
            key={photo.id}
            photo={photo}
            imageUrl={photo.thumbUrl}
            scope={sourceScope}
            ratio={isMasonry ? 'natural' : 'square'}
            masonry={isMasonry}
            showLabel={isMasonry}
            selectionActive={selectionActive}
            selected={selected.has(photo.id)}
            onSelect={(mods) => onSelectTile(photo.id, mods)}
            onOpen={() => openAt(photo.id)}
            onContextMenu={onPhotoContextMenu}
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
  scope,
  ratio = 'square',
  masonry = false,
  showLabel,
  selectionActive,
  selected,
  onSelect,
  onOpen,
  onContextMenu,
}: {
  photo: LibraryPhoto;
  imageUrl: string;
  /** Source scope — drives the PO# vs Zendesk-ticket# label. */
  scope: PhotoLibrarySourceScope;
  ratio?: 'square' | 'natural';
  /** Render as a CSS-columns masonry child (avoid mid-tile column breaks). */
  masonry?: boolean;
  showLabel: boolean;
  selectionActive: boolean;
  selected: boolean;
  onSelect: (mods: TileSelectMods) => void;
  /** Open the shared fullscreen viewer at this photo (flat views only). */
  onOpen?: () => void;
  /** Right-click handler — surfaces the per-photo action menu. */
  onContextMenu?: (photo: LibraryPhoto, e: ReactMouseEvent) => void;
}) {
  return (
    <div
      onContextMenu={onContextMenu ? (e) => onContextMenu(photo, e) : undefined}
      className={cn(
        'group relative overflow-hidden rounded-lg border bg-white text-left transition-colors',
        masonry && 'mb-3 block w-full break-inside-avoid',
        selected ? 'border-primary ring-2 ring-primary' : 'border-border hover:border-gray-300',
      )}
    >
      <SelectionMark
        checked={selected}
        active={selectionActive}
        onToggle={() => onSelect({ shift: false })}
      />
      <button
        type="button"
        data-testid="photo-tile"
        className="block w-full text-left"
        onClick={(e) => {
          if (clickSelectsInstead(e, selectionActive)) {
            e.preventDefault();
            onSelect({ shift: e.shiftKey });
          } else {
            onOpen?.();
          }
        }}
      >
        <PhotoThumb
          src={imageUrl}
          alt={photoPrimaryLabel(photo, scope)}
          ratio={ratio}
          damage={Boolean(photo.damageDetected)}
        />
        {showLabel ? (
          <div className="flex items-start justify-between gap-2 px-2.5 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-semibold text-gray-900">
                {photoPrimaryLabel(photo, scope)}
              </div>
              <div className="truncate text-[10px] text-gray-500">{formatDateTimePST(photo.createdAt)}</div>
            </div>
          </div>
        ) : null}
      </button>
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
  if (scope === 'local_pickup') return `Pickup ${poRef}`;
  if (scope === 'packing') return `Order ${poRef}`;
  if (scope === 'repair') return `Unit ${poRef}`;
  return `#${poRef}`;
}

function folderRefLabelFallback(folder: PhotoFolder, scope: PhotoLibrarySourceScope): string {
  if (folder.ticketId != null) return `Ticket #${folder.ticketId}`;
  if (folder.poRef) return folderRefLabel(folder.poRef, scope);
  return 'Unlinked';
}

/**
 * Resolve a folder's display label. Claim folders (with a Zendesk ticket id)
 * lazily resolve the ticket subject and fall back to "Ticket #id"; PO/order
 * folders use the scope-aware ref label.
 */
function useFolderLabel(folder: PhotoFolder, scope: PhotoLibrarySourceScope): string {
  const ticketSubject = useZendeskTicketSubject(folder.ticketId);
  if (folder.ticketId != null) return ticketSubject.data || `Ticket #${folder.ticketId}`;
  return folderRefLabelFallback(folder, scope);
}

/**
 * Finder-style folders view. At the root it shows a grid of folder tiles; click
 * one to drill *into* it — a breadcrumb path appears and the folder's photos
 * render inline as a contact sheet. Click a photo to open the shared lightbox;
 * with a selection active, photos toggle so the top bulk bar can share/download
 * the chosen set (replacing the old drag-a-folder-to-share gesture).
 */
function FoldersView({
  photos,
  scope,
  selectionActive,
  selected,
  onSelectTile,
  onPhotoContextMenu,
  onPhotoDeleted,
}: {
  photos: LibraryPhoto[];
  scope: PhotoLibrarySourceScope;
  selectionActive: boolean;
  selected: Set<number>;
  onSelectTile: (id: number, mods: TileSelectMods) => void;
  onPhotoContextMenu?: (photo: LibraryPhoto, e: ReactMouseEvent) => void;
  onPhotoDeleted?: (photoId: number) => void;
}) {
  const folders = useMemo(() => groupPhotosIntoFolders(photos, scope), [photos, scope]);
  // Finder/Runway-style split: real (linked) folders render as folder tiles;
  // photos with no PO/ticket are surfaced as a loose "Ungrouped" sheet at the
  // root instead of being buried in a folder you have to open.
  const linkedFolders = useMemo(
    () => folders.filter((f) => f.key !== UNLINKED_FOLDER_KEY),
    [folders],
  );
  const loosePhotos = useMemo(
    () => folders.find((f) => f.key === UNLINKED_FOLDER_KEY)?.photos ?? [],
    [folders],
  );

  const [openKey, setOpenKey] = useState<string | null>(null);
  const openFolder = linkedFolders.find((f) => f.key === openKey) ?? null;
  // Lightbox index when drilled into a folder (flat list/grid use their own).
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  // Lightbox index for the root-level "Ungrouped photos" sheet.
  const [looseIndex, setLooseIndex] = useState<number | null>(null);
  const folderInputs = useMemo(
    () => (openFolder ? toGalleryInputs(openFolder.photos, scope) : []),
    [openFolder, scope],
  );
  const looseInputs = useMemo(() => toGalleryInputs(loosePhotos, scope), [loosePhotos, scope]);

  // Leaving a folder (or it vanishing after a refetch) closes any open image.
  useEffect(() => {
    if (!openFolder) setOpenIndex(null);
  }, [openFolder]);

  if (openFolder) {
    return (
      <div className="space-y-3">
        <FolderPathBar folder={openFolder} scope={scope} onBack={() => setOpenKey(null)} />
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-8">
          {openFolder.photos.map((photo, i) => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              imageUrl={photo.thumbUrl}
              scope={scope}
              showLabel={false}
              selectionActive={selectionActive}
              selected={selected.has(photo.id)}
              onSelect={(mods) => onSelectTile(photo.id, mods)}
              onOpen={() => setOpenIndex(i)}
              onContextMenu={onPhotoContextMenu}
            />
          ))}
        </div>
        {openIndex !== null ? (
          <LightboxPortal
            photos={folderInputs}
            startIndex={openIndex}
            onPhotoDeleted={onPhotoDeleted}
            onClose={() => setOpenIndex(null)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {linkedFolders.length > 0 ? (
        <section className="space-y-2">
          <SectionEyebrow icon={Folder} label="Folders" count={linkedFolders.length} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {linkedFolders.map((folder) => (
              <FolderTile
                key={folder.key}
                folder={folder}
                scope={scope}
                onOpen={() => setOpenKey(folder.key)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {loosePhotos.length > 0 ? (
        <section className="space-y-2">
          <SectionEyebrow icon={ImageIcon} label="Ungrouped photos" count={loosePhotos.length} />
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-8">
            {loosePhotos.map((photo, i) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                imageUrl={photo.thumbUrl}
                scope={scope}
                showLabel={false}
                selectionActive={selectionActive}
                selected={selected.has(photo.id)}
                onSelect={(mods) => onSelectTile(photo.id, mods)}
                onOpen={() => setLooseIndex(i)}
                onContextMenu={onPhotoContextMenu}
              />
            ))}
          </div>
        </section>
      ) : null}

      {looseIndex !== null ? (
        <LightboxPortal
          photos={looseInputs}
          startIndex={looseIndex}
          onPhotoDeleted={onPhotoDeleted}
          onClose={() => setLooseIndex(null)}
        />
      ) : null}
    </div>
  );
}

/** Eyebrow section header with a count chip (Runway/Squarespace asset library). */
function SectionEyebrow({
  icon: Icon,
  label,
  count,
}: {
  icon: typeof Folder;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 text-gray-400" />
      <span className="text-eyebrow font-black uppercase tracking-widest text-gray-500">
        {label}
      </span>
      <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-gray-500">
        {count}
      </span>
    </div>
  );
}

/** Breadcrumb path bar shown while drilled into a folder — back to "All folders". */
function FolderPathBar({
  folder,
  scope,
  onBack,
}: {
  folder: PhotoFolder;
  scope: PhotoLibrarySourceScope;
  onBack: () => void;
}) {
  const label = useFolderLabel(folder, scope);
  const count = folder.photos.length;
  return (
    <nav className="flex items-center gap-1 text-sm" aria-label="Folder path">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-semibold text-blue-600 transition-colors hover:bg-blue-50"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> All folders
      </button>
      <ChevronRight className="h-3 w-3 shrink-0 text-gray-300" aria-hidden="true" />
      <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-gray-100 px-2 py-1 font-semibold text-gray-900">
        <Folder className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        <span className="truncate">{label}</span>
        <span className="shrink-0 tabular-nums text-gray-400">· {count}</span>
      </span>
    </nav>
  );
}

/** A single folder tile — folder-tab cover + count + scope-aware label. */
function FolderTile({
  folder,
  scope,
  onOpen,
}: {
  folder: PhotoFolder;
  scope: PhotoLibrarySourceScope;
  onOpen: () => void;
}) {
  const label = useFolderLabel(folder, scope);
  const count = folder.photos.length;

  return (
    <button
      type="button"
      data-testid="photo-folder"
      onClick={onOpen}
      title={`${label} · ${count} photo${count === 1 ? '' : 's'}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-white text-left transition-colors hover:border-primary/70 hover:bg-slate-50"
    >
      <div className="relative h-32 w-full p-1.5">
        {/* Folder-tab peek behind the cover so the tile reads as a folder. */}
        <div className="absolute left-3 right-2 top-0.5 h-3 rounded-t-md bg-gray-200" aria-hidden="true" />
        <div className="relative h-full w-full overflow-hidden rounded-md border border-gray-200">
          <PhotoThumb src={folder.cover.thumbUrl} alt="" ratio="fill" />
          <span className="absolute right-2 top-2 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
            {count}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5 px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <Folder className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          <span className="truncate text-[11px] font-semibold text-gray-900">{label}</span>
        </div>
        {/* Frame.io-style meta line: latest capture in the folder. */}
        <span className="truncate pl-5 text-[10px] tabular-nums text-gray-400">
          {formatDateTimePST(folder.latestAt)}
        </span>
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
