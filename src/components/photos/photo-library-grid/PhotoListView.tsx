'use client';

import { formatDateTimePST } from '@/utils/date';
import { cn } from '@/utils/_cn';
import { PhotoThumb } from '../PhotoThumb';
import { SelectionMark } from './SelectionMark';
import { clickSelectsInstead, photoFileName, photoPrimaryLabel } from './photo-grid-format';
import type { PhotoGridViewProps } from './types';

/** List view — a divided vertical roster of photo rows (filename + meta + time). */
export function PhotoListView({
  photos,
  scope,
  selectionActive,
  selected,
  onSelectTile,
  onPhotoContextMenu,
  openAt,
}: PhotoGridViewProps) {
  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-border bg-card">
      {photos.map((photo) => {
        const isSelected = selected.has(photo.id);
        const takenAt = formatDateTimePST(photo.createdAt);
        const fileName = photoFileName(photo, scope);
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
                'ds-raw-button flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50',
                isSelected && 'bg-blue-50/50',
              )}
            >
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border">
                <PhotoThumb src={photo.thumbUrl} alt="" damage={Boolean(photo.damageDetected)} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{fileName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {photoPrimaryLabel(photo, scope)}
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
  );
}
