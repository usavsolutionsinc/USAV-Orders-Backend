import type { FilterRefinement } from '@/design-system/components/FilterRefinementBar';
import {
  applyDatePreset,
  countActivePhotoLibraryFilters,
  datePresetFromFilters,
  PHOTO_ENTITY_TYPE_LABELS,
  type PhotoLibraryDatePreset,
  type PhotoLibraryFilterState,
} from './library-filter-state';

export interface PhotoLibraryRefinementActions {
  patch: (next: Partial<PhotoLibraryFilterState>) => void;
  setDatePreset: (preset: PhotoLibraryDatePreset) => void;
  clearStructured: () => void;
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

  if (filters.entityType) {
    const kind = PHOTO_ENTITY_TYPE_LABELS[filters.entityType] ?? filters.entityType;
    const suffix = filters.entityId ? ` #${filters.entityId}` : '';
    out.push({
      id: 'entityType',
      label: `${kind}${suffix}`,
      onRemove: () => actions.patch({ entityType: undefined, entityId: undefined }),
    });
  } else if (filters.entityId) {
    out.push({
      id: 'entityId',
      label: `Entity #${filters.entityId}`,
      onRemove: () => actions.patch({ entityId: undefined }),
    });
  }

  if (filters.staffId) {
    out.push({
      id: 'staffId',
      label: `Staff #${filters.staffId}`,
      onRemove: () => actions.patch({ staffId: undefined }),
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
