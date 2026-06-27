import type { FilterRefinement } from '@/design-system/components/FilterRefinementBar';
import {
  applyDatePreset,
  countActivePhotoLibraryFilters,
  datePresetFromFilters,
  type PhotoLibraryDatePreset,
  type PhotoLibraryFilterState,
} from './library-filter-state';

export interface PhotoLibraryRefinementActions {
  patch: (next: Partial<PhotoLibraryFilterState>) => void;
  setDatePreset: (preset: PhotoLibraryDatePreset) => void;
  clearStructured: () => void;
}

export interface PhotoLibraryRefinementContext {
  staffNameForId?: (id: string) => string | null | undefined;
}

const DATE_PRESET_LABELS: Record<PhotoLibraryDatePreset, string> = {
  all: 'All dates',
  today: 'Today',
  yesterday: 'Yesterday',
  last7: 'Last 7 days',
  custom: 'Custom range',
};

export function buildPhotoLibraryRefinements(
  filters: PhotoLibraryFilterState,
  actions: PhotoLibraryRefinementActions,
  context: PhotoLibraryRefinementContext = {},
): FilterRefinement[] {
  const out: FilterRefinement[] = [];

  const datePreset = datePresetFromFilters(filters);
  if (datePreset !== 'all') {
    out.push({
      id: 'date',
      label: DATE_PRESET_LABELS[datePreset],
      onRemove: () => actions.setDatePreset('all'),
    });
  }

  if (filters.poRef) {
    out.push({
      id: 'poRef',
      label: `PO ${filters.poRef}`,
      onRemove: () => actions.patch({ poRef: undefined }),
    });
  }

  if (filters.receivingId) {
    out.push({
      id: 'receivingId',
      label: `Receiving #${filters.receivingId}`,
      onRemove: () => actions.patch({ receivingId: undefined }),
    });
  }

  if (filters.staffId) {
    const staffLabel = context.staffNameForId?.(filters.staffId) ?? `Staff #${filters.staffId}`;
    out.push({
      id: 'staffId',
      label: staffLabel,
      onRemove: () => actions.patch({ staffId: undefined }),
    });
  }

  // Business-ID chips. Long ids (tracking/serial) show a tail so the chip stays
  // compact while keeping the part operators actually read off the scanner.
  const shortId = (v: string, keepEnd = 10) =>
    v.length > keepEnd + 1 ? `…${v.slice(-keepEnd)}` : v;

  if (filters.tracking) {
    out.push({
      id: 'tracking',
      label: `Tracking ${shortId(filters.tracking)}`,
      onRemove: () => actions.patch({ tracking: undefined }),
    });
  }
  if (filters.serial) {
    out.push({
      id: 'serial',
      label: `Serial ${shortId(filters.serial)}`,
      onRemove: () => actions.patch({ serial: undefined }),
    });
  }
  if (filters.sku) {
    out.push({
      id: 'sku',
      label: `SKU ${filters.sku}`,
      onRemove: () => actions.patch({ sku: undefined }),
    });
  }
  if (filters.ticketId) {
    out.push({
      id: 'ticketId',
      label: `Ticket #${filters.ticketId}`,
      onRemove: () => actions.patch({ ticketId: undefined }),
    });
  }
  if (filters.pickupId) {
    out.push({
      id: 'pickupId',
      label: `Pickup #${filters.pickupId}`,
      onRemove: () => actions.patch({ pickupId: undefined }),
    });
  }
  if (filters.rma) {
    out.push({
      id: 'rma',
      label: `RMA ${filters.rma}`,
      onRemove: () => actions.patch({ rma: undefined }),
    });
  }

  if (filters.label) {
    out.push({
      id: 'label',
      label: `Label: ${filters.label}`,
      onRemove: () => actions.patch({ label: undefined }),
    });
  }

  if (filters.damageDetected === 'true') {
    out.push({
      id: 'damage',
      label: 'Damage detected',
      onRemove: () => actions.patch({ damageDetected: undefined }),
    });
  } else if (filters.damageDetected === 'false') {
    out.push({
      id: 'damage',
      label: 'No damage flagged',
      onRemove: () => actions.patch({ damageDetected: undefined }),
    });
  }

  if (filters.hasAnalysis === 'true') {
    out.push({
      id: 'analysis',
      label: 'Analyzed',
      onRemove: () => actions.patch({ hasAnalysis: undefined }),
    });
  } else if (filters.hasAnalysis === 'false') {
    out.push({
      id: 'analysis',
      label: 'Not analyzed',
      onRemove: () => actions.patch({ hasAnalysis: undefined }),
    });
  }

  return out;
}

export function photoLibraryStructuredFilterCount(filters: PhotoLibraryFilterState): number {
  return countActivePhotoLibraryFilters(filters);
}

export { applyDatePreset, datePresetFromFilters, DATE_PRESET_LABELS };
