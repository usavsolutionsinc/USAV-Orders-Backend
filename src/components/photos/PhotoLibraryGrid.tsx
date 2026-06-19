'use client';

import type { LibraryPhoto } from './PhotoLibraryPage';
import { formatDateTimePST } from '@/utils/date';
import type { PhotoLibraryViewMode } from '@/lib/photos/library-filter-state';
import { cn } from '@/utils/_cn';

interface PhotoLibraryGridProps {
  photos: LibraryPhoto[];
  view: PhotoLibraryViewMode;
  selectMode: boolean;
  selected: Set<number>;
  onToggleSelect: (id: number) => void;
  isLoading: boolean;
  error: string | null;
}

function photoFileName(photo: LibraryPhoto): string {
  if (photo.poRef) return `PO-${photo.poRef}-${photo.id}.jpg`;
  const type = photo.photoType?.toLowerCase().replace(/_/g, '-') ?? 'photo';
  return `${type}-${photo.id}.jpg`;
}

function photoPrimaryLabel(photo: LibraryPhoto): string {
  if (photo.poRef) return `PO ${photo.poRef}`;
  return photo.photoType?.replace(/_/g, ' ').toLowerCase() ?? `Photo ${photo.id}`;
}

export function PhotoLibraryGrid({
  photos,
  view,
  selectMode,
  selected,
  onToggleSelect,
  isLoading,
  error,
}: PhotoLibraryGridProps) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading photos…</p>;
  }
  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }
  if (photos.length === 0) {
    return <p className="text-sm text-muted-foreground">No photos match these filters.</p>;
  }

  if (view === 'list') {
    return (
      <ul className="divide-y divide-gray-100 rounded-lg border border-border bg-card">
        {photos.map((photo) => {
          const isSelected = selected.has(photo.id);
          const takenAt = formatDateTimePST(photo.createdAt);
          const fileName = photoFileName(photo);
          return (
            <li key={photo.id}>
              <div
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5',
                  isSelected && 'bg-blue-50/50',
                )}
              >
                {selectMode ? (
                  <button
                    type="button"
                    className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium"
                    onClick={() => onToggleSelect(photo.id)}
                  >
                    {isSelected ? 'Selected' : 'Select'}
                  </button>
                ) : null}
                <a
                  href={photo.displayUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-muted"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.thumbUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </a>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{fileName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {photoPrimaryLabel(photo)}
                    {photo.damageDetected ? ' · damage' : ''}
                    {photo.hasAnalysis && !photo.damageDetected ? ' · analyzed' : ''}
                  </p>
                </div>
                <time className="shrink-0 text-xs tabular-nums text-muted-foreground">{takenAt}</time>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  const gridClass =
    view === 'grid-sm'
      ? 'grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-8'
      : 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6';

  return (
    <div className={gridClass}>
      {photos.map((photo) => {
        const isSelected = selected.has(photo.id);
        const primaryLabel = photoPrimaryLabel(photo);
        const takenAt = formatDateTimePST(photo.createdAt);
        return (
          <div
            key={photo.id}
            className={cn(
              'group relative aspect-square overflow-hidden rounded-lg border bg-muted',
              isSelected ? 'ring-2 ring-primary border-primary' : 'border-border',
              selectMode && 'cursor-pointer',
            )}
            onClick={selectMode ? () => onToggleSelect(photo.id) : undefined}
            onKeyDown={
              selectMode
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onToggleSelect(photo.id);
                    }
                  }
                : undefined
            }
            role={selectMode ? 'button' : undefined}
            tabIndex={selectMode ? 0 : undefined}
          >
            {selectMode ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={photo.thumbUrl}
                alt={photo.poRef ? `PO ${photo.poRef}` : `Photo ${photo.id}`}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <a href={photo.displayUrl} target="_blank" rel="noreferrer" className="block h-full w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.thumbUrl}
                  alt={photo.poRef ? `PO ${photo.poRef}` : `Photo ${photo.id}`}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </a>
            )}
            {selectMode ? (
              <span
                className={cn(
                  'absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-medium',
                  isSelected
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background/80 text-foreground',
                )}
              >
                {isSelected ? 'Selected' : 'Select'}
              </span>
            ) : null}
            <span className="absolute bottom-0 left-0 right-0 bg-black/55 px-2 py-1 text-[11px] text-white pointer-events-none">
              {primaryLabel}
              {photo.damageDetected ? ' · damage' : ''}
              {photo.hasAnalysis && !photo.damageDetected ? ' · analyzed' : ''}
              <span className="block truncate text-[10px] text-white/75">{takenAt}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
