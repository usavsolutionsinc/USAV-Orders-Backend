'use client';

import { type MouseEvent as ReactMouseEvent } from 'react';
import type { LibraryPhoto } from '../photo-library-types';
import type { PhotoLibrarySourceScope } from '@/lib/photos/library-filter-state';
import { Folder } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { formatDateTimePST } from '@/utils/date';
import { PhotoThumb } from '../PhotoThumb';
import { PhotoCard } from './PhotoCard';
import { PhotoEmptyState } from './PhotoGridStates';
import { LightboxPortal } from './LightboxPortal';
import { useDateFolders } from './useDateFolders';
import type { FolderTileData } from './date-folder-tree';
import type { PhotoDateNav, TileSelectMods } from './types';

/**
 * Folders: one folder per group (PO# for unboxing, order# for packing, Zendesk
 * ticket for claims). Finder-style — click a folder to drill *into* it (a
 * breadcrumb path appears and its photos render inline), then click a photo to
 * open the shared fullscreen viewer.
 *
 * The drill model and tile data come from {@link useDateFolders}; this component
 * is the render half (leaf contact sheet or the current level's folder grid).
 */
export function FoldersView({
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
  const { isLeaf, leafInputs, openIndex, setOpenIndex, eyebrow, tiles, onOpen } = useDateFolders({
    photos,
    scope,
    dateFrom,
    dateTo,
    poRef,
    onNavigate,
  });

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
      <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-micro font-bold tabular-nums text-gray-500">
        {count}
      </span>
    </div>
  );
}

/** A single folder tile — folder-tab cover + count + latest-capture meta. */
function DateFolderTile({ tile, onOpen }: { tile: FolderTileData; onOpen: () => void }) {
  const tooltip = `${tile.label} · ${tile.count} photo${tile.count === 1 ? '' : 's'}`;
  return (
    <HoverTooltip label={tooltip} asChild>
      <button
        type="button"
        data-testid="photo-folder"
        onClick={onOpen}
        aria-label={tooltip}
        className="ds-raw-button group flex flex-col overflow-hidden rounded-lg border border-border bg-white text-left transition-colors hover:border-primary/70 hover:bg-slate-50"
      >
      <div className="relative h-32 w-full p-1.5">
        {/* Folder-tab peek behind the cover so the tile reads as a folder. */}
        <div className="absolute left-3 right-2 top-0.5 h-3 rounded-t-md bg-gray-200" aria-hidden="true" />
        <div className="relative h-full w-full overflow-hidden rounded-md border border-gray-200">
          {tile.cover ? <PhotoThumb src={tile.cover.thumbUrl} alt="" ratio="fill" /> : null}
          <span className="absolute right-2 top-2 rounded-full bg-black/70 px-1.5 py-0.5 text-micro font-bold tabular-nums text-white">
            {tile.count}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5 px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <Folder className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          <span className="truncate text-caption font-semibold text-gray-900">{tile.label}</span>
        </div>
        {tile.latestAt ? (
          <span className="truncate pl-5 text-micro tabular-nums text-gray-400">
            {formatDateTimePST(tile.latestAt)}
          </span>
        ) : null}
      </div>
      </button>
    </HoverTooltip>
  );
}
