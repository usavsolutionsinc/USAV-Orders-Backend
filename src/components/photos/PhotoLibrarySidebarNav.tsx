'use client';

import { useCallback, useEffect, useState } from 'react';
import { Camera, MessageSquare, Package, PackageOpen } from '@/components/Icons';
import { microBadge } from '@/design-system/tokens/typography/presets';
import {
  PHOTO_SOURCE_SCOPE_LABELS,
  type PhotoLibraryFilterState,
  type PhotoLibrarySourceScope,
  sourceScopeFromFilters,
} from '@/lib/photos/library-filter-state';
import { describePhotoLibraryContext } from '@/lib/photos/library-context-label';
import { cn } from '@/utils/_cn';

const RECENT_STORAGE_KEY = 'photo_library_recent';
const MAX_RECENTS = 8;

interface RecentEntry {
  label: string;
  href: string;
}

const SOURCE_ROWS: Array<{
  id: PhotoLibrarySourceScope;
  icon: typeof Camera;
}> = [
  { id: 'all', icon: Camera },
  { id: 'unboxing', icon: PackageOpen },
  { id: 'packing', icon: Package },
  { id: 'claims', icon: MessageSquare },
];

interface PhotoLibrarySidebarNavProps {
  filters: PhotoLibraryFilterState;
  onSelectScope: (scope: PhotoLibrarySourceScope) => void;
  onNavigateRecent: (href: string) => void;
}

function readRecents(): RecentEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

export function pushPhotoLibraryRecent(entry: RecentEntry) {
  if (typeof window === 'undefined') return;
  const prev = readRecents().filter((r) => r.href !== entry.href);
  const next = [entry, ...prev].slice(0, MAX_RECENTS);
  localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
}

export function PhotoLibrarySidebarNav({
  filters,
  onSelectScope,
  onNavigateRecent,
}: PhotoLibrarySidebarNavProps) {
  const activeScope = sourceScopeFromFilters(filters);
  const { title } = describePhotoLibraryContext(filters);
  const [recents, setRecents] = useState<RecentEntry[]>([]);

  useEffect(() => {
    setRecents(readRecents());
  }, [filters]);

  const persistCurrentContext = useCallback(() => {
    const params = new URLSearchParams();
    if (filters.receivingId) params.set('receivingId', filters.receivingId);
    if (filters.poRef) params.set('poRef', filters.poRef);
    if (filters.entityType) params.set('entityType', filters.entityType);
    if (filters.entityId) params.set('entityId', filters.entityId);
    if (params.toString().length === 0) return;
    const href = `/ops/photos?${params.toString()}`;
    pushPhotoLibraryRecent({ label: title, href });
    setRecents(readRecents());
  }, [filters, title]);

  useEffect(() => {
    persistCurrentContext();
  }, [persistCurrentContext]);

  return (
    <div className="space-y-4 pb-4">
      <ul className="space-y-1">
        {SOURCE_ROWS.map(({ id, icon: Icon }) => {
          const selected = activeScope === id;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onSelectScope(id)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition',
                  selected
                    ? 'border-blue-200 bg-blue-50/70 font-semibold text-blue-900 ring-1 ring-inset ring-blue-200'
                    : 'border-transparent text-gray-700 hover:border-gray-200 hover:bg-white',
                )}
              >
                <Icon className={cn('h-4 w-4 shrink-0', selected ? 'text-blue-600' : 'text-gray-400')} />
                <span className="truncate">{PHOTO_SOURCE_SCOPE_LABELS[id]}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {recents.length > 0 ? (
        <div>
          <p className={`${microBadge} mb-2 px-1 font-black uppercase tracking-wider text-gray-400`}>
            Recent
          </p>
          <ul className="space-y-1">
            {recents.map((r) => (
              <li key={r.href}>
                <button
                  type="button"
                  onClick={() => onNavigateRecent(r.href)}
                  className="w-full truncate rounded-lg px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
