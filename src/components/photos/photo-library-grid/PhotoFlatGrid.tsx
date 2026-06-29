'use client';

import type { PhotoLibraryViewMode } from '@/lib/photos/library-filter-state';
import { PhotoCard } from './PhotoCard';
import type { PhotoGridViewProps } from './types';

/**
 * grid-sm: dense square contact sheet. grid-lg: larger natural-aspect labeled
 * cards. BOTH are CSS grids so items flow left→right, top→bottom — i.e. the
 * active sort reads across rows. (grid-lg used CSS multi-column masonry, which
 * fills top→bottom DOWN each column, so chronological order ran down columns,
 * not across — `items-start` keeps the natural-height cards top-aligned.)
 */
export function PhotoFlatGrid({
  view,
  photos,
  scope,
  selectionActive,
  selected,
  onSelectTile,
  onPhotoContextMenu,
  openAt,
}: PhotoGridViewProps & { view: PhotoLibraryViewMode }) {
  const isLarge = view === 'grid-lg';
  const containerClass = isLarge
    ? 'grid grid-cols-2 items-start gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5'
    : 'grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-8';

  return (
    <div className={containerClass}>
      {photos.map((photo) => (
        <PhotoCard
          key={photo.id}
          photo={photo}
          imageUrl={photo.thumbUrl}
          scope={scope}
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
  );
}
