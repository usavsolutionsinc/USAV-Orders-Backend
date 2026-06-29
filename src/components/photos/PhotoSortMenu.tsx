'use client';

import { ChevronDown, ChevronUp } from '@/components/Icons';
import {
  photoLibraryControlButtonClass,
  photoLibraryControlGroupClass,
} from '@/components/photos/photo-library-controls';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import type { PhotoLibrarySortMode } from '@/lib/photos/library-filter-state';
import { cn } from '@/utils/_cn';

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
          <HoverTooltip key={o.value} label={o.label} asChild>
            <button
              type="button"
              aria-label={o.label}
              aria-pressed={active}
              onClick={() => onSortChange(o.value)}
              className={cn('ds-raw-button', photoLibraryControlButtonClass(active, 'gap-1 whitespace-nowrap px-2'))}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {o.label}
            </button>
          </HoverTooltip>
        );
      })}
    </div>
  );
}
