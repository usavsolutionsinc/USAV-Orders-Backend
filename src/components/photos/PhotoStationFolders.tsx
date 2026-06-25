'use client';

import {
  Camera,
  MessageSquare,
  Package,
  PackageOpen,
  ShoppingCart,
  Wrench,
} from '@/components/Icons';
import { cn } from '@/utils/_cn';
import type {
  PhotoLibraryFilterState,
  PhotoLibrarySourceScope,
} from '@/lib/photos/library-filter-state';
import type { LibraryPhoto } from './photo-library-types';
import { PhotoDateTree, type PhotoDateSelection } from './PhotoDateTree';

/**
 * Two-step contextual browse: first **pick the image type** (unboxing / packing /
 * …), then **drill one date tree** for that type. The type picker is a single
 * grouped control (not six individual expandable folders), and the date tree is a
 * single grouped section below it — so years/months/days stay scoped to one
 * stream instead of mixing every station. "All" is the flat, sorted overview.
 */
const TYPES: { id: PhotoLibrarySourceScope; label: string; icon: typeof Camera }[] = [
  { id: 'all', label: 'All', icon: Camera },
  { id: 'unboxing', label: 'Unboxing', icon: PackageOpen },
  { id: 'local_pickup', label: 'Pickups', icon: ShoppingCart },
  { id: 'packing', label: 'Packing', icon: Package },
  { id: 'repair', label: 'Repair', icon: Wrench },
  { id: 'claims', label: 'Claims', icon: MessageSquare },
];

export function PhotoStationFolders({
  activeScope,
  photos,
  filters,
  onSelectScope,
  onSelectDate,
}: {
  activeScope: PhotoLibrarySourceScope;
  /** Loaded photos for the active type — feeds the date tree below. */
  photos: LibraryPhoto[];
  filters: PhotoLibraryFilterState;
  onSelectScope: (scope: PhotoLibrarySourceScope) => void;
  onSelectDate: (sel: PhotoDateSelection) => void;
}) {
  const activeType = TYPES.find((t) => t.id === activeScope) ?? TYPES[0];
  const ActiveIcon = activeType.icon;
  const showDates = activeScope !== 'all';

  return (
    <div className="space-y-3">
      {/* Step 1 — pick the image type. */}
      <div className="space-y-1.5">
        <p className="px-1 text-micro font-black uppercase tracking-wider text-gray-400">Image type</p>
        <div className="flex flex-wrap gap-1">
          {TYPES.map((type) => {
            const active = activeScope === type.id;
            const Icon = type.icon;
            return (
              <button
                key={type.id}
                type="button"
                onClick={() => onSelectScope(type.id)}
                aria-pressed={active}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold transition',
                  active ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                )}
              >
                <Icon className="h-3 w-3" />
                {type.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 2 — drill the selected type's calendar (one grouped tree). */}
      {showDates ? (
        <div className="space-y-1.5 border-t border-gray-100 pt-3">
          <p className="flex items-center gap-1 px-1 text-micro font-black uppercase tracking-wider text-gray-400">
            <ActiveIcon className="h-3 w-3" /> {activeType.label} · by date
          </p>
          <PhotoDateTree photos={photos} filters={filters} onSelect={onSelectDate} embedded />
        </div>
      ) : (
        <p className="border-t border-gray-100 px-1 pt-3 text-[11px] leading-relaxed text-gray-400">
          Showing all photos, newest first. Pick a type above to browse it by date.
        </p>
      )}
    </div>
  );
}
