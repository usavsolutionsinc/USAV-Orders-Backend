'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, Download, ExternalLink, Link2, MessageSquare, Share2, Trash2, X } from '@/components/Icons';
import { usePageSelection } from '@/hooks/usePageHeader';
import { usePhotoLibrary } from '@/hooks/usePhotoLibrary';
import { usePhotoLibraryUrlState } from '@/hooks/usePhotoLibraryUrlState';
import { usePhotoFolders } from '@/hooks/usePhotoFolders';
import { usePhotoSelection } from '@/hooks/usePhotoSelection';
import { usePhotoShareLinks } from '@/hooks/usePhotoShareLinks';
import { describePhotoLibraryContext } from '@/lib/photos/library-context-label';
import { PHOTO_LIBRARY_PAGE_SIZE, sourceScopeFromFilters } from '@/lib/photos/library-filter-state';
import type { SelectionAction } from '@/lib/selection/selection-actions';
import { toast } from '@/lib/toast';
import { dispatchReceivingPhotoChanged } from '@/utils/events';
import { usePackerPhotosRealtimeRefresh } from '@/hooks/usePackerPhotosRealtimeRefresh';
import { useAuth } from '@/contexts/AuthContext';
import { ZendeskClaimModal } from '@/components/support/zendesk/claim/ZendeskClaimModal';
import type { ClaimPhotoInput } from '@/components/support/zendesk/claim/claim-types';
import { AddToFolderMenu } from './AddToFolderMenu';
import { PhotoContextMenu, type PhotoContextMenuItem } from './PhotoContextMenu';
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
  const { filters, display, setView, setPage, patch } = usePhotoLibraryUrlState();
  const { query, photos } = usePhotoLibrary(filters);
  const queryClient = useQueryClient();
  const { has } = useAuth();
  const canZendesk = has('integrations.zendesk');

  // Photos staged for the "Create Zendesk ticket" modal (null = closed).
  const [claimPhotos, setClaimPhotos] = useState<ClaimPhotoInput[] | null>(null);
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
  const { removePhotos } = usePhotoFolders();
  // When a master folder is the active filter, the grid shows only its photos —
  // so a "Remove from folder" bulk action becomes meaningful.
  const selectedFolderId = filters.folderId ? Number(filters.folderId) : null;
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
    [canZendesk, deletePhotoFromMenu, downloadPhotoFile, shareLinks],
  );

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
      ...(canZendesk
        ? [
            {
              // Turn the selected library photos into a Zendesk ticket (or a
              // reply on an existing one) with the photos attached. See the
              // ZendeskClaimModal — the genuinely-new photo→ticket bridge.
              key: 'zendesk',
              label: 'Create Zendesk ticket',
              icon: <MessageSquare className="h-4 w-4" />,
              tone: 'blue' as const,
              primary: false,
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
      ...(selectedFolderId
        ? [
            {
              key: 'remove-folder',
              label: 'Remove from folder',
              icon: <X className="h-4 w-4" />,
              tone: 'gray' as const,
              primary: false,
              run: async (rows: LibraryPhoto[]) => {
                if (rows.length === 0) return;
                await removePhotos.mutateAsync({
                  folderId: selectedFolderId,
                  photoIds: rows.map((row) => row.id),
                });
                exitSelectMode();
                toast.success(`Removed ${rows.length} photo${rows.length === 1 ? '' : 's'} from folder`);
              },
            } satisfies SelectionAction<LibraryPhoto>,
          ]
        : []),
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
    [canZendesk, downloadPhotoFile, exitSelectMode, queryClient, removePhotos, selectedFolderId, shareLinks],
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-white">
      <PhotoLibraryHeader
        title={title}
        metaLine={metaLine}
        view={view}
        onViewChange={setView}
        sort={filters.sort ?? 'recent'}
        onSortChange={(sort) => patch({ sort })}
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
          leading={<AddToFolderMenu photoIds={selectedPhotos.map((p) => p.id)} />}
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
          onPhotoContextMenu={(photo, e) => {
            e.preventDefault();
            setCtxMenu({ photo, x: e.clientX, y: e.clientY });
          }}
          isLoading={query.isLoading}
          error={query.error instanceof Error ? query.error.message : null}
        />
        {!query.isLoading && pagePhotos.length > 0 && !hasMore && page >= totalPages ? (
          <p className="mt-6 text-center text-[10px] font-bold uppercase tracking-widest text-gray-400">
            {`Showing all ${photos.length} photo${photos.length === 1 ? '' : 's'}`}
          </p>
        ) : null}
      </div>

      <ZendeskClaimModal
        open={claimPhotos !== null}
        photos={claimPhotos ?? []}
        onClose={() => setClaimPhotos(null)}
        onDone={() => {
          exitSelectMode();
          void queryClient.invalidateQueries({ queryKey: ['photo-library'] });
        }}
      />

      {ctxMenu ? (
        <PhotoContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={photoMenuItems(ctxMenu.photo)}
          onClose={() => setCtxMenu(null)}
        />
      ) : null}
    </div>
  );
}
