/**
 * Photo library URL filter contract — shared by sidebar panel and main grid.
 *
 * Phase 1: URL is the single source of truth (`usePhotoLibraryUrlState`).
 * Phase 2: optional AI search mode via `searchMode=ask` (future).
 */

export interface PhotoLibraryFilterState {
  dateFrom?: string;
  dateTo?: string;
  poRef?: string;
  receivingId?: string;
  entityType?: string;
  entityId?: string;
  staffId?: string;
  q?: string;
  damageDetected?: string;
  hasAnalysis?: string;
}

/** Sidebar source folders — mapped to `entityType` filters on the API. */
export type PhotoLibrarySourceScope = 'all' | 'unboxing' | 'packing' | 'claims';

export type PhotoLibraryDatePreset = 'all' | 'today' | 'yesterday' | 'last7' | 'custom';

export type PhotoLibraryViewMode = 'grid-sm' | 'grid-lg' | 'list';

export const PHOTO_LIBRARY_PAGE_SIZE = 24;

export const PHOTO_SOURCE_SCOPE_LABELS: Record<PhotoLibrarySourceScope, string> = {
  all: 'All photos',
  unboxing: 'Unboxing',
  packing: 'Packing',
  claims: 'Zendesk Claims',
};

export const PHOTO_ENTITY_TYPE_LABELS: Record<string, string> = {
  RECEIVING: 'Receiving',
  RECEIVING_LINE: 'Receiving line',
  PACKER_LOG: 'Packer',
  SERIAL_UNIT: 'Serial unit',
  ZENDESK_TICKET: 'Zendesk ticket',
};

export function sourceScopeFromFilters(filters: PhotoLibraryFilterState): PhotoLibrarySourceScope {
  const t = filters.entityType;
  if (t === 'RECEIVING' || t === 'RECEIVING_LINE') return 'unboxing';
  if (t === 'PACKER_LOG') return 'packing';
  if (t === 'ZENDESK_TICKET') return 'claims';
  return 'all';
}

export function entityTypeForSourceScope(scope: PhotoLibrarySourceScope): string | undefined {
  switch (scope) {
    case 'unboxing':
      return 'RECEIVING';
    case 'packing':
      return 'PACKER_LOG';
    case 'claims':
      return 'ZENDESK_TICKET';
    default:
      return undefined;
  }
}

export function parsePhotoLibraryViewMode(raw: string | null): PhotoLibraryViewMode {
  if (raw === 'grid-sm' || raw === 'list') return raw;
  return 'grid-lg';
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function datePresetFromFilters(filters: PhotoLibraryFilterState): PhotoLibraryDatePreset {
  const { dateFrom, dateTo } = filters;
  if (!dateFrom && !dateTo) return 'all';

  const today = ymd(new Date());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterday = ymd(y);

  if (dateFrom === today && dateTo === today) return 'today';
  if (dateFrom === yesterday && dateTo === yesterday) return 'yesterday';

  if (dateFrom && dateTo) {
    const start = new Date(`${dateFrom}T00:00:00`);
    const end = new Date(`${dateTo}T00:00:00`);
    const diffDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    const last7Start = new Date();
    last7Start.setDate(last7Start.getDate() - 6);
    if (diffDays === 6 && dateFrom === ymd(last7Start) && dateTo === today) return 'last7';
  }

  return 'custom';
}

export function applyDatePreset(preset: PhotoLibraryDatePreset): Pick<PhotoLibraryFilterState, 'dateFrom' | 'dateTo'> {
  if (preset === 'all') return { dateFrom: undefined, dateTo: undefined };
  const today = ymd(new Date());
  if (preset === 'today') return { dateFrom: today, dateTo: today };
  if (preset === 'yesterday') {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const d = ymd(y);
    return { dateFrom: d, dateTo: d };
  }
  if (preset === 'last7') {
    const start = new Date();
    start.setDate(start.getDate() - 6);
    return { dateFrom: ymd(start), dateTo: today };
  }
  return {};
}

export function parsePhotoLibraryFilters(params: URLSearchParams): PhotoLibraryFilterState {
  const next: PhotoLibraryFilterState = {};
  const set = (key: keyof PhotoLibraryFilterState, param: string) => {
    const v = params.get(param)?.trim();
    if (v) next[key] = v;
  };
  set('dateFrom', 'dateFrom');
  set('dateTo', 'dateTo');
  set('poRef', 'poRef');
  set('receivingId', 'receivingId');
  set('entityType', 'entityType');
  set('entityId', 'entityId');
  set('staffId', 'staffId');
  set('q', 'q');
  set('damageDetected', 'damageDetected');
  set('hasAnalysis', 'hasAnalysis');
  return next;
}

export function parsePhotoLibraryDisplayParams(params: URLSearchParams): {
  view: PhotoLibraryViewMode;
  page: number;
} {
  const pageRaw = parseInt(params.get('page') ?? '1', 10);
  return {
    view: parsePhotoLibraryViewMode(params.get('view')),
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1,
  };
}

export function photoLibraryFiltersToParams(
  filters: PhotoLibraryFilterState,
  base?: URLSearchParams,
): URLSearchParams {
  const params = new URLSearchParams(base?.toString() ?? '');
  const keys: (keyof PhotoLibraryFilterState)[] = [
    'dateFrom',
    'dateTo',
    'poRef',
    'receivingId',
    'entityType',
    'entityId',
    'staffId',
    'q',
    'damageDetected',
    'hasAnalysis',
  ];
  for (const key of keys) {
    const val = filters[key]?.trim();
    if (val) params.set(key, val);
    else params.delete(key);
  }
  return params;
}

export function photoLibraryUrlParams(
  filters: PhotoLibraryFilterState,
  display: { view: PhotoLibraryViewMode; page: number },
  base?: URLSearchParams,
): URLSearchParams {
  const params = photoLibraryFiltersToParams(filters, base);
  if (display.view !== 'grid-lg') params.set('view', display.view);
  else params.delete('view');
  if (display.page > 1) params.set('page', String(display.page));
  else params.delete('page');
  return params;
}

export function countActivePhotoLibraryFilters(filters: PhotoLibraryFilterState): number {
  let n = 0;
  if (filters.poRef) n++;
  if (filters.receivingId) n++;
  if (filters.entityType) n++;
  if (filters.entityId) n++;
  if (filters.staffId) n++;
  if (filters.damageDetected) n++;
  if (filters.hasAnalysis) n++;
  if (filters.dateFrom || filters.dateTo) n++;
  return n;
}

export function clearStructuredPhotoFilters(
  filters: PhotoLibraryFilterState,
): PhotoLibraryFilterState {
  return {
    ...filters,
    dateFrom: undefined,
    dateTo: undefined,
    poRef: undefined,
    receivingId: undefined,
    entityType: undefined,
    entityId: undefined,
    staffId: undefined,
    damageDetected: undefined,
    hasAnalysis: undefined,
  };
}
