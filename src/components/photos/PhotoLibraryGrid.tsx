'use client';

import type { LibraryPhoto } from './PhotoLibraryPage';
import { Check } from '@/components/Icons';
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

function SelectionMark({
  checked,
}: {
  checked: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute left-2 top-2 z-20 inline-flex h-6 w-6 items-center justify-center rounded-full border shadow-sm transition',
        checked
          ? 'border-blue-600 bg-blue-600 text-white'
          : 'border-white/80 bg-white/90 text-gray-400 backdrop-blur-sm hover:border-blue-200 hover:text-blue-600',
      )}
    >
      <Check className="h-3.5 w-3.5 stroke-[2.5]" />
    </span>
  );
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
          const rowBody = (
            <>
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                {selectMode ? <SelectionMark checked={isSelected} /> : null}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.thumbUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{fileName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {photoPrimaryLabel(photo)}
                  {photo.damageDetected ? ' · damage' : ''}
                  {photo.hasAnalysis && !photo.damageDetected ? ' · analyzed' : ''}
                </p>
              </div>
              <time className="shrink-0 text-xs tabular-nums text-muted-foreground">{takenAt}</time>
            </>
          );
          return (
            <li key={photo.id}>
              {selectMode ? (
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2.5 text-left',
                    isSelected && 'bg-blue-50/50',
                  )}
                  onClick={() => onToggleSelect(photo.id)}
                >
                  {rowBody}
                </button>
              ) : (
                <a
                  href={photo.displayUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 text-left',
                    isSelected && 'bg-blue-50/50',
                  )}
                >
                  {rowBody}
                </a>
              )}
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
        const imageUrl = view === 'grid-sm' || view === 'grid-lg' ? photo.displayUrl : photo.thumbUrl;
        const cardBody = (
          <>
            <div className="relative aspect-square w-full overflow-hidden bg-muted">
              {selectMode ? <SelectionMark checked={isSelected} /> : null}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt={photo.poRef ? `PO ${photo.poRef}` : `Photo ${photo.id}`}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
            <div className="flex items-start justify-between gap-2 px-2.5 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-semibold text-gray-900">
                  {primaryLabel}
                </div>
                <div className="truncate text-[10px] text-gray-500">{takenAt}</div>
              </div>
            </div>
          </>
        );
        return (
          <div
            key={photo.id}
            className={cn(
              'group overflow-hidden rounded-lg border bg-white text-left transition-colors',
              isSelected ? 'border-primary ring-2 ring-primary' : 'border-border',
              selectMode && 'cursor-pointer hover:border-primary/70 hover:bg-slate-50',
            )}
          >
            {selectMode ? (
              <button
                type="button"
                className="block w-full text-left"
                onClick={() => onToggleSelect(photo.id)}
              >
                {cardBody}
              </button>
            ) : (
              <a href={photo.displayUrl} target="_blank" rel="noreferrer" className="block">
                {cardBody}
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
