/**
 * Photo library URL filter contract — shared by sidebar panel and main grid.
 *
 * Phase 1: URL is the single source of truth (`usePhotoLibraryUrlState`).
 * Phase 2: optional AI search mode via `searchMode=ask` (future).
 */

import { getCurrentPSTDateKey } from '@/utils/date';

export interface PhotoLibraryFilterState {
  dateFrom?: string;
  dateTo?: string;
  sourceScope?: PhotoLibrarySourceScope;
  sort?: PhotoLibrarySortMode;
  poRef?: string;
  receivingId?: string;
  staffId?: string;
  q?: string;
  damageDetected?: string;
  hasAnalysis?: string;
  /** Selected custom image type (photo_image_types.key → photos.photo_type). */
  imageType?: string;
  /** Selected photo label (photo_labels.key → photo_label_assignments). */
  label?: string;
  /**
   * Business-ID filters — each resolves through `photo_entity_links` to a domain
   * table (see `src/lib/photos/queries/library.ts`). Stored as strings in the URL;
   * coerced to the right type at the route. All tenant-scoped.
   */
  tracking?: string;
  serial?: string;
  sku?: string;
  /** Zendesk claim ticket number (photo_entity_links ZENDESK_TICKET.entity_id). */
  ticketId?: string;
  /** Local pickup order id (local_pickup_orders.id). */
  pickupId?: string;
  /** Returns RMA number (rma_authorizations.rma_number). */
  rma?: string;
}

/** Sidebar source folders — mapped to API entity types internally. */
export type PhotoLibrarySourceScope =
  | 'all'
  | 'unboxing'
  | 'local_pickup'
  | 'packing'
  | 'repair'
  | 'claims';

export type PhotoLibraryDatePreset = 'all' | 'today' | 'yesterday' | 'last7' | 'custom';

export type PhotoLibrarySortMode = 'recent' | 'oldest';

export type PhotoLibraryViewMode = 'grid-sm' | 'grid-lg' | 'grid-ticket' | 'folders' | 'list';

export const PHOTO_LIBRARY_PAGE_SIZE = 24;

export const PHOTO_SOURCE_SCOPE_LABELS: Record<PhotoLibrarySourceScope, string> = {
  all: 'All photos',
  unboxing: 'Unboxing',
  local_pickup: 'Local pickups',
  packing: 'Packing',
  repair: 'Repair services',
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
  return filters.sourceScope ?? 'all';
}

export function entityTypeForSourceScope(scope: PhotoLibrarySourceScope): string | undefined {
  switch (scope) {
    // Both unboxing and local pickup are RECEIVING-linked photos; they're split
    // apart by `receiving.source` (see `receivingSourceForScope`), not entity type.
    case 'unboxing':
    case 'local_pickup':
      return 'RECEIVING';
    case 'packing':
      return 'PACKER_LOG';
    // Repair photos flow through the serialized unit (testing + repair captures).
    case 'repair':
      return 'SERIAL_UNIT';
    case 'claims':
      return 'ZENDESK_TICKET';
    default:
      return undefined;
  }
}

/** The `receiving.source` value to scope to (`local_pickup`), or undefined. */
export function receivingSourceForScope(scope: PhotoLibrarySourceScope): string | undefined {
  return scope === 'local_pickup' ? 'local_pickup' : undefined;
}

/**
 * The `receiving.source` value to *exclude* for a scope. Unboxing means
 * "received goods that aren't local pickups", so it excludes the local-pickup
 * source — keeping the two receiving scopes disjoint in the sidebar.
 */
export function receivingSourceExcludeForScope(scope: PhotoLibrarySourceScope): string | undefined {
  return scope === 'unboxing' ? 'local_pickup' : undefined;
}

export function parsePhotoLibraryViewMode(raw: string | null): PhotoLibraryViewMode {
  // Folders is the default — Finder-style "folders first, photos on open" —
  // because a flat grid of every photo is hard to scan. Other modes opt in.
  if (raw === 'grid-sm' || raw === 'grid-lg' || raw === 'grid-ticket' || raw === 'list') return raw;
  return 'folders';
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseSourceScope(raw: string | null): PhotoLibrarySourceScope | undefined {
  if (
    raw === 'all' ||
    raw === 'unboxing' ||
    raw === 'local_pickup' ||
    raw === 'packing' ||
    raw === 'repair' ||
    raw === 'claims'
  ) {
    return raw as PhotoLibrarySourceScope;
  }
  return undefined;
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

/** Folders view always opens on today's capture date (PST). */
export function todayFoldersDateFilter(): Pick<PhotoLibraryFilterState, 'dateFrom' | 'dateTo'> {
  const today = getCurrentPSTDateKey();
  return { dateFrom: today, dateTo: today };
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

function formatShortDatePst(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00`);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function formatPhotoLibraryDateRange(filters: PhotoLibraryFilterState): string {
  const preset = datePresetFromFilters(filters);
  if (preset === 'all') return 'All dates';
  if (preset === 'today') return 'Today';
  if (preset === 'yesterday') return 'Yesterday';
  if (preset === 'last7') return 'Last 7 days';
  if (filters.dateFrom && filters.dateTo) {
    const from = formatShortDatePst(filters.dateFrom);
    const to = formatShortDatePst(filters.dateTo);
    return filters.dateFrom === filters.dateTo ? from : `${from} to ${to}`;
  }
  if (filters.dateFrom) return `From ${formatShortDatePst(filters.dateFrom)}`;
  if (filters.dateTo) return `Until ${formatShortDatePst(filters.dateTo)}`;
  return 'Custom range';
}

export function parsePhotoLibraryFilters(params: URLSearchParams): PhotoLibraryFilterState {
  const next: PhotoLibraryFilterState = {};
  const set = (
    key:
      | 'dateFrom' | 'dateTo' | 'poRef' | 'receivingId' | 'staffId' | 'q'
      | 'damageDetected' | 'hasAnalysis' | 'imageType' | 'label'
      | 'tracking' | 'serial' | 'sku' | 'ticketId' | 'pickupId' | 'rma',
    param: string,
  ) => {
    const v = params.get(param)?.trim();
    if (v) next[key] = v;
  };
  set('dateFrom', 'dateFrom');
  set('dateTo', 'dateTo');
  set('imageType', 'imageType');
  set('label', 'label');
  const sourceScope = parseSourceScope(params.get('sourceScope'));
  if (sourceScope) next.sourceScope = sourceScope;
  const sort = params.get('sort');
  if (sort === 'recent' || sort === 'oldest') next.sort = sort as PhotoLibrarySortMode;
  set('poRef', 'poRef');
  set('receivingId', 'receivingId');
  set('staffId', 'staffId');
  set('tracking', 'tracking');
  set('serial', 'serial');
  set('sku', 'sku');
  set('ticketId', 'ticketId');
  set('pickupId', 'pickupId');
  set('rma', 'rma');
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
    'staffId',
    'tracking',
    'serial',
    'sku',
    'ticketId',
    'pickupId',
    'rma',
    'q',
    'damageDetected',
    'hasAnalysis',
    'imageType',
    'label',
  ];
  if (filters.sourceScope && filters.sourceScope !== 'all') {
    params.set('sourceScope', filters.sourceScope);
  } else {
    params.delete('sourceScope');
  }
  if (filters.sort && filters.sort !== 'recent') params.set('sort', filters.sort);
  else params.delete('sort');
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
  if (display.view !== 'folders') params.set('view', display.view);
  else params.delete('view');
  if (display.page > 1) params.set('page', String(display.page));
  else params.delete('page');
  return params;
}

export function countActivePhotoLibraryFilters(filters: PhotoLibraryFilterState): number {
  let n = 0;
  if (filters.poRef) n++;
  if (filters.receivingId) n++;
  if (filters.staffId) n++;
  if (filters.tracking) n++;
  if (filters.serial) n++;
  if (filters.sku) n++;
  if (filters.ticketId) n++;
  if (filters.pickupId) n++;
  if (filters.rma) n++;
  if (filters.label) n++;
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
    staffId: undefined,
    tracking: undefined,
    serial: undefined,
    sku: undefined,
    ticketId: undefined,
    pickupId: undefined,
    rma: undefined,
    label: undefined,
    damageDetected: undefined,
    hasAnalysis: undefined,
  };
}
