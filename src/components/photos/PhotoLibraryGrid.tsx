'use client';

import { type MouseEvent as ReactMouseEvent } from 'react';
import type { LibraryPhoto } from './photo-library-types';
import { Image as ImageIcon } from '@/components/Icons';
import type { PhotoLibrarySourceScope, PhotoLibraryViewMode } from '@/lib/photos/library-filter-state';
import { PhotoEmptyState, PhotoGridSkeleton } from './photo-library-grid/PhotoGridStates';
import { usePhotoGridLightbox } from './photo-library-grid/usePhotoGridLightbox';
import { PhotoListView } from './photo-library-grid/PhotoListView';
import { PhotoTicketGrid } from './photo-library-grid/PhotoTicketGrid';
import { PhotoFlatGrid } from './photo-library-grid/PhotoFlatGrid';
import { FoldersView } from './photo-library-grid/FoldersView';
import type { PhotoDateNav, TileSelectMods } from './photo-library-grid/types';

export type { PhotoDateNav, TileSelectMods } from './photo-library-grid/types';

interface PhotoLibraryGridProps {
  photos: LibraryPhoto[];
  view: PhotoLibraryViewMode;
  /** Source scope drives folder labels (PO# for unboxing, Order# for packing). */
  sourceScope?: PhotoLibrarySourceScope;
  /** Active date filter (drives the folders-view drill level). */
  dateFrom?: string;
  dateTo?: string;
  /** Active PO# filter (folders-view PO leaf). */
  poRef?: string;
  /** Narrow/widen the date+PO filter from a folder click or path-bar crumb. */
  onNavigate?: (nav: PhotoDateNav) => void;
  /** Whether selection UI (checkmarks, toggle-on-click) is engaged. */
  selectionActive: boolean;
  /** The currently-selected photo ids. */
  selected: Set<number>;
  /** Select/toggle a tile (the page owns range/anchor logic). */
  onSelectTile: (id: number, mods: TileSelectMods) => void;
  /** Right-click a photo tile — the page opens the contextual action menu. */
  onPhotoContextMenu?: (photo: LibraryPhoto, e: ReactMouseEvent) => void;
  /** Called after a photo is deleted from the folder viewer so the list refreshes. */
  onPhotoDeleted?: (photoId: number) => void;
  isLoading: boolean;
  error: string | null;
}

export function PhotoLibraryGrid({
  photos,
  view,
  sourceScope = 'all',
  dateFrom,
  dateTo,
  poRef,
  onNavigate,
  selectionActive,
  selected,
  onSelectTile,
  onPhotoContextMenu,
  onPhotoDeleted,
  isLoading,
  error,
}: PhotoLibraryGridProps) {
  const { openAt, lightbox } = usePhotoGridLightbox({ photos, sourceScope, onPhotoDeleted });

  if (isLoading) {
    return <PhotoGridSkeleton />;
  }
  if (error) {
    return (
      <div className="mx-auto mt-6 flex max-w-sm flex-col items-center gap-2 rounded-xl border border-dashed border-rose-200 bg-rose-50 px-6 py-10 text-center">
        <ImageIcon className="h-6 w-6 text-rose-400" />
        <p className="text-sm font-semibold text-rose-900">Couldn’t load photos</p>
        <p className="text-xs leading-relaxed text-rose-600">{error}</p>
      </div>
    );
  }
  // The folders view owns its own empty-handling — an empty day widens to its
  // week, and each level renders the right teaching state — so don't pre-empt it
  // with the global empty card (that hid the day→week fallback entirely).
  if (photos.length === 0 && view !== 'folders') {
    return <PhotoEmptyState />;
  }

  if (view === 'list') {
    return (
      <>
        <PhotoListView
          photos={photos}
          scope={sourceScope}
          selectionActive={selectionActive}
          selected={selected}
          onSelectTile={onSelectTile}
          onPhotoContextMenu={onPhotoContextMenu}
          openAt={openAt}
        />
        {lightbox}
      </>
    );
  }

  if (view === 'folders') {
    return (
      <FoldersView
        photos={photos}
        scope={sourceScope}
        dateFrom={dateFrom}
        dateTo={dateTo}
        poRef={poRef}
        onNavigate={onNavigate ?? (() => {})}
        selectionActive={selectionActive}
        selected={selected}
        onSelectTile={onSelectTile}
        onPhotoContextMenu={onPhotoContextMenu}
        onPhotoDeleted={onPhotoDeleted}
      />
    );
  }

  if (view === 'grid-ticket') {
    return (
      <>
        <PhotoTicketGrid
          photos={photos}
          scope={sourceScope}
          selectionActive={selectionActive}
          selected={selected}
          onSelectTile={onSelectTile}
          onPhotoContextMenu={onPhotoContextMenu}
          openAt={openAt}
        />
        {lightbox}
      </>
    );
  }

  return (
    <>
      <PhotoFlatGrid
        view={view}
        photos={photos}
        scope={sourceScope}
        selectionActive={selectionActive}
        selected={selected}
        onSelectTile={onSelectTile}
        onPhotoContextMenu={onPhotoContextMenu}
        openAt={openAt}
      />
      {lightbox}
    </>
  );
}
