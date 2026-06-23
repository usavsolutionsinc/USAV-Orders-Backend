'use client';

import {
  Camera,
  Clock,
  History,
  MessageSquare,
  Package,
  PackageOpen,
  Truck,
  Wrench,
} from '@/components/Icons';
import { cn } from '@/utils/_cn';
import type {
  PhotoLibrarySortMode,
  PhotoLibrarySourceScope,
} from '@/lib/photos/library-filter-state';

const SOURCE_ITEMS: Array<{
  id: PhotoLibrarySourceScope;
  label: string;
  icon: typeof Camera;
}> = [
  { id: 'all', label: 'All photos', icon: Camera },
  { id: 'unboxing', label: 'Unboxing', icon: PackageOpen },
  { id: 'local_pickup', label: 'Local pickups', icon: Truck },
  { id: 'packing', label: 'Packing', icon: Package },
  { id: 'repair', label: 'Repair services', icon: Wrench },
  { id: 'claims', label: 'Zendesk claims', icon: MessageSquare },
];

const SORT_ITEMS: Array<{
  id: PhotoLibrarySortMode;
  label: string;
  icon: typeof Clock;
}> = [
  { id: 'recent', label: 'Recent first', icon: Clock },
  { id: 'oldest', label: 'Oldest first', icon: History },
];

interface PhotoLibrarySidebarNavProps {
  sourceScope: PhotoLibrarySourceScope;
  sort: PhotoLibrarySortMode;
  onSelectScope: (scope: PhotoLibrarySourceScope) => void;
  onSelectSort: (sort: PhotoLibrarySortMode) => void;
}

function ListRow({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: typeof Camera;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left transition',
          active
            ? 'border-blue-200 bg-blue-50/80 text-blue-900'
            : 'border-gray-100 bg-white text-gray-700 hover:border-gray-200 hover:bg-gray-50',
        )}
      >
        <span
          className={cn(
            'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
            active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500',
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{label}</span>
      </button>
    </li>
  );
}

export function PhotoLibrarySidebarNav({
  sourceScope,
  sort,
  onSelectScope,
  onSelectSort,
}: PhotoLibrarySidebarNavProps) {
  return (
    <div className="space-y-4 pb-4">
      <div className="space-y-2">
        <p className="px-1 text-micro font-black uppercase tracking-wider text-gray-400">Browse</p>
        <ul className="space-y-1">
          {SOURCE_ITEMS.map((item) => (
            <ListRow
              key={item.id}
              label={item.label}
              icon={item.icon}
              active={sourceScope === item.id}
              onClick={() => onSelectScope(item.id)}
            />
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <p className="px-1 text-micro font-black uppercase tracking-wider text-gray-400">Sort</p>
        <ul className="space-y-1">
          {SORT_ITEMS.map((item) => (
            <ListRow
              key={item.id}
              label={item.label}
              icon={item.icon}
              active={sort === item.id}
              onClick={() => onSelectSort(item.id)}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
