import { type MouseEvent as ReactMouseEvent } from 'react';
import type { LibraryPhoto } from '../photo-library-types';
import type { PhotoLibrarySourceScope } from '@/lib/photos/library-filter-state';

/** Modifiers carried from a tile click into the selection model. */
export interface TileSelectMods {
  /** Shift was held — extend a range from the last anchor. */
  shift: boolean;
}

export interface PhotoDateNav {
  dateFrom?: string;
  dateTo?: string;
  poRef?: string;
}

/**
 * Shared prop set for the flat grid views (list, grid-ticket, grid-sm/lg). Each
 * renders the loaded `photos` with the page's selection model and opens the
 * shared lightbox via `openAt`.
 */
export interface PhotoGridViewProps {
  photos: LibraryPhoto[];
  /** Source scope — drives the PO# vs Zendesk-ticket# label. */
  scope: PhotoLibrarySourceScope;
  selectionActive: boolean;
  selected: Set<number>;
  onSelectTile: (id: number, mods: TileSelectMods) => void;
  onPhotoContextMenu?: (photo: LibraryPhoto, e: ReactMouseEvent) => void;
  /** Open the shared fullscreen viewer at this photo. */
  openAt: (id: number) => void;
}
