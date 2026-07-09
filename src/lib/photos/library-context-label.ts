import type { PhotoLibraryFilterState } from './library-filter-state';
import {
  PHOTO_SOURCE_SCOPE_LABELS,
  sourceScopeFromFilters,
} from './library-filter-state';
import { claimsTicketLabel } from '@/lib/photos/display-names';

export const PHOTO_LIBRARY_DEFAULT_SUBTITLE =
  'Browse receiving, packing, and unit photos';

export function describePhotoLibraryContext(filters: PhotoLibraryFilterState): {
  title: string;
  subtitle: string;
} {
  const source = sourceScopeFromFilters(filters);
  if (source !== 'all' && !filters.receivingId && !filters.poRef && !filters.ticketId) {
    return {
      title: PHOTO_SOURCE_SCOPE_LABELS[source],
      subtitle: PHOTO_LIBRARY_DEFAULT_SUBTITLE,
    };
  }
  if (filters.receivingId) {
    return {
      title: `Receiving #${filters.receivingId}`,
      subtitle: 'Photos linked to this receiving session',
    };
  }
  if (filters.ticketId) {
    return {
      title: claimsTicketLabel(filters.ticketId),
      subtitle: 'Photos linked to this Zendesk claim',
    };
  }
  if (filters.poRef) {
    return {
      title: `PO ${filters.poRef}`,
      subtitle: 'Photos linked to this purchase order',
    };
  }
  if (filters.q) {
    return {
      title: `Search: ${filters.q}`,
      subtitle: 'PO ref, metadata, and OCR matches',
    };
  }
  return {
    title: 'All photos',
    subtitle: PHOTO_LIBRARY_DEFAULT_SUBTITLE,
  };
}
