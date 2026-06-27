'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import type { LibraryPhoto } from './photo-library-types';
import { Check, Folder, Image as ImageIcon, Layers } from '@/components/Icons';
import { formatDateTimePST } from '@/utils/date';
import type { PhotoLibrarySourceScope, PhotoLibraryViewMode } from '@/lib/photos/library-filter-state';
import { usePhotoGallery } from '@/components/shipped/photo-gallery/usePhotoGallery';
import { PhotoViewerModal } from '@/components/shipped/photo-gallery/PhotoViewerModal';
import type { PhotoGalleryInput, PhotoMeta } from '@/components/shipped/photo-gallery/photo-gallery-utils';
import { type MouseEvent as ReactMouseEvent } from 'react';
import { PhotoThumb } from './PhotoThumb';
import { PhotoLabelChips } from './PhotoLabelChips';
import { describePhotoDatePath, isoWeekNumber, weekRange } from '@/lib/photos/date-hierarchy';
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

/** Group photos by PO# (`poRef`); within a group order oldest→newest (left→right). */
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
  for (const group of map.values()) {
    group.photos.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
  /** Active date filter (drives the folders-view drill level). */
  dateFrom?: string;
  dateTo?: string;
  /** Active PO# filter (folders-view PO leaf). */
  poRef?: string;
  /** Narrow/widen the date+PO filter from a folder click or path-bar crumb. */
  onNavigate?: (nav: PhotoDateNav) => void;
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
  return photos.map((p) => ({ id: p.id, url: p.displayUrl, thumbUrl: p.thumbUrl, meta: libraryPhotoMeta(p, scope) }));
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
  dateFrom,
  dateTo,
  poRef,
  onNavigate,
  selectionActive,
  selected,
  onSelectTile,
  onPhotoContextMenu,
  onPhotoDeleted,
  isLoading,
  error,
}: PhotoLibraryGridProps) {
  // The folders view owns its own per-folder viewer; the flat views (list,
  // grid, grid-ticket) share one page-level lightbox. Opening a photo scopes the
  // viewer to that photo's PO# group ONLY — the same single-PO display you get by
  // opening a folder — rather than the entire filtered set (which would just
  // mirror the page behind it). Group photos read oldest→newest.
  const [openPhotoId, setOpenPhotoId] = useState<number | null>(null);
  const openScope = useMemo(() => {
    if (openPhotoId == null) return null;
    const clicked = photos.find((p) => p.id === openPhotoId);
    if (!clicked) return null;
    const ref = clicked.poRef?.trim();
    const group = ref ? photos.filter((p) => p.poRef?.trim() === ref) : [clicked];
    const sorted = [...group].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      inputs: toGalleryInputs(sorted, sourceScope),
      startIndex: Math.max(0, sorted.findIndex((p) => p.id === openPhotoId)),
    };
  }, [openPhotoId, photos, sourceScope]);
  const openAt = (id: number) => setOpenPhotoId(id);

  // Rendered inside each flat-view branch (folders excluded). Mounts lazily so
  // images preload only once a photo is actually opened.
  const lightbox = openScope ? (
    <LightboxPortal
      photos={openScope.inputs}
      startIndex={openScope.startIndex}
      onClose={() => setOpenPhotoId(null)}
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
  // The folders view owns its own empty-handling — an empty day widens to its
  // week, and each level renders the right teaching state — so don't pre-empt it
  // with the global empty card (that hid the day→week fallback entirely).
  if (photos.length === 0 && view !== 'folders') {
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
        dateFrom={dateFrom}
        dateTo={dateTo}
        poRef={poRef}
        onNavigate={onNavigate ?? (() => {})}
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
                  {group.key === UNLINKED_TICKET_KEY ? group.label : `PO ${group.label}`}
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

  // grid-sm: dense square contact sheet. grid-lg: larger natural-aspect labeled
  // cards. BOTH are CSS grids so items flow left→right, top→bottom — i.e. the
  // active sort reads across rows. (grid-lg used CSS multi-column masonry, which
  // fills top→bottom DOWN each column, so chronological order ran down columns,
  // not across — `items-start` keeps the natural-height cards top-aligned.)
  const isLarge = view === 'grid-lg';
  const containerClass = isLarge
    ? 'grid grid-cols-2 items-start gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5'
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
            ratio={isLarge ? 'natural' : 'square'}
            showLabel={isLarge}
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
          <div className="space-y-1 px-2.5 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-semibold text-gray-900">
                  {photoPrimaryLabel(photo, scope)}
                </div>
                <div className="truncate text-[10px] text-gray-500">{formatDateTimePST(photo.createdAt)}</div>
              </div>
            </div>
            <PhotoLabelChips labels={photo.labels} max={3} />
          </div>
        ) : null}
      </button>
    </div>
  );
}

// ── Folders view (date drill) ───────────────────────────────────────────────
//
// The folders view is a Year → Month → Week → Day → PO# drill, all keyed off
// `created_at` (PST). Each level renders as a grid of folder tiles; drilling a
// day reveals that day's PO# folders, and opening a PO# folder shows its photos
// as a contact sheet with the shared lightbox. There are no saved/master
// folders any more — the hierarchy is derived from capture time.

const UNLINKED_PO_KEY = '__unlinked__';

const PST_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** PST `YYYY-MM-DD` for a photo's capture time (en-CA already emits that shape). */
function pstYmd(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return PST_YMD.format(date);
}

/** ISO week number for a `YYYY-MM-DD` string (computed in UTC to dodge DST). */
function isoWeekForYmd(ymd: string): number {
  return isoWeekNumber(new Date(`${ymd}T00:00:00Z`));
}

function poLabel(poRef: string, scope: PhotoLibrarySourceScope): string {
  if (scope === 'local_pickup') return `Pickup ${poRef}`;
  if (scope === 'packing') return `Order ${poRef}`;
  if (scope === 'repair') return `Unit ${poRef}`;
  return `PO ${poRef}`;
}

interface DayBucket {
  ymd: string;
  photos: LibraryPhoto[];
}
interface WeekBucket {
  key: string;
  week: number;
  days: Map<string, DayBucket>;
}
interface MonthBucket {
  key: string; // YYYY-MM
  month: number; // 0-based
  weeks: Map<string, WeekBucket>;
}
interface YearBucket {
  year: string;
  months: Map<string, MonthBucket>;
}

/** Bucket photos into Year → Month → Week → Day by PST capture date. */
function buildDateFolderTree(photos: LibraryPhoto[]): Map<string, YearBucket> {
  const years = new Map<string, YearBucket>();
  for (const photo of photos) {
    const ymd = pstYmd(photo.createdAt);
    if (!ymd) continue;
    const [y, m] = ymd.split('-');
    const year = years.get(y) ?? { year: y, months: new Map() };
    years.set(y, year);
    const mKey = `${y}-${m}`;
    const month = year.months.get(mKey) ?? { key: mKey, month: Number(m) - 1, weeks: new Map() };
    year.months.set(mKey, month);
    const week = isoWeekForYmd(ymd);
    const wKey = `${y}-W${week}`;
    const wk = month.weeks.get(wKey) ?? { key: wKey, week, days: new Map() };
    month.weeks.set(wKey, wk);
    const dayBucket = wk.days.get(ymd) ?? { ymd, photos: [] };
    wk.days.set(ymd, dayBucket);
    dayBucket.photos.push(photo);
  }
  return years;
}

interface FolderTileData {
  key: string;
  label: string;
  /** Newest photo in the subtree — drives the cover + meta timestamp. */
  cover: LibraryPhoto | undefined;
  count: number;
  latestAt: string;
}

/** Reduce a list of photos to a folder tile's cover/count/latest meta. */
function tileMeta(key: string, label: string, photos: LibraryPhoto[]): FolderTileData {
  let cover = photos[0];
  let latestAt = photos[0]?.createdAt ?? '';
  for (const p of photos) {
    if (p.createdAt > latestAt) {
      latestAt = p.createdAt;
      cover = p;
    }
  }
  return { key, label, cover, count: photos.length, latestAt };
}

/** Range a folder click applies, by level. */
function yearRangeOf(y: string): PhotoDateNav {
  return { dateFrom: `${y}-01-01`, dateTo: `${y}-12-31` };
}
function monthRangeOf(mKey: string): PhotoDateNav {
  const [y, m] = mKey.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { dateFrom: `${mKey}-01`, dateTo: `${mKey}-${String(last).padStart(2, '0')}` };
}
function weekRangeOf(ymd: string): PhotoDateNav {
  const r = weekRange(new Date(`${ymd}T00:00:00Z`));
  return { dateFrom: r.dateFrom, dateTo: r.dateTo };
}

export interface PhotoDateNav {
  dateFrom?: string;
  dateTo?: string;
  poRef?: string;
}

/**
 * Date-drill folders view, driven by the active URL date filter (single source
 * of truth — the same state the bottom breadcrumb reads). The drill LEVEL is the
 * granularity of the active range: no date → Years, a year span → Months, a
 * month → Weeks, a week → Days, a day → that day's PO# folders, and a PO# (or a
 * single-PO day / custom range) → a photo contact sheet. Clicking a folder
 * *narrows* the filter via `onNavigate`; the breadcrumb *widens* it. Because the
 * server already scopes `photos` to the active range, every level reads straight
 * off the loaded photos — so "on week 26" shows that week's day folders, not a
 * stale Years view.
 */
function FoldersView({
  photos,
  scope,
  dateFrom,
  dateTo,
  poRef,
  onNavigate,
  selectionActive,
  selected,
  onSelectTile,
  onPhotoContextMenu,
  onPhotoDeleted,
}: {
  photos: LibraryPhoto[];
  scope: PhotoLibrarySourceScope;
  dateFrom?: string;
  dateTo?: string;
  poRef?: string;
  onNavigate: (nav: PhotoDateNav) => void;
  selectionActive: boolean;
  selected: Set<number>;
  onSelectTile: (id: number, mods: TileSelectMods) => void;
  onPhotoContextMenu?: (photo: LibraryPhoto, e: ReactMouseEvent) => void;
  onPhotoDeleted?: (photoId: number) => void;
}) {
  const tree = useMemo(() => buildDateFolderTree(photos), [photos]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  // Classify the active range into a level via the shared date-path model, then
  // resolve the matching tree nodes off the (already range-scoped) photos.
  const datePath = useMemo(() => describePhotoDatePath({ dateFrom, dateTo }), [dateFrom, dateTo]);
  const level = datePath.length === 0 ? 'root' : datePath[datePath.length - 1].key;
  const anchor = dateFrom;
  const yKey = anchor?.slice(0, 4);
  const mKey = anchor?.slice(0, 7);

  const year = yKey ? tree.get(yKey) : undefined;
  const month = year && mKey ? year.months.get(mKey) : undefined;
  const week = month && anchor ? month.weeks.get(`${yKey}-W${isoWeekForYmd(anchor)}`) : undefined;
  const day = week && anchor ? week.days.get(anchor) : undefined;

  const dayPhotos = day?.photos ?? [];
  const poGroups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, LibraryPhoto[]>();
    for (const p of dayPhotos) {
      const ref = p.poRef?.trim();
      const key = ref ? `po:${ref}` : UNLINKED_PO_KEY;
      const list = map.get(key) ?? [];
      if (list.length === 0) order.push(key);
      list.push(p);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { order, map };
  }, [dayPhotos]);

  // The leaf is a flat contact sheet: an explicit PO#, a single-PO day, or any
  // custom range. `photos` is already server-scoped, so it IS the leaf set.
  const isLeaf =
    Boolean(poRef) ||
    level === 'custom' ||
    (level === 'day' && poGroups.order.length <= 1);
  const leafInputs = useMemo(() => toGalleryInputs(photos, scope), [photos, scope]);
  useEffect(() => setOpenIndex(null), [dateFrom, dateTo, poRef]);

  // Empty-day fallback: if a single day is selected (e.g. today on open) but it
  // has no photos, widen to that day's week so the operator lands on day folders
  // instead of a dead-empty day. Empty-week widens to the month the same way.
  useEffect(() => {
    if (poRef || !anchor || photos.length > 0) return;
    if (level === 'day') {
      onNavigate(weekRangeOf(anchor));
    } else if (level === 'week') {
      onNavigate(monthRangeOf(anchor.slice(0, 7)));
    }
  }, [level, poRef, anchor, photos.length, onNavigate]);

  // ── Leaf: a contact sheet of photos (PO# folder, single-PO day, custom) ────
  if (isLeaf) {
    if (photos.length === 0) return <PhotoEmptyState />;
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-8">
          {photos.map((photo, i) => (
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
            photos={leafInputs}
            startIndex={openIndex}
            onPhotoDeleted={onPhotoDeleted}
            onClose={() => setOpenIndex(null)}
          />
        ) : null}
      </div>
    );
  }

  // ── Folder grid for the current level ─────────────────────────────────────
  let eyebrow = 'Years';
  let tiles: FolderTileData[] = [];
  let onOpen: (tile: FolderTileData) => void = () => {};

  if (level === 'day' && day) {
    eyebrow = 'POs';
    tiles = poGroups.order.map((key) => {
      const list = poGroups.map.get(key)!;
      const ref = key === UNLINKED_PO_KEY ? null : key.replace(/^po:/, '');
      return tileMeta(key, ref ? poLabel(ref, scope) : 'Unlinked', list);
    });
    onOpen = (t) =>
      onNavigate({
        dateFrom,
        dateTo,
        poRef: t.key === UNLINKED_PO_KEY ? undefined : t.key.replace(/^po:/, ''),
      });
  } else if (level === 'week' && week) {
    eyebrow = 'Days';
    tiles = [...week.days.values()]
      .sort((a, b) => b.ymd.localeCompare(a.ymd))
      .map((d) => tileMeta(d.ymd, dayTileLabel(d.ymd), d.photos));
    onOpen = (t) => onNavigate({ dateFrom: t.key, dateTo: t.key });
  } else if (level === 'month' && month) {
    eyebrow = 'Weeks';
    tiles = [...month.weeks.values()]
      .sort((a, b) => b.week - a.week)
      .map((w) => tileMeta(w.key, `Week ${w.week}`, [...w.days.values()].flatMap((d) => d.photos)));
    // Anchor the week range on its earliest day so the filter spans Mon–Sun.
    onOpen = (t) => {
      const wk = month.weeks.get(t.key);
      const firstDay = wk ? [...wk.days.keys()].sort()[0] : undefined;
      if (firstDay) onNavigate(weekRangeOf(firstDay));
    };
  } else if (level === 'year' && year) {
    eyebrow = 'Months';
    tiles = [...year.months.values()]
      .sort((a, b) => b.month - a.month)
      .map((m) =>
        tileMeta(
          m.key,
          MONTH_NAMES[m.month] ?? m.key,
          [...m.weeks.values()].flatMap((w) => [...w.days.values()].flatMap((d) => d.photos)),
        ),
      );
    onOpen = (t) => onNavigate(monthRangeOf(t.key));
  } else {
    eyebrow = 'Years';
    tiles = [...tree.values()]
      .sort((a, b) => Number(b.year) - Number(a.year))
      .map((y) =>
        tileMeta(
          y.year,
          y.year,
          [...y.months.values()].flatMap((m) =>
            [...m.weeks.values()].flatMap((w) => [...w.days.values()].flatMap((d) => d.photos)),
          ),
        ),
      );
    onOpen = (t) => onNavigate(yearRangeOf(t.key));
  }

  if (tiles.length === 0) return <PhotoEmptyState />;

  return (
    <div className="space-y-3">
      <SectionEyebrow icon={Folder} label={eyebrow} count={tiles.length} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {tiles.map((t) => (
          <DateFolderTile key={t.key} tile={t} onOpen={() => onOpen(t)} />
        ))}
      </div>
    </div>
  );
}

/** `Jun 23` from a `YYYY-MM-DD` string. */
function dayTileLabel(ymd: string): string {
  const [, m, d] = ymd.split('-');
  return `${MONTH_NAMES[Number(m) - 1]?.slice(0, 3) ?? m} ${Number(d)}`;
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
      <span
        data-testid="folder-level"
        className="text-eyebrow font-black uppercase tracking-widest text-gray-500"
      >
        {label}
      </span>
      <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-gray-500">
        {count}
      </span>
    </div>
  );
}

/** A single folder tile — folder-tab cover + count + latest-capture meta. */
function DateFolderTile({ tile, onOpen }: { tile: FolderTileData; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-testid="photo-folder"
      onClick={onOpen}
      title={`${tile.label} · ${tile.count} photo${tile.count === 1 ? '' : 's'}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-white text-left transition-colors hover:border-primary/70 hover:bg-slate-50"
    >
      <div className="relative h-32 w-full p-1.5">
        {/* Folder-tab peek behind the cover so the tile reads as a folder. */}
        <div className="absolute left-3 right-2 top-0.5 h-3 rounded-t-md bg-gray-200" aria-hidden="true" />
        <div className="relative h-full w-full overflow-hidden rounded-md border border-gray-200">
          {tile.cover ? <PhotoThumb src={tile.cover.thumbUrl} alt="" ratio="fill" /> : null}
          <span className="absolute right-2 top-2 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
            {tile.count}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5 px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <Folder className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          <span className="truncate text-[11px] font-semibold text-gray-900">{tile.label}</span>
        </div>
        {tile.latestAt ? (
          <span className="truncate pl-5 text-[10px] tabular-nums text-gray-400">
            {formatDateTimePST(tile.latestAt)}
          </span>
        ) : null}
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
