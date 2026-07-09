'use client';

import { photoHeroLayoutId } from '@/components/shipped/photo-gallery/photo-gallery-utils';
import { formatDateTimePST } from '@/utils/date';
import { cn } from '@/utils/_cn';
import { PhotoThumb } from '../PhotoThumb';
import { GroupSelectionMark } from './GroupSelectionMark';
import { SelectionMark } from './SelectionMark';
import { clickSelectsInstead, groupPhotosByTicket, photoFileName, photoPrimaryLabel } from './photo-grid-format';
import type { PhotoGridViewProps } from './types';

/** List view — PO/ticket-grouped vertical rosters with space between each link group. */
export function PhotoListView({
  photos,
  scope,
  selectionActive,
  selected,
  onSelectTile,
  onToggleGroupSelection,
  onPhotoContextMenu,
  openAt,
}: PhotoGridViewProps) {
  const groups = groupPhotosByTicket(photos, scope);
  const showGroupHeaders = groups.length > 1 || selectionActive;

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const groupIds = group.photos.map((p) => p.id);
        const allGroupSelected =
          groupIds.length > 0 && groupIds.every((id) => selected.has(id));
        const someGroupSelected = groupIds.some((id) => selected.has(id));

        return (
          <section key={group.key} className="space-y-1.5">
            {showGroupHeaders ? (
              <header className="flex items-center gap-2 px-1">
                {selectionActive && onToggleGroupSelection ? (
                  <GroupSelectionMark
                    allSelected={allGroupSelected}
                    someSelected={someGroupSelected && !allGroupSelected}
                    label={group.label}
                    onToggle={() => onToggleGroupSelection(groupIds)}
                  />
                ) : null}
                <span className="truncate text-eyebrow font-black uppercase tracking-widest text-text-soft">
                  {group.label}
                </span>
                <span className="shrink-0 rounded-full bg-surface-sunken px-1.5 py-0.5 text-micro font-bold tabular-nums text-text-soft">
                  {group.photos.length}
                </span>
              </header>
            ) : null}
            <ul className="divide-y divide-border-hairline overflow-hidden rounded-lg border border-border bg-card">
              {group.photos.map((photo) => {
                const isSelected = selected.has(photo.id);
                const takenAt = formatDateTimePST(photo.createdAt);
                const fileName = photoFileName(photo, scope);
                const metaLabel = photoPrimaryLabel(photo, scope);
                const statusLabel = [
                  photo.damageDetected && 'damage',
                  photo.hasAnalysis && !photo.damageDetected && 'analyzed',
                ]
                  .filter(Boolean)
                  .join(' · ');
                const subtitle = showGroupHeaders
                  ? statusLabel
                  : [metaLabel, statusLabel].filter(Boolean).join(' · ');
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
                        'ds-raw-button flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-surface-hover',
                        isSelected && 'bg-blue-50/50',
                      )}
                    >
                      <div className="relative h-12 w-12 shrink-0 rounded-md border border-border">
                        <PhotoThumb
                          src={photo.thumbUrl}
                          alt=""
                          damage={Boolean(photo.damageDetected)}
                          heroId={photoHeroLayoutId(photo.id)}
                          className="rounded-md"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{fileName}</p>
                        {subtitle ? (
                          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
                        ) : null}
                      </div>
                      <time className="shrink-0 text-xs tabular-nums text-muted-foreground">{takenAt}</time>
                    </button>
                    <SelectionMark
                      checked={isSelected}
                      active={selectionActive}
                      onToggle={(mods) => onSelectTile(photo.id, mods)}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
