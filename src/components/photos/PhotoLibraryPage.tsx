'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, ExternalLink, Link2, Loader2, MessageSquare, Tag, Trash2 } from '@/components/Icons';
import { usePhotoLibrary, photoLibraryFilterParams } from '@/hooks/usePhotoLibrary';
import { usePhotoLibraryUrlState } from '@/hooks/usePhotoLibraryUrlState';
import { usePhotoSelection } from '@/hooks/usePhotoSelection';
import { usePhotoShareLinks } from '@/hooks/usePhotoShareLinks';
import { describePhotoLibraryContext } from '@/lib/photos/library-context-label';
import { claimsTicketLabel, photoShareTitle } from '@/lib/photos/display-names';
import { buildPhotoDateTree } from '@/lib/photos/date-tree';
import {
  photoLibraryViewToggleModes,
  sourceScopeFromFilters,
  todayFoldersDateFilter,
} from '@/lib/photos/library-filter-state';
import { useMediaLibraryShortcuts } from '@/hooks/useMediaLibraryShortcuts';
import { usePhotoGridDensity } from '@/hooks/usePhotoGridDensity';
import { photoLibraryShowsGridControls, photoLibraryShowsSecondHeaderControls } from '@/lib/photos/photo-grid-density';
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
import { PhotoGridDisplayControls } from './PhotoGridDisplayControls';
import { PhotoLibraryToolbar } from './PhotoLibraryToolbar';
import { PhotoLabelEditor } from './PhotoLabelEditor';
import { MediaLibraryShortcutsModal } from './MediaLibraryShortcutsModal';

/** Fixed share-link lifetime (24h) for copied links + share pages. */
const DEFAULT_SHARE_TTL_SECONDS = 24 * 60 * 60;

/** Server cap on ids per share / share-pack request (share-links.ts MAX_PHOTOS_PER_REQUEST). */
const MAX_SHARE_PHOTOS = 200;

// `LibraryPhoto` moved to ./photo-library-types so the grid + hook can share it
// without importing this page (cycle). Re-exported here for compatibility.
export type { LibraryPhoto } from './photo-library-types';
import type { LibraryPhoto } from './photo-library-types';
import { isLibraryDocument, libraryDocumentId } from './photo-library-types';

/** Right pane: 40px header + inline bulk toolbar + photo grid. Filters in sidebar. */
export function PhotoLibraryPage() {
  const { filters, display, setView, patch } = usePhotoLibraryUrlState();
  const { query, photos } = usePhotoLibrary(filters);
  const { density: gridDensity, setDensity: setGridDensity } = usePhotoGridDensity();
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

  const scope = sourceScopeFromFilters(filters);

  const resolvedTicketId = useMemo<string | undefined>(() => {
    if (filters.ticketId) return filters.ticketId;
    if (scope !== 'claims' || !filters.poFinder || photos.length === 0) return undefined;
    const tickets = new Set(
      photos.map((p) => p.ticketId).filter((id): id is number => id != null && id > 0),
    );
    return tickets.size === 1 ? String([...tickets][0]) : undefined;
  }, [filters.ticketId, filters.poFinder, photos, scope]);
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
    let next = filters;
    if (resolvedPoRef && !filters.poRef) {
      next = { ...next, poRef: resolvedPoRef };
    }
    if (resolvedTicketId && !filters.ticketId) {
      next = { ...next, ticketId: resolvedTicketId };
    }
    if (!resolvedPoRef && !filters.poRef && !resolvedTicketId && !filters.ticketId) {
      return next;
    }
    return photoDaySpan
      ? { ...next, dateFrom: photoDaySpan.from, dateTo: photoDaySpan.to }
      : next;
  }, [filters, resolvedPoRef, resolvedTicketId, photoDaySpan]);
  const { has } = useAuth();
  const canZendesk = has('integrations.zendesk');
  const canManagePhotos = has('photos.manage');
  const canShare = has('photos.share');

  // Photos staged for the "Create support ticket" modal (null = closed).
  const [claimPhotos, setClaimPhotos] = useState<ClaimPhotoInput[] | null>(null);
  // Photos staged for the label editor (null = closed; 1 = single PUT, N = bulk).
  const [labelEditorPhotos, setLabelEditorPhotos] = useState<LibraryPhoto[] | null>(null);
  // Right-click context menu target (null = closed).
  const [ctxMenu, setCtxMenu] = useState<{ photo: LibraryPhoto; x: number; y: number } | null>(null);
  // Keyboard-shortcut cheat sheet (toggled with `?`).
  const [showShortcuts, setShowShortcuts] = useState(false);

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
  const { selected, selectedPhotos, isActive, selectTile, selectAll, selectIds, toggleGroupSelection, clear } =
    usePhotoSelection(photos);
  const selectionActive = selectMode || isActive;

  const shareLinks = usePhotoShareLinks();
  const { title, subtitle } = describePhotoLibraryContext(displayFilters);

  const { view } = display;

  const folderBrowse = useMemo(() => {
    if (view !== 'folders') return null;
    return describeFolderBrowseHeader({
      photos,
      scope,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      poRef: resolvedPoRef,
      ticketId: resolvedTicketId,
    });
  }, [view, photos, scope, filters.dateFrom, filters.dateTo, resolvedPoRef, resolvedTicketId]);

  const folderIsLeaf = Boolean(folderBrowse?.isLeaf);
  const showGridControls = photoLibraryShowsGridControls(view, folderIsLeaf);
  const showSecondHeaderControls = photoLibraryShowsSecondHeaderControls(view, folderIsLeaf);
  const viewToggleModes = useMemo(() => photoLibraryViewToggleModes(view, folderIsLeaf), [view, folderIsLeaf]);

  // Date breadcrumb quick-jump defaults: today + the most recent
  // capture day across the loaded photos — both keyed off `created_at` (PST),
  // never the most-recent PO or photo type.
  const today = useMemo(() => getCurrentPSTDateKey(), []);
  const foldersDateInitialized = useRef(false);

  // Folders view opens on today when the URL has no date drill (first load).
  useEffect(() => {
    if (foldersDateInitialized.current) return;
    if (view !== 'folders') return;
    // A finder search owns the result set — don't clobber it with today's date.
    if (filters.dateFrom || filters.dateTo || filters.poRef || filters.ticketId || filters.poFinder) return;
    foldersDateInitialized.current = true;
    patch(todayFoldersDateFilter());
  }, [view, filters.dateFrom, filters.dateTo, filters.poRef, filters.ticketId, filters.poFinder, patch]);

  const handleViewChange = useCallback(
    (next: typeof view) => {
      if (next === 'folders') {
        patch({ ...todayFoldersDateFilter(), poRef: undefined, ticketId: undefined });
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

  // "Select all matching filters" — fetch every matching photo id (capped) for
  // the current filter set and select them, so a bulk share/ZIP/delete spans the
  // whole result, not just the loaded page.
  const selectAllMatching = useCallback(async () => {
    try {
      const qs = photoLibraryFilterParams(filters).toString();
      const res = await fetch(`/api/photos/library/ids?${qs}`);
      if (!res.ok) throw new Error('Failed to select all');
      const data = (await res.json()) as { ids: number[]; total: number; capped: boolean };
      selectIds(data.ids);
      setSelectMode(true);
      if (data.capped) {
        toast.success(
          `Selected first ${data.ids.length} of ${data.total} — narrow filters to select more`,
        );
      } else {
        toast.success(`Selected all ${data.ids.length} matching`);
      }
    } catch {
      toast.error('Could not select all matching photos');
    }
  }, [filters, selectIds]);

  // Grid keyboard shortcuts (the viewer owns its own keys). `?` help, `⌘A`
  // select-all while selecting, `Esc` exit, `1`–`5` view switch.
  const toggleShortcuts = useCallback(() => setShowShortcuts((v) => !v), []);
  const selectViewByIndex = useCallback(
    (index: number) => {
      const next = viewToggleModes[index];
      if (next) handleViewChange(next);
    },
    [handleViewChange, viewToggleModes],
  );
  useMediaLibraryShortcuts({
    selectionActive,
    onToggleHelp: toggleShortcuts,
    onSelectAll: selectAll,
    onEscape: exitSelectMode,
    onSelectViewIndex: selectViewByIndex,
  });

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
  // to a support ticket, download, delete). Mirrors the bulk toolbar for one photo.
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
      ...(canShare
        ? [
            {
              key: 'share-page',
              label: 'Create share page',
              icon: <ExternalLink className="h-3.5 w-3.5" />,
              onClick: () =>
                void shareLinks.createSharePage([photo.id], { title: photoShareTitle([photo], scope) }),
            } satisfies PhotoContextMenuItem,
          ]
        : []),
      ...(canZendesk
        ? [
            {
              key: 'zendesk',
              label: 'Attach to support ticket',
              icon: <MessageSquare className="h-3.5 w-3.5" />,
              onClick: () =>
                setClaimPhotos([
                  {
                    id: photo.id,
                    src: photo.thumbUrl,
                    displayUrl: photo.displayUrl,
                    poRef: photo.poRef,
                    caption: photo.caption ?? null,
                  },
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
    [canManagePhotos, canShare, canZendesk, deletePhotoFromMenu, downloadPhotoFile, shareLinks],
  );

  const deleteSelectedPhotos = useCallback(
    async () => {
      // Operate on the whole selection set (may exceed the loaded rows when
      // "select all matching" is active), not just the loaded selectedPhotos.
      const ids = [...selected].filter((id) => id > 0);
      if (ids.length === 0) return;
      const results = await Promise.allSettled(
        ids.map(async (id) => {
          const res = await fetch(`/api/photos/${id}`, { method: 'DELETE' });
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          if (!res.ok) throw new Error(data?.error || `Delete failed for photo ${id}`);
          return id;
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
        toast.error(`Deleted ${deletedIds.length} photo${deletedIds.length === 1 ? '' : 's'}; ${failures.length} failed`);
      } else {
        toast.success(`Deleted ${ids.length} photo${ids.length === 1 ? '' : 's'}`);
      }
    },
    [exitSelectMode, queryClient, selected],
  );

  const photoBulkActions = useMemo<SelectionAction<LibraryPhoto>[]>(
    () => {
      if (scope === 'outbound') {
        return [
          {
            key: 'download',
            label: 'Download selected',
            icon: <Download className="h-4 w-4" />,
            tone: 'blue' as const,
            primary: true,
            run: async (rows: LibraryPhoto[]) => {
              const docs = rows.filter(isLibraryDocument);
              if (docs.length === 0) return;
              if (docs.length >= 2) {
                const ids = docs.map((row) => libraryDocumentId(row)).join(',');
                const title = docs[0]?.poRef ? `Order-${docs[0].poRef}-documents` : 'outbound-documents';
                window.open(`/api/documents/download-zip?ids=${ids}&title=${encodeURIComponent(title)}`, '_blank');
                toast.success(`Downloading ${docs.length} documents`);
                return;
              }
              const row = docs[0]!;
              const id = libraryDocumentId(row);
              const ext = row.mimeType === 'image/png' ? 'png' : 'pdf';
              await downloadPhotoFile(
                `/api/documents/${id}/content?download=1`,
                row.filename ?? `document-${id}.${ext}`,
              );
              toast.success('Downloaded 1 document');
            },
          } satisfies SelectionAction<LibraryPhoto>,
        ];
      }

      return [
      ...(canZendesk
        ? [
            {
              // Attach the selection to a support ticket (new or existing).
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
                    displayUrl: row.displayUrl,
                    poRef: row.poRef,
                    caption: row.caption ?? null,
                  })),
                );
              },
            } satisfies SelectionAction<LibraryPhoto>,
          ]
        : []),
      ...(canShare
        ? [
            {
              // Copy N ephemeral signed links as a formatted, paste-ready block.
              key: 'copy-links',
              label: 'Copy shareable links',
              icon: <Link2 className="h-4 w-4" />,
              tone: 'blue' as const,
              primary: false,
              maxSelected: MAX_SHARE_PHOTOS,
              disabledReason: `Select ${MAX_SHARE_PHOTOS} or fewer to copy links`,
              run: () => {
                const ids = [...selected];
                if (ids.length > MAX_SHARE_PHOTOS) {
                  toast.error(`Select ${MAX_SHARE_PHOTOS} or fewer to copy links`);
                  return;
                }
                void shareLinks.generateAndCopy(ids, { ttlSeconds: DEFAULT_SHARE_TTL_SECONDS });
              },
            } satisfies SelectionAction<LibraryPhoto>,
            {
              // Create one durable public /share/photos/:token page for the set.
              key: 'share-page',
              label: 'Create share page',
              icon: <ExternalLink className="h-4 w-4" />,
              tone: 'blue' as const,
              primary: false,
              maxSelected: MAX_SHARE_PHOTOS,
              disabledReason: `Select ${MAX_SHARE_PHOTOS} or fewer to build a share page`,
              run: (rows: LibraryPhoto[]) => {
                const ids = [...selected];
                if (ids.length > MAX_SHARE_PHOTOS) {
                  toast.error(`Select ${MAX_SHARE_PHOTOS} or fewer to build a share page`);
                  return;
                }
                void shareLinks.createSharePage(ids, { title: photoShareTitle(rows, scope, ids.length) });
              },
            } satisfies SelectionAction<LibraryPhoto>,
          ]
        : []),
      {
        // One file → direct download; 2+ → single ZIP (GET /api/photos/download-zip).
        key: 'download',
        label: 'Download selected',
        icon: <Download className="h-4 w-4" />,
        tone: 'blue',
        primary: false,
        run: async (rows) => {
          const ids = [...selected];
          if (ids.length === 0) return;
          if (ids.length >= 2) {
            shareLinks.downloadZip(ids, { title: photoShareTitle(rows, scope, ids.length) });
            return;
          }
          const row = rows[0];
          if (!row) return;
          await downloadPhotoFile(
            `/api/photos/${row.id}/content?download=1`,
            `photo-${row.id}.jpg`,
          ).then(
            () => toast.success('Downloaded 1 photo'),
            () => toast.error('Download failed'),
          );
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
    ];
    },
    [canManagePhotos, canShare, canZendesk, downloadPhotoFile, scope, selected, shareLinks],
  );

  return (
    <RightPaneOverlayHost className="flex h-full min-h-0 flex-col">
    <div className="relative flex h-full min-h-0 flex-col bg-surface-card">
      <PhotoLibraryHeader
        title={title}
        metaLine={metaLine}
        folderBrowse={folderBrowse}
        sort={filters.sort ?? 'recent'}
        onSortChange={(sort) => patch({ sort })}
        view={view}
        onViewChange={handleViewChange}
        folderIsLeaf={folderIsLeaf}
        onToggleSelection={() => setSelectMode(true)}
        showDisplayControls={showSecondHeaderControls}
      />

      {/* Top context bar — folder path by default, swapped for the bulk-action bar
          while selecting. Both share the same height so toggling selection never
          shifts the layout. */}
      {selectionActive ? (
        <PhotoLibraryToolbar
          rows={selectedPhotos}
          total={photos.length}
          selectedCount={selected.size}
          hasMore={query.hasNextPage}
          onSelectAllMatching={() => void selectAllMatching()}
          actions={photoBulkActions}
          onDeleteSelected={deleteSelectedPhotos}
          onSelectAll={selectAll}
          onClear={exitSelectMode}
        />
      ) : (
        <>
          <div className="flex h-[40px] shrink-0 items-center border-b border-border-soft bg-surface-card px-4">
            <PhotoDateBreadcrumb
              filters={displayFilters}
              today={today}
              mostRecentDay={mostRecentDay}
              folderLeafLabel={folderIsLeaf ? folderBrowse?.title : undefined}
              onNavigate={({ dateFrom, dateTo }) =>
                patch({ dateFrom, dateTo, poRef: undefined, ticketId: undefined })
              }
            />
          </div>
          {showGridControls ? (
            <div className="flex h-[40px] shrink-0 items-center justify-end gap-1 border-b border-border-soft bg-surface-card px-4">
              <PhotoGridDisplayControls
                density={gridDensity}
                onDensityChange={setGridDensity}
                onRefresh={() => void query.refetch()}
                isRefreshing={query.isFetching && !query.isLoading}
              />
            </div>
          ) : null}
        </>
      )}

      <div className="relative min-h-0 flex-1 overflow-y-auto p-4 pb-6 lg:p-6">
        <PhotoLibraryGrid
          photos={photos}
          view={view}
          gridDensity={gridDensity}
          sourceScope={sourceScopeFromFilters(filters)}
          dateFrom={filters.dateFrom}
          dateTo={filters.dateTo}
          poRef={resolvedPoRef}
          ticketId={resolvedTicketId}
          onNavigate={({ dateFrom, dateTo, poRef, ticketId }) =>
            patch({ dateFrom, dateTo, poRef, ticketId })
          }
          onPhotoDeleted={() => void query.refetch()}
          selectionActive={selectionActive}
          selected={selected}
          onSelectTile={selectTile}
          onToggleGroupSelection={toggleGroupSelection}
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
            className="flex items-center justify-center py-6 text-micro font-bold uppercase tracking-widest text-text-faint"
          >
            {query.isFetchingNextPage ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading more…
              </>
            ) : null}
          </div>
        ) : !query.isLoading && photos.length > 0 ? (
          <p className="mt-6 text-center text-micro font-bold uppercase tracking-widest text-text-faint">
            {`Showing all ${photos.length} photo${photos.length === 1 ? '' : 's'}`}
          </p>
        ) : null}
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

      <MediaLibraryShortcutsModal open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </div>
    </RightPaneOverlayHost>
  );
}
