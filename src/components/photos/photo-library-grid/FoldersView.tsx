'use client';

import { type MouseEvent as ReactMouseEvent } from 'react';
import type { LibraryPhoto } from '../photo-library-types';
import type { PhotoLibrarySourceScope } from '@/lib/photos/library-filter-state';
import { photoGridLeafClass, photoGridTileProps, type PhotoGridDensity } from '@/lib/photos/photo-grid-density';
import { formatDateTimePST } from '@/utils/date';
import { Folder } from '@/components/Icons';
import { PhotoCard } from './PhotoCard';
import { PhotoEmptyState } from './PhotoGridStates';
import { LightboxPortal } from './LightboxPortal';
import { useDateFolders } from './useDateFolders';
import type { FolderTileData } from './date-folder-tree';
import { FolderTileCover } from './FolderTileCover';
import type { PhotoDateNav, TileSelectMods } from './types';

/**
 * Folders: one folder per group (PO# for unboxing, order# for packing, Zendesk
 * ticket for claims). Finder-style — click a folder to drill *into* it (a
 * breadcrumb path appears and its photos render inline), then click a photo to
 * open the shared fullscreen viewer.
 *
 * The drill model and tile data come from {@link useDateFolders}; this component
 * is the render half (leaf contact sheet or the current level's folder grid).
 * The browse level label (POs, Days, …) lives in the page header.
 */
export function FoldersView({
  photos,
  scope,
  gridDensity,
  dateFrom,
  dateTo,
  poRef,
  ticketId,
  onNavigate,
  selectionActive,
  selected,
  onSelectTile,
  onPhotoContextMenu,
  onPhotoDeleted,
}: {
  photos: LibraryPhoto[];
  scope: PhotoLibrarySourceScope;
  gridDensity: PhotoGridDensity;
  dateFrom?: string;
  dateTo?: string;
  poRef?: string;
  ticketId?: string;
  onNavigate: (nav: PhotoDateNav) => void;
  selectionActive: boolean;
  selected: Set<number>;
  onSelectTile: (id: number, mods: TileSelectMods) => void;
  onPhotoContextMenu?: (photo: LibraryPhoto, e: ReactMouseEvent) => void;
  onPhotoDeleted?: (photoId: number) => void;
}) {
  const { isLeaf, leafPhotos, leafInputs, openIndex, setOpenIndex, tiles, onOpen } = useDateFolders({
    photos,
    scope,
    dateFrom,
    dateTo,
    poRef,
    ticketId,
    onNavigate,
  });

  // ── Leaf: a contact sheet of photos (PO# folder, single-PO day, custom) ────
  if (isLeaf) {
    if (leafPhotos.length === 0) return <PhotoEmptyState />;
    return (
      <div className="space-y-3">
        <div className={photoGridLeafClass(gridDensity)}>
          {leafPhotos.map((photo, i) => {
            const tile = photoGridTileProps(photo, gridDensity);
            return (
            <PhotoCard
              key={photo.id}
              photo={photo}
              imageUrl={tile.imageUrl}
              scope={scope}
              ratio={tile.ratio}
              showLabel={false}
              selectionActive={selectionActive}
              selected={selected.has(photo.id)}
              onSelect={(mods) => onSelectTile(photo.id, mods)}
              onOpen={() => setOpenIndex(i)}
              onContextMenu={onPhotoContextMenu}
            />
            );
          })}
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
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
      {tiles.map((t) => (
        <DateFolderTile key={t.key} tile={t} onOpen={() => onOpen(t)} />
      ))}
    </div>
  );
}

/** A single folder tile — cover preview on PO folders, icon placeholder on date drill. */
function DateFolderTile({ tile, onOpen }: { tile: FolderTileData; onOpen: () => void }) {
  const ariaLabel = `${tile.label} · ${tile.count} photo${tile.count === 1 ? '' : 's'}`;
  return (
    <button
      type="button"
      data-testid="photo-folder"
      onClick={onOpen}
      aria-label={ariaLabel}
      className="ds-raw-button group flex flex-col overflow-hidden rounded-lg border border-border bg-surface-card text-left transition-colors hover:border-primary/70 hover:bg-surface-hover"
    >
      <div className="relative h-32 w-full p-1.5">
        {/* Folder-tab peek behind the cover so the tile reads as a folder. */}
        <div className="absolute left-3 right-2 top-0.5 h-3 rounded-t-md bg-surface-strong" aria-hidden="true" />
        <div className="relative h-full w-full overflow-hidden rounded-md border border-border-soft">
          <FolderTileCover photo={tile.previewPhoto} />
          <span className="absolute right-2 top-2 rounded-full bg-black/70 px-1.5 py-0.5 text-micro font-bold tabular-nums text-white">
            {tile.count}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5 px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <Folder className="h-3.5 w-3.5 shrink-0 text-text-faint" />
          <span className="truncate text-caption font-semibold text-text-default">{tile.label}</span>
        </div>
        {tile.latestAt ? (
          <span className="truncate pl-5 text-micro tabular-nums text-text-faint">
            {formatDateTimePST(tile.latestAt)}
          </span>
        ) : null}
      </div>
    </button>
  );
}
