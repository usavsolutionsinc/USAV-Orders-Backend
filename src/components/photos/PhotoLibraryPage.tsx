'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, ExternalLink, Link2, Loader2, MessageSquare, Tag, Trash2 } from '@/components/Icons';
import { usePageSelection } from '@/hooks/usePageHeader';
import { usePhotoLibrary } from '@/hooks/usePhotoLibrary';
import { usePhotoLibraryUrlState } from '@/hooks/usePhotoLibraryUrlState';
import { usePhotoSelection } from '@/hooks/usePhotoSelection';
import { usePhotoShareLinks } from '@/hooks/usePhotoShareLinks';
import { describePhotoLibraryContext } from '@/lib/photos/library-context-label';
import { buildPhotoDateTree } from '@/lib/photos/date-tree';
import { sourceScopeFromFilters, todayFoldersDateFilter } from '@/lib/photos/library-filter-state';
import { describeFolderBrowseHeader } from '@/components/photos/photo-library-grid/date-folder-tree';
import { getCurrentPSTDateKey } from '@/utils/date';
import type { SelectionAction } from '@/lib/selection/selection-actions';
import { toast } from '@/lib/toast';
import { dispatchReceivingPhotoChanged } from '@/utils/events';
import { usePackerPhotosRealtimeRefresh } from '@/hooks/usePackerPhotosRealtimeRefresh';
import { useAuth } from '@/contexts/AuthContext';
import { ZendeskClaimModal } from '@/components/support/zendesk/claim/ZendeskClaimModal';
import type { ClaimPhotoInput } from '@/components/support/zendesk/claim/claim-types';
import { RightPaneOverlayHost } from '@/components/ui/RightPaneOverlay';
import { PhotoContextMenu, type PhotoContextMenuItem } from './PhotoContextMenu';
import { PhotoDateBreadcrumb } from './PhotoDateBreadcrumb';
import { PhotoLibraryGrid } from './PhotoLibraryGrid';
import { PhotoLibraryHeader } from './PhotoLibraryHeader';
import { PhotoLibraryToolbar } from './PhotoLibraryToolbar';
import { PhotoLabelEditor } from './PhotoLabelEditor';

/** Fixed share-link lifetime (24h) for copied links + share pages. */
const DEFAULT_SHARE_TTL_SECONDS = 24 * 60 * 60;

// `LibraryPhoto` moved to ./photo-library-types so the grid + hook can share it
// without importing this page (cycle). Re-exported here for compatibility.
export type { LibraryPhoto } from './photo-library-types';
import type { LibraryPhoto } from './photo-library-types';

/** Right pane: 40px header + inline bulk toolbar + photo grid. Filters in sidebar. */
export function PhotoLibraryPage() {
  const { filters, display, setView, patch } = usePhotoLibraryUrlState();
  const { query, photos } = usePhotoLibrary(filters);
  const queryClient = useQueryClient();

  // A finder search (serial/tracking/order/PO) resolves to one PO when every
  // loaded photo shares it. Mirror that PO into the breadcrumb + folder-path
  // chrome so the right panel reads like an opened PO folder — without writing
  // poRef to the URL (the search box stays the source of truth). An explicit PO
  // drill (filters.poRef) always wins; a multi-PO finder result stays generic.
  const resolvedPoRef = useMemo<string | undefined>(() => {
    if (filters.poRef) return filters.poRef;
    if (!filters.poFinder || photos.length === 0) return undefined;
    const refs = new Set(photos.map((p) => p.poRef ?? '').filter(Boolean));
    return refs.size === 1 ? [...refs][0] : undefined;
  }, [filters.poRef, filters.poFinder, photos]);
  // The PST capture-day span of the photos in view. Under a PO leaf this lets the
  // breadcrumb descend to the actual day(s) instead of stopping at the week — so a
  // single-day PO reads `… › Week 27 › Jun 30 › PO 14-…`. Tree order is newest-first.
  const photoDaySpan = useMemo<{ from: string; to: string } | null>(() => {
    const days: string[] = [];
    for (const yr of buildPhotoDateTree(photos))
      for (const mo of yr.months) for (const d of mo.days) days.push(d.ymd);
    return days.length ? { from: days[days.length - 1], to: days[0] } : null;
  }, [photos]);

  // Filters with the resolved PO + the photos' real day span folded in, for the
  // display chrome that reads `poRef`/dates (breadcrumbs, folder header, context
  // label). Identity-stable when there's no PO context to enrich.
  const displayFilters = useMemo(() => {
    if (!resolvedPoRef) return filters;
    const withPo = filters.poRef ? filters : { ...filters, poRef: resolvedPoRef };
    return photoDaySpan
      ? { ...withPo, dateFrom: photoDaySpan.from, dateTo: photoDaySpan.to }
      : withPo;
  }, [filters, resolvedPoRef, photoDaySpan]);
  const { has } = useAuth();
  const canZendesk = has('integrations.zendesk');
  const canManagePhotos = has('photos.manage');

  // Photos staged for the "Create Zendesk ticket" modal (null = closed).
  const [claimPhotos, setClaimPhotos] = useState<ClaimPhotoInput[] | null>(null);
  // Photos staged for the label editor (null = closed; 1 = single PUT, N = bulk).
  const [labelEditorPhotos, setLabelEditorPhotos] = useState<LibraryPhoto[] | null>(null);
  // Right-click context menu target (null = closed).
  const [ctxMenu, setCtxMenu] = useState<{ photo: LibraryPhoto; x: number; y: number } | null>(null);

  // Live-refresh when a packer's phone commits a GCS upload (station channel),
  // mirroring how receiving photos already propagate into the library.
  const refreshLibraryOnPackerPhoto = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['photo-library'] });
  }, [queryClient]);
  usePackerPhotosRealtimeRefresh(null, refreshLibraryOnPackerPhoto);

  // `selectMode` is the explicit pencil toggle; selection can also start via a
  // modifier-click / hover checkmark even when it's off (Google-Photos model).
  const [selectMode, setSelectMode] = useState(false);
  // Selection persists across the client pages (see usePhotoSelection): a bulk
  // action carries the whole set, not just the visible page.
  const { selected, selectedPhotos, isActive, selectTile, selectAll, clear } =
    usePhotoSelection(photos);
  const selectionActive = selectMode || isActive;

  const shareLinks = usePhotoShareLinks();
  const { title, subtitle } = describePhotoLibraryContext(displayFilters);
  const scope = sourceScopeFromFilters(filters);

  const { view } = display;

  const folderBrowse = useMemo(() => {
    if (view !== 'folders') return null;
    return describeFolderBrowseHeader({
      photos,
      scope,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      poRef: resolvedPoRef,
    });
  }, [view, photos, scope, filters.dateFrom, filters.dateTo, resolvedPoRef]);

  // Date breadcrumb defaults (right-panel footer): today + the most recent
  // capture day across the loaded photos — both keyed off `created_at` (PST),
  // never the most-recent PO or photo type.
  const today = useMemo(() => getCurrentPSTDateKey(), []);
  const foldersDateInitialized = useRef(false);

  // Folders view opens on today when the URL has no date drill (first load).
  useEffect(() => {
    if (foldersDateInitialized.current) return;
    if (view !== 'folders') return;
    // A finder search owns the result set — don't clobber it with today's date.
    if (filters.dateFrom || filters.dateTo || filters.poRef || filters.poFinder) return;
    foldersDateInitialized.current = true;
    patch(todayFoldersDateFilter());
  }, [view, filters.dateFrom, filters.dateTo, filters.poRef, filters.poFinder, patch]);

  const handleViewChange = useCallback(
    (next: typeof view) => {
      if (next === 'folders') {
        patch({ ...todayFoldersDateFilter(), poRef: undefined });
      }
      setView(next);
    },
    [patch, setView],
  );
  const mostRecentDay = useMemo(
    () => buildPhotoDateTree(photos)[0]?.months[0]?.days[0]?.ymd,
    [photos],
  );

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

  // Infinite scroll: load the next page when the sentinel near the bottom of the
  // scroll region scrolls into view. `rootMargin` pre-fetches ~600px early so the
  // grid fills before the user reaches the end. Replaces the old prev/next pager.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
          void query.fetchNextPage();
        }
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [query.hasNextPage, query.isFetchingNextPage, query]);

  const metaLine = query.isLoading
    ? 'Loading…'
    : folderBrowse?.isLeaf
      ? `${folderBrowse.count} photo${folderBrowse.count === 1 ? '' : 's'}`
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

  const deletePhotoFromMenu = useCallback(
    async (id: number) => {
      if (!window.confirm('Delete this photo? This cannot be undone.')) return;
      try {
        const res = await fetch(`/api/photos/${id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error || 'Delete failed');
        }
        dispatchReceivingPhotoChanged({ action: 'delete', photoIds: [id] });
        await queryClient.invalidateQueries({ queryKey: ['photo-library'] });
        toast.success('Photo deleted');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Delete failed');
      }
    },
    [queryClient],
  );

  // Per-photo right-click actions — the "drilling" menu (view, copy link, attach
  // to a Zendesk ticket, download, delete). Mirrors the bulk toolbar for one photo.
  const photoMenuItems = useCallback(
    (photo: LibraryPhoto): PhotoContextMenuItem[] => [
      {
        key: 'open',
        label: 'Open in new tab',
        icon: <ExternalLink className="h-3.5 w-3.5" />,
        onClick: () => window.open(`/api/photos/${photo.id}/content`, '_blank', 'noopener'),
      },
      {
        key: 'copy',
        label: 'Copy shareable link',
        icon: <Link2 className="h-3.5 w-3.5" />,
        onClick: () =>
          void shareLinks.generateAndCopy([photo.id], { ttlSeconds: DEFAULT_SHARE_TTL_SECONDS }),
      },
      ...(canZendesk
        ? [
            {
              key: 'zendesk',
              label: 'Attach to Zendesk ticket',
              icon: <MessageSquare className="h-3.5 w-3.5" />,
              onClick: () =>
                setClaimPhotos([
                  { id: photo.id, src: photo.thumbUrl, poRef: photo.poRef, caption: photo.caption ?? null },
                ]),
            } satisfies PhotoContextMenuItem,
          ]
        : []),
      ...(canManagePhotos
        ? [
            {
              key: 'labels',
              label: 'Edit labels',
              icon: <Tag className="h-3.5 w-3.5" />,
              onClick: () => setLabelEditorPhotos([photo]),
            } satisfies PhotoContextMenuItem,
          ]
        : []),
      {
        key: 'download',
        label: 'Download',
        icon: <Download className="h-3.5 w-3.5" />,
        onClick: () =>
          void downloadPhotoFile(`/api/photos/${photo.id}/content?download=1`, `photo-${photo.id}.jpg`).catch(
            () => toast.error('Download failed'),
          ),
      },
      {
        key: 'delete',
        label: 'Delete',
        danger: true,
        separatorBefore: true,
        icon: <Trash2 className="h-3.5 w-3.5" />,
        onClick: () => void deletePhotoFromMenu(photo.id),
      },
    ],
    [canManagePhotos, canZendesk, deletePhotoFromMenu, downloadPhotoFile, shareLinks],
  );

  const deleteSelectedPhotos = useCallback(
    async (rows: LibraryPhoto[]) => {
      if (rows.length === 0) return;
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
    [exitSelectMode, queryClient],
  );

  const photoBulkActions = useMemo<SelectionAction<LibraryPhoto>[]>(
    () => [
      ...(canZendesk
        ? [
            {
              // Attach the selection to a Zendesk ticket (new or existing).
              key: 'zendesk',
              label: 'Add photos to a ticket',
              icon: <MessageSquare className="h-4 w-4" />,
              tone: 'blue' as const,
              primary: true,
              run: (rows: LibraryPhoto[]) => {
                setClaimPhotos(
                  rows.map((row) => ({
                    id: row.id,
                    src: row.thumbUrl,
                    poRef: row.poRef,
                    caption: row.caption ?? null,
                  })),
                );
              },
            } satisfies SelectionAction<LibraryPhoto>,
          ]
        : []),
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
      ...(canManagePhotos
        ? [
            {
              // Open the label editor for the selection (bulk add/remove diff).
              key: 'labels',
              label: 'Edit labels',
              icon: <Tag className="h-4 w-4" />,
              tone: 'violet' as const,
              primary: false,
              run: (rows: LibraryPhoto[]) => setLabelEditorPhotos(rows),
            } satisfies SelectionAction<LibraryPhoto>,
          ]
        : []),
    ],
    [canManagePhotos, canZendesk, downloadPhotoFile],
  );

  return (
    <RightPaneOverlayHost className="flex h-full min-h-0 flex-col">
    <div className="relative flex h-full min-h-0 flex-col bg-white">
      <PhotoLibraryHeader
        title={title}
        metaLine={metaLine}
        folderBrowse={folderBrowse}
        view={view}
        onViewChange={handleViewChange}
        sort={filters.sort ?? 'recent'}
        onSortChange={(sort) => patch({ sort })}
      />

      {/* Top context bar — folder path by default, swapped for the bulk-action bar
          while selecting. Both share the same height so toggling selection never
          shifts the layout (the path stays mirrored in the footer below). */}
      {selectionActive ? (
        <PhotoLibraryToolbar
          rows={selectedPhotos}
          total={photos.length}
          actions={photoBulkActions}
          onDeleteSelected={deleteSelectedPhotos}
          onSelectAll={selectAll}
          onClear={exitSelectMode}
        />
      ) : (
        <div className="flex h-[40px] shrink-0 items-center border-b border-gray-200 bg-white px-4 lg:px-6">
          <PhotoDateBreadcrumb
            filters={displayFilters}
            today={today}
            mostRecentDay={mostRecentDay}
            onNavigate={({ dateFrom, dateTo }) => patch({ dateFrom, dateTo, poRef: undefined })}
          />
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-y-auto p-4 pb-6 lg:p-6">
        <PhotoLibraryGrid
          photos={photos}
          view={view}
          sourceScope={sourceScopeFromFilters(filters)}
          dateFrom={filters.dateFrom}
          dateTo={filters.dateTo}
          poRef={resolvedPoRef}
          onNavigate={({ dateFrom, dateTo, poRef }) => patch({ dateFrom, dateTo, poRef })}
          onPhotoDeleted={() => void query.refetch()}
          selectionActive={selectionActive}
          selected={selected}
          onSelectTile={selectTile}
          onPhotoContextMenu={(photo, e) => {
            e.preventDefault();
            setCtxMenu({ photo, x: e.clientX, y: e.clientY });
          }}
          isLoading={query.isLoading}
          error={query.error instanceof Error ? query.error.message : null}
        />
        {query.hasNextPage ? (
          <div
            ref={sentinelRef}
            className="flex items-center justify-center py-6 text-micro font-bold uppercase tracking-widest text-gray-400"
          >
            {query.isFetchingNextPage ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading more…
              </>
            ) : null}
          </div>
        ) : !query.isLoading && photos.length > 0 ? (
          <p className="mt-6 text-center text-micro font-bold uppercase tracking-widest text-gray-400">
            {`Showing all ${photos.length} photo${photos.length === 1 ? '' : 's'}`}
          </p>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-gray-100 bg-white px-4 py-2 lg:px-6">
        <PhotoDateBreadcrumb
          filters={displayFilters}
          today={today}
          mostRecentDay={mostRecentDay}
          onNavigate={({ dateFrom, dateTo }) => patch({ dateFrom, dateTo, poRef: undefined })}
        />
      </div>

      {claimPhotos !== null ? (
        <ZendeskClaimModal
          open
          photos={claimPhotos}
          onClose={() => setClaimPhotos(null)}
          onDone={() => {
            exitSelectMode();
            void queryClient.invalidateQueries({ queryKey: ['photo-library'] });
          }}
        />
      ) : null}

      {ctxMenu ? (
        <PhotoContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={photoMenuItems(ctxMenu.photo)}
          onClose={() => setCtxMenu(null)}
        />
      ) : null}

      {labelEditorPhotos ? (
        <PhotoLabelEditor
          photos={labelEditorPhotos}
          scopeImageType={filters.imageType}
          onClose={() => setLabelEditorPhotos(null)}
        />
      ) : null}
    </div>
    </RightPaneOverlayHost>
  );
}
