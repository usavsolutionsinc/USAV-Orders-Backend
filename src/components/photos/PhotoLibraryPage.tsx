'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles, Share2 } from '@/components/Icons';
import { ContextualSelectionBar } from '@/design-system/components/ContextualSelectionBar';
import { usePageSelection } from '@/hooks/usePageHeader';
import { useTableSelection } from '@/hooks/useTableSelection';
import { usePhotoLibrary } from '@/hooks/usePhotoLibrary';
import { usePhotoLibraryUrlState } from '@/hooks/usePhotoLibraryUrlState';
import { describePhotoLibraryContext } from '@/lib/photos/library-context-label';
import { PHOTO_LIBRARY_PAGE_SIZE, sourceScopeFromFilters } from '@/lib/photos/library-filter-state';
import { PHOTO_LIBRARY_SELECTION_SCOPE } from '@/lib/photos/photo-library-selection';
import type { SelectionAction } from '@/lib/selection/selection-actions';
import {
  emitSelection,
  emitSelectionTotal,
  onToggleAll,
} from '@/lib/selection/table-selection';
import { toast } from '@/lib/toast';
import { PhotoLibraryGrid } from './PhotoLibraryGrid';
import { PhotoLibraryHeader } from './PhotoLibraryHeader';

// `LibraryPhoto` moved to ./photo-library-types so the grid + hook can share it
// without importing this page (cycle). Re-exported here for compatibility.
export type { LibraryPhoto } from './photo-library-types';
import type { LibraryPhoto } from './photo-library-types';

/** Right pane: 40px header + photo grid + shared selection bar. Filters live in sidebar. */
export function PhotoLibraryPage() {
  const { filters, display, setView, setPage } = usePhotoLibraryUrlState();
  const { query, photos } = usePhotoLibrary(filters);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const selectedRows = useTableSelection<LibraryPhoto>(
    PHOTO_LIBRARY_SELECTION_SCOPE,
    (photo) => photo.id,
  );
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
    setSelected(new Set());
    emitSelection(PHOTO_LIBRARY_SELECTION_SCOPE, []);
  }, []);

  usePageSelection(
    {
      active: selectMode,
      onToggle: () => (selectMode ? exitSelectMode() : setSelectMode(true)),
    },
    [selectMode, exitSelectMode],
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

  useEffect(() => {
    if (!selectMode) {
      emitSelection(PHOTO_LIBRARY_SELECTION_SCOPE, []);
      return;
    }
    const rows = pagePhotos.filter((photo) => selected.has(photo.id));
    emitSelection(PHOTO_LIBRARY_SELECTION_SCOPE, rows);
  }, [selectMode, selected, pagePhotos]);

  useEffect(() => {
    emitSelectionTotal(PHOTO_LIBRARY_SELECTION_SCOPE, selectMode ? pagePhotos.length : 0);
  }, [selectMode, pagePhotos.length]);

  useEffect(() => {
    return onToggleAll(PHOTO_LIBRARY_SELECTION_SCOPE, (mode) => {
      if (mode === 'all') setSelected(new Set(pagePhotos.map((photo) => photo.id)));
      else setSelected(new Set());
    });
  }, [pagePhotos]);

  useEffect(() => {
    if (!selectMode) return;
    setSelected((prev) => {
      const visible = new Set(pagePhotos.map((photo) => photo.id));
      const next = new Set<number>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [pagePhotos, selectMode]);

  const metaLine = query.isLoading
    ? 'Loading…'
    : `${photos.length} photo${photos.length === 1 ? '' : 's'} in view · ${subtitle}`;

  const toggleSelect = useCallback((id: number) => {
    if (!selectMode) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [selectMode]);

  const photoBulkActions = useMemo<SelectionAction<LibraryPhoto>[]>(
    () => [
      {
        key: 'share',
        label: 'Create share pack',
        icon: <Share2 className="h-4 w-4" />,
        tone: 'blue',
        primary: true,
        run: async (rows) => {
          const photoIds = rows.map((row) => row.id);
          const res = await fetch('/api/photos/share-packs', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              photoIds,
              title: `Photo pack (${photoIds.length})`,
              packType: 'manual',
              filenamePrefix: 'Photo',
            }),
          });
          const data = (await res.json()) as { shareUrl?: string; error?: string };
          if (!res.ok) throw new Error(data.error || 'Share pack failed');
          if (data.shareUrl) {
            await navigator.clipboard.writeText(data.shareUrl);
            toast.success('Share pack link copied');
          } else {
            toast.success('Share pack created');
          }
          exitSelectMode();
        },
      },
      {
        key: 'analyze',
        label: 'Analyze selected',
        icon: <Sparkles className="h-4 w-4" />,
        run: async (rows) => {
          const res = await fetch('/api/photos/analyze', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ photoIds: rows.map((row) => row.id).slice(0, 10) }),
          });
          const data = (await res.json()) as { error?: string; enqueued?: number };
          if (!res.ok) throw new Error(data.error || 'Analyze enqueue failed');
          toast.success(
            data.enqueued
              ? `Enqueued ${data.enqueued} analysis job${data.enqueued === 1 ? '' : 's'}`
              : 'Analysis enqueued',
          );
        },
      },
    ],
    [exitSelectMode],
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

      <div className="relative min-h-0 flex-1 overflow-y-auto p-4 pb-20 lg:p-6 lg:pb-24">
        <PhotoLibraryGrid
          photos={pagePhotos}
          view={view}
          sourceScope={sourceScopeFromFilters(filters)}
          onPhotoDeleted={() => void query.refetch()}
          selectMode={selectMode}
          selected={selected}
          onToggleSelect={toggleSelect}
          isLoading={query.isLoading}
          error={query.error instanceof Error ? query.error.message : null}
        />
        {!query.isLoading && pagePhotos.length > 0 && !hasMore && page >= totalPages ? (
          <p className="mt-6 text-center text-[10px] font-bold uppercase tracking-widest text-gray-400">
            {`Showing all ${photos.length} photo${photos.length === 1 ? '' : 's'}`}
          </p>
        ) : null}
        {selectMode ? (
          <ContextualSelectionBar
            scope={PHOTO_LIBRARY_SELECTION_SCOPE}
            rows={selectedRows}
            actions={photoBulkActions}
          />
        ) : null}
      </div>
    </div>
  );
}
