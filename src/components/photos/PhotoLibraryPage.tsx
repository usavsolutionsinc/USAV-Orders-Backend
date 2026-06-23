'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, Download, Link2, Share2, Trash2 } from '@/components/Icons';
import { usePageSelection } from '@/hooks/usePageHeader';
import { usePhotoLibrary } from '@/hooks/usePhotoLibrary';
import { usePhotoLibraryUrlState } from '@/hooks/usePhotoLibraryUrlState';
import { usePhotoSelection } from '@/hooks/usePhotoSelection';
import { usePhotoShareLinks } from '@/hooks/usePhotoShareLinks';
import { describePhotoLibraryContext } from '@/lib/photos/library-context-label';
import { PHOTO_LIBRARY_PAGE_SIZE, sourceScopeFromFilters } from '@/lib/photos/library-filter-state';
import type { SelectionAction } from '@/lib/selection/selection-actions';
import { toast } from '@/lib/toast';
import { dispatchReceivingPhotoChanged } from '@/utils/events';
import { PhotoLibraryGrid } from './PhotoLibraryGrid';
import { PhotoLibraryHeader } from './PhotoLibraryHeader';
import { PhotoLibraryToolbar } from './PhotoLibraryToolbar';

/** Fixed share-link lifetime (24h) for copied links + share pages. */
const DEFAULT_SHARE_TTL_SECONDS = 24 * 60 * 60;

/** Derive a human title for share pages / ZIPs from the selection. */
function shareTitleForRows(rows: { poRef: string | null }[]): string {
  const refs = new Set(rows.map((r) => r.poRef?.trim()).filter(Boolean));
  if (refs.size === 1) return `PO ${[...refs][0]}`;
  return `Photos (${rows.length})`;
}

// `LibraryPhoto` moved to ./photo-library-types so the grid + hook can share it
// without importing this page (cycle). Re-exported here for compatibility.
export type { LibraryPhoto } from './photo-library-types';
import type { LibraryPhoto } from './photo-library-types';

/** Right pane: 40px header + inline bulk toolbar + photo grid. Filters in sidebar. */
export function PhotoLibraryPage() {
  const { filters, display, setView, setPage } = usePhotoLibraryUrlState();
  const { query, photos } = usePhotoLibrary(filters);
  const queryClient = useQueryClient();

  // `selectMode` is the explicit pencil toggle; selection can also start via a
  // modifier-click / hover checkmark even when it's off (Google-Photos model).
  const [selectMode, setSelectMode] = useState(false);
  // Selection persists across the client pages (see usePhotoSelection): a bulk
  // action carries the whole set, not just the visible page.
  const { selected, selectedPhotos, isActive, selectTile, selectAll, clear } =
    usePhotoSelection(photos);
  const selectionActive = selectMode || isActive;

  const shareLinks = usePhotoShareLinks();
  const { title, subtitle } = describePhotoLibraryContext(filters);

  const { page, view } = display;
  const pageSize = PHOTO_LIBRARY_PAGE_SIZE;

  const loadedPages = Math.max(1, Math.ceil(photos.length / pageSize));
  const hasMore = Boolean(query.hasNextPage);
  const totalPages = hasMore ? Math.max(loadedPages, page) : loadedPages;

  const pagePhotos = useMemo(() => {
    const start = (page - 1) * pageSize;
    return photos.slice(start, start + pageSize);
  }, [page, pageSize, photos]);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    clear();
  }, [clear]);

  usePageSelection(
    {
      active: selectionActive,
      onToggle: () => (selectionActive ? exitSelectMode() : setSelectMode(true)),
    },
    [selectionActive, exitSelectMode],
  );

  useEffect(() => {
    const needed = page * pageSize;
    if (photos.length < needed && hasMore && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  }, [page, pageSize, photos.length, hasMore, query]);

  useEffect(() => {
    if (page > totalPages && totalPages > 0) {
      setPage(totalPages);
    }
  }, [page, setPage, totalPages]);

  const metaLine = query.isLoading
    ? 'Loading…'
    : `${photos.length} photo${photos.length === 1 ? '' : 's'} in view · ${subtitle}`;

  const downloadPhotoFile = useCallback(async (url: string, filename: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download ${filename}`);
    const blob = await res.blob();
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(objectUrl);
  }, []);

  const photoBulkActions = useMemo<SelectionAction<LibraryPhoto>[]>(
    () => [
      {
        // Copy time-limited signed links for the whole selection to the clipboard
        // — the single share affordance now that drag-to-share is gone.
        key: 'share',
        label: 'Copy shareable links',
        icon: <Link2 className="h-4 w-4" />,
        tone: 'emerald',
        primary: true,
        run: async (rows) => {
          await shareLinks.generateAndCopy(rows.map((row) => row.id), {
            ttlSeconds: DEFAULT_SHARE_TTL_SECONDS,
          });
        },
      },
      {
        // Durable group link: one tokenized /share/photos page instead of N URLs.
        key: 'share-page',
        label: 'Create share page',
        icon: <Share2 className="h-4 w-4" />,
        tone: 'violet',
        primary: false,
        run: async (rows) => {
          await shareLinks.createSharePage(rows.map((row) => row.id), {
            title: shareTitleForRows(rows),
            expiresInDays: Math.round(DEFAULT_SHARE_TTL_SECONDS / (24 * 60 * 60)),
          });
        },
      },
      {
        // One ZIP attachment for the whole selection (server-built).
        key: 'zip',
        label: 'Download as ZIP',
        icon: <Archive className="h-4 w-4" />,
        tone: 'blue',
        primary: false,
        run: (rows) => {
          shareLinks.downloadZip(rows.map((row) => row.id), { title: shareTitleForRows(rows) });
        },
      },
      {
        key: 'download',
        label: 'Download selected',
        icon: <Download className="h-4 w-4" />,
        tone: 'blue',
        primary: false,
        run: async (rows) => {
          if (rows.length === 0) return;
          const results = await Promise.allSettled(
            rows.map((row, index) =>
              downloadPhotoFile(
                `/api/photos/${row.id}/content?download=1`,
                rows.length === 1 ? `photo-${row.id}.jpg` : `photo-${index + 1}-${row.id}.jpg`,
              ),
            ),
          );
          const failures = results.filter((result) => result.status === 'rejected');
          if (failures.length > 0) {
            toast.error(`Downloaded ${rows.length - failures.length} photo${rows.length - failures.length === 1 ? '' : 's'}; ${failures.length} failed`);
          } else {
            toast.success(`Downloaded ${rows.length} photo${rows.length === 1 ? '' : 's'}`);
          }
        },
      },
      {
        key: 'delete',
        label: 'Delete selected',
        icon: <Trash2 className="h-4 w-4" />,
        tone: 'red',
        primary: false,
        run: async (rows) => {
          if (rows.length === 0) return;
          const ok = window.confirm(
            `Delete ${rows.length} selected photo${rows.length === 1 ? '' : 's'}? This cannot be undone.`,
          );
          if (!ok) return;
          const results = await Promise.allSettled(
            rows.map(async (row) => {
              const res = await fetch(`/api/photos/${row.id}`, { method: 'DELETE' });
              const data = (await res.json().catch(() => null)) as { error?: string } | null;
              if (!res.ok) throw new Error(data?.error || `Delete failed for photo ${row.id}`);
              return row.id;
            }),
          );
          const deletedIds = results
            .filter((result): result is PromiseFulfilledResult<number> => result.status === 'fulfilled')
            .map((result) => result.value);
          const failures = results.filter((result) => result.status === 'rejected');
          if (deletedIds.length > 0) {
            dispatchReceivingPhotoChanged({ action: 'delete', photoIds: deletedIds });
          }
          await queryClient.invalidateQueries({ queryKey: ['photo-library'] });
          exitSelectMode();
          if (failures.length > 0) {
            toast.error(`Deleted ${rows.length - failures.length} photo${rows.length - failures.length === 1 ? '' : 's'}; ${failures.length} failed`);
          } else {
            toast.success(`Deleted ${rows.length} photo${rows.length === 1 ? '' : 's'}`);
          }
        },
      },
    ],
    [downloadPhotoFile, exitSelectMode, queryClient, shareLinks],
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-white">
      <PhotoLibraryHeader
        title={title}
        metaLine={metaLine}
        view={view}
        onViewChange={setView}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        isLoading={query.isLoading || query.isFetchingNextPage}
      />

      {selectionActive ? (
        <PhotoLibraryToolbar
          rows={selectedPhotos}
          total={photos.length}
          actions={photoBulkActions}
          onSelectAll={selectAll}
          onClear={exitSelectMode}
        />
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-y-auto p-4 pb-6 lg:p-6">
        <PhotoLibraryGrid
          photos={pagePhotos}
          view={view}
          sourceScope={sourceScopeFromFilters(filters)}
          onPhotoDeleted={() => void query.refetch()}
          selectionActive={selectionActive}
          selected={selected}
          onSelectTile={selectTile}
          isLoading={query.isLoading}
          error={query.error instanceof Error ? query.error.message : null}
        />
        {!query.isLoading && pagePhotos.length > 0 && !hasMore && page >= totalPages ? (
          <p className="mt-6 text-center text-[10px] font-bold uppercase tracking-widest text-gray-400">
            {`Showing all ${photos.length} photo${photos.length === 1 ? '' : 's'}`}
          </p>
        ) : null}
      </div>
    </div>
  );
}
