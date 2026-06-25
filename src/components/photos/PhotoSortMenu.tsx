'use client';

import { ChevronDown, ChevronUp } from '@/components/Icons';
import {
  photoLibraryControlButtonClass,
  photoLibraryControlGroupClass,
} from '@/components/photos/photo-library-controls';
import type { PhotoLibrarySortMode } from '@/lib/photos/library-filter-state';

const OPTIONS: {
  value: PhotoLibrarySortMode;
  label: string;
  icon: typeof ChevronDown;
}[] = [
  { value: 'recent', label: 'Newest', icon: ChevronUp },
  { value: 'oldest', label: 'Oldest', icon: ChevronDown },
];

/** Right-pane sort toggle — matches the view-mode button cluster in {@link PhotoLibraryHeader}. */
export function PhotoSortMenu({
  sort,
  onSortChange,
}: {
  sort: PhotoLibrarySortMode;
  onSortChange: (s: PhotoLibrarySortMode) => void;
}) {
  return (
    <div className={photoLibraryControlGroupClass} role="group" aria-label="Sort photos">
      {OPTIONS.map((o) => {
        const active = sort === o.value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            title={o.label}
            aria-label={o.label}
            aria-pressed={active}
            onClick={() => onSortChange(o.value)}
            className={photoLibraryControlButtonClass(active, 'gap-1 whitespace-nowrap px-2')}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
