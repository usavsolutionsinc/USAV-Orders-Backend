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

  if (filters.staffId) {
    const staffLabel = context.staffNameForId?.(filters.staffId) ?? `Staff #${filters.staffId}`;
    out.push({
      id: 'staffId',
      label: staffLabel,
      onRemove: () => actions.patch({ staffId: undefined }),
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
