'use client';

import { Layers } from '@/components/Icons';
import { formatDateTimePST } from '@/utils/date';
import { PhotoCard } from './PhotoCard';
import { groupPhotosByTicket, UNLINKED_TICKET_KEY } from './photo-grid-format';
import type { PhotoGridViewProps } from './types';

/**
 * Group-by-ticket: stack ticket sections, each a labeled header + a tight grid
 * of its photos. The grouping key is `poRef` (the ticket number).
 */
export function PhotoTicketGrid({
  photos,
  scope,
  selectionActive,
  selected,
  onSelectTile,
  onPhotoContextMenu,
  openAt,
}: PhotoGridViewProps) {
  const groups = groupPhotosByTicket(photos);
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.key}>
          <header className="mb-2 flex items-center gap-2 border-b border-gray-100 pb-1.5">
            <Layers className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            <span className="truncate text-sm font-semibold text-gray-900">
              {group.key === UNLINKED_TICKET_KEY ? group.label : `PO ${group.label}`}
            </span>
            <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-micro font-bold tabular-nums text-gray-500">
              {group.photos.length}
            </span>
            <time className="ml-auto shrink-0 text-micro tabular-nums text-gray-400">
              {formatDateTimePST(group.latestAt)}
            </time>
          </header>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-8">
            {group.photos.map((photo) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                imageUrl={photo.thumbUrl}
                scope={scope}
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
  );
}
