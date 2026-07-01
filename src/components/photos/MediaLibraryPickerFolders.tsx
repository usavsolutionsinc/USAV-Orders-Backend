'use client';

import { Check, Folder } from '@/components/Icons';
import type { LibraryPhoto } from '@/components/photos/photo-library-types';
import { PhotoThumb } from '@/components/photos/PhotoThumb';
import type { PhotoLibrarySourceScope } from '@/lib/photos/library-filter-state';
import { photoGridLeafClass, photoGridTileProps, type PhotoGridDensity } from '@/lib/photos/photo-grid-density';
import { formatDateTimePST } from '@/utils/date';
import {
  describeFolderBrowseHeader,
  type FolderTileData,
} from '@/components/photos/photo-library-grid/date-folder-tree';
import { FolderTileCover } from '@/components/photos/photo-library-grid/FolderTileCover';
import { useDateFolders } from '@/components/photos/photo-library-grid/useDateFolders';
import type { PhotoDateNav } from '@/components/photos/photo-library-grid/types';
import { cn } from '@/utils/_cn';

interface MediaLibraryPickerFoldersProps {
  photos: LibraryPhoto[];
  scope: PhotoLibrarySourceScope;
  gridDensity: PhotoGridDensity;
  dateNav: PhotoDateNav;
  onDateNav: (nav: PhotoDateNav) => void;
  selectedIds: Set<number>;
  onToggle: (photo: LibraryPhoto) => void;
  excludePhotoIds?: Set<number>;
}

/**
 * Year → Month → Week → Day folder drill (same model as the main library folders
 * view) with a selectable photo grid at the leaf.
 */
export function MediaLibraryPickerFolders({
  photos,
  scope,
  gridDensity,
  dateNav,
  onDateNav,
  selectedIds,
  onToggle,
  excludePhotoIds,
}: MediaLibraryPickerFoldersProps) {
  const visible = excludePhotoIds?.size
    ? photos.filter((p) => !excludePhotoIds.has(p.id))
    : photos;

  const { isLeaf, leafPhotos, tiles, onOpen } = useDateFolders({
    photos: visible,
    scope,
    dateFrom: dateNav.dateFrom,
    dateTo: dateNav.dateTo,
    poRef: dateNav.poRef,
    ticketId: dateNav.ticketId,
    onNavigate: onDateNav,
  });

  const header = describeFolderBrowseHeader({
    photos: visible,
    scope,
    dateFrom: dateNav.dateFrom,
    dateTo: dateNav.dateTo,
    poRef: dateNav.poRef,
    ticketId: dateNav.ticketId,
  });

  const leafVisible = excludePhotoIds?.size
    ? leafPhotos.filter((p) => !excludePhotoIds.has(p.id))
    : leafPhotos;

  if (isLeaf) {
    if (leafVisible.length === 0) {
      return (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center">
          <p className="text-caption font-semibold text-gray-600">No photos here</p>
          <p className="mt-1 text-micro text-gray-400">Try another folder or widen the date range.</p>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <p className="text-eyebrow font-black uppercase tracking-widest text-gray-500">
          {header.title}
          <span className="ml-2 font-semibold text-gray-400">{leafVisible.length}</span>
        </p>
        <div className={photoGridLeafClass(gridDensity)}>
          {leafVisible.map((p) => {
            const on = selectedIds.has(p.id);
            const tile = photoGridTileProps(p, gridDensity);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onToggle(p)}
                aria-pressed={on}
                className={cn(
                  'ds-raw-button relative overflow-hidden rounded-lg border-2 transition',
                  on ? 'border-blue-500 ring-2 ring-blue-200' : 'border-transparent hover:border-gray-300',
                )}
              >
                <PhotoThumb src={tile.imageUrl} alt={p.caption ?? ''} ratio={tile.ratio} />
                {on ? (
                  <span className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white">
                    <Check className="h-3 w-3" />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (tiles.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center">
        <p className="text-caption font-semibold text-gray-600">No folders here</p>
        <p className="mt-1 text-micro text-gray-400">Widen the date range or pick another media type.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-eyebrow font-black uppercase tracking-widest text-gray-500">
        {header.title}
        <span className="ml-2 font-semibold text-gray-400">{header.count}</span>
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <PickerFolderTile key={t.key} tile={t} onOpen={() => onOpen(t)} />
        ))}
      </div>
    </div>
  );
}

function PickerFolderTile({ tile, onOpen }: { tile: FolderTileData; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="ds-raw-button group flex flex-col overflow-hidden rounded-lg border border-border bg-white text-left transition-colors hover:border-primary/70 hover:bg-slate-50"
    >
      <div className="relative h-28 w-full p-1.5">
        <div className="absolute left-3 right-2 top-0.5 h-3 rounded-t-md bg-gray-200" aria-hidden="true" />
        <div className="relative h-full w-full overflow-hidden rounded-md border border-gray-200">
          <FolderTileCover photo={tile.previewPhoto} />
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
  );
}
