'use client';

import { Layers } from '@/components/Icons';
import { photoGridLeafClass, photoGridTileProps, type PhotoGridDensity } from '@/lib/photos/photo-grid-density';
import { formatDateTimePST } from '@/utils/date';
import { PhotoCard } from './PhotoCard';
import { groupPhotosByTicket } from './photo-grid-format';
import type { PhotoGridViewProps } from './types';

/**
 * Group-by-ticket: stack ticket sections, each a labeled header + a tight grid
 * of its photos. Claims group by Zendesk ticket#; other scopes group by `poRef`.
 */
export function PhotoTicketGrid({
  photos,
  scope,
  gridDensity,
  selectionActive,
  selected,
  onSelectTile,
  onPhotoContextMenu,
  openAt,
}: PhotoGridViewProps & { gridDensity: PhotoGridDensity }) {
  const groups = groupPhotosByTicket(photos, scope);
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.key}>
          <header className="mb-2 flex items-center gap-2 border-b border-border-hairline pb-1.5">
            <Layers className="h-3.5 w-3.5 shrink-0 text-text-faint" />
            <span className="truncate text-sm font-semibold text-text-default">
              {group.label}
            </span>
            <span className="shrink-0 rounded-full bg-surface-sunken px-1.5 py-0.5 text-micro font-bold tabular-nums text-text-soft">
              {group.photos.length}
            </span>
            <time className="ml-auto shrink-0 text-micro tabular-nums text-text-faint">
              {formatDateTimePST(group.latestAt)}
            </time>
          </header>
          <div className={photoGridLeafClass(gridDensity)}>
            {group.photos.map((photo) => {
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
                onOpen={() => openAt(photo.id)}
                onContextMenu={onPhotoContextMenu}
              />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
