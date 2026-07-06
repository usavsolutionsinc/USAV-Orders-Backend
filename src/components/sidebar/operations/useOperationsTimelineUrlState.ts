'use client';

/**
 * URL ⇄ state for the Master Operations Journey (Operations ▸ History).
 *
 * Every filter lives in `searchParams` so a view is deep-linkable + reload-safe
 * and the right pane reacts to the same params (Monitor archetype: filters are
 * URL state, no durable selection). The sidebar search bar drives the FOCUSED
 * ENTITY for the active dimension — typing a serial with `dim=serial` sets
 * `?serial=`, which the right pane renders as that entity's full journey;
 * clearing it returns to browse mode. Mirrors `usePhotoLibraryUrlState`.
 */

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  parseJourneyDimension,
  JOURNEY_DIMENSION_PARAM,
} from './operations-sidebar-shared';
import type { JourneyDimension } from '@/lib/timeline/journey';

/** The full filter snapshot — also the shape persisted in a saved view. */
export interface JourneyUrlFilters {
  dim: JourneyDimension;
  order: string | null;
  serial: string | null;
  tracking: string | null;
  from: string | null;
  until: string | null;
  stations: string[];
  types: string[];
  status: string | null;
  /** Actor filter — `staff.id` as a string (browse). */
  staffId: string | null;
  /** Journey source-spine filter (CSV of `sal`/`inventory`/`audit`/`carrier`/`warranty`). */
  sources: string[];
  q: string | null;
}

const ENTITY_KEYS = ['order', 'serial', 'tracking'] as const;
const FILTER_KEYS = [
  'dim',
  'order',
  'serial',
  'tracking',
  'from',
  'until',
  'stations',
  'types',
  'status',
  'staffId',
  'sources',
  'q',
] as const;

function csv(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface OperationsTimelineUrlState {
  dim: JourneyDimension;
  /** The focused entity value for the active dimension (empty = browse mode). */
  entityValue: string;
  focused: boolean;
  /** Browse query (?q=) — fuzzy cross-entity search, distinct from focus. */
  q: string;
  from: string;
  until: string;
  stations: string[];
  types: string[];
  status: string;
  staffId: string;
  sources: string[];
  /** The applied saved-view marker (`?view=` — user id or `sys:<preset>`), '' if none. */
  view: string;
  filters: JourneyUrlFilters;
  /** Count of active *narrowing* filters (excludes dim + focused entity). */
  activeFilterCount: number;
  setDim: (next: JourneyDimension) => void;
  /**
   * Focus an entity (empty = clear focus). `dimOverride` switches the active
   * dimension in the same URL write (e.g. drilling an order row from a mixed
   * browse list). The browse query (?q=) is preserved so "Clear" returns to it.
   */
  setEntity: (value: string, dimOverride?: JourneyDimension) => void;
  /** Set the browse query (?q=); clears any focused entity (mutually exclusive). */
  setQ: (next: string) => void;
  setRange: (from: string | null, until: string | null) => void;
  toggleStation: (id: string) => void;
  toggleType: (id: string) => void;
  setStatus: (value: string | null) => void;
  setStaffId: (value: string | null) => void;
  toggleSource: (id: string) => void;
  /** Apply a saved-view's filters, stamping `?view=` with its marker (or clearing it). */
  applyView: (filters: Partial<JourneyUrlFilters>, viewParam?: string | null) => void;
  clearFilters: () => void;
}

export function useOperationsTimelineUrlState(): OperationsTimelineUrlState {
  const router = useRouter();
  const searchParams = useSearchParams();

  const dim = parseJourneyDimension(searchParams.get('dim'));
  const order = searchParams.get('order') ?? '';
  const serial = searchParams.get('serial') ?? '';
  const tracking = searchParams.get('tracking') ?? '';
  const from = searchParams.get('from') ?? '';
  const until = searchParams.get('until') ?? '';
  const stations = useMemo(() => csv(searchParams.get('stations')), [searchParams]);
  const types = useMemo(() => csv(searchParams.get('types')), [searchParams]);
  const status = searchParams.get('status') ?? '';
  const staffId = searchParams.get('staffId') ?? '';
  const sources = useMemo(() => csv(searchParams.get('sources')), [searchParams]);
  const view = searchParams.get('view') ?? '';
  const q = searchParams.get('q') ?? '';

  const entityValue = dim === 'order' ? order : dim === 'serial' ? serial : tracking;

  const replaceParams = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('mode', 'history'); // History mode always owns these params.
      // Any hand edit deviates from an applied saved view → drop the marker.
      // applyView re-sets it inside its own mutate, so presets survive.
      params.delete('view');
      mutate(params);
      params.delete('cursor'); // any filter change invalidates the keyset cursor
      const qs = params.toString();
      router.replace(qs ? `/operations?${qs}` : '/operations', { scroll: false });
    },
    [router, searchParams],
  );

  const setDim = useCallback(
    (next: JourneyDimension) =>
      replaceParams((p) => {
        p.set('dim', next);
        // Drop the other dimensions' focused entity; keep the active one's.
        for (const k of ENTITY_KEYS) if (k !== JOURNEY_DIMENSION_PARAM[next]) p.delete(k);
      }),
    [replaceParams],
  );

  const setEntity = useCallback(
    (value: string, dimOverride?: JourneyDimension) =>
      replaceParams((p) => {
        const targetDim = dimOverride ?? dim;
        if (dimOverride) p.set('dim', dimOverride);
        for (const k of ENTITY_KEYS) p.delete(k);
        const v = value.trim();
        if (v) p.set(JOURNEY_DIMENSION_PARAM[targetDim], v);
        // NB: ?q= is intentionally preserved so "Clear" returns to the list.
      }),
    [replaceParams, dim],
  );

  const setQ = useCallback(
    (next: string) =>
      replaceParams((p) => {
        const v = next.trim();
        if (v) p.set('q', v);
        else p.delete('q');
        // Browsing is mutually exclusive with a focused entity.
        for (const k of ENTITY_KEYS) p.delete(k);
      }),
    [replaceParams],
  );

  const setRange = useCallback(
    (fromVal: string | null, untilVal: string | null) =>
      replaceParams((p) => {
        if (fromVal) p.set('from', fromVal);
        else p.delete('from');
        if (untilVal) p.set('until', untilVal);
        else p.delete('until');
      }),
    [replaceParams],
  );

  const toggleCsv = useCallback(
    (key: 'stations' | 'types' | 'sources', id: string) =>
      replaceParams((p) => {
        const set = new Set(csv(p.get(key)));
        if (set.has(id)) set.delete(id);
        else set.add(id);
        if (set.size) p.set(key, [...set].join(','));
        else p.delete(key);
      }),
    [replaceParams],
  );

  const setStatus = useCallback(
    (value: string | null) =>
      replaceParams((p) => {
        if (value) p.set('status', value);
        else p.delete('status');
      }),
    [replaceParams],
  );

  const setStaffId = useCallback(
    (value: string | null) =>
      replaceParams((p) => {
        if (value) p.set('staffId', value);
        else p.delete('staffId');
      }),
    [replaceParams],
  );

  const applyView = useCallback(
    (filters: Partial<JourneyUrlFilters>, viewParam?: string | null) =>
      replaceParams((p) => {
        for (const k of FILTER_KEYS) p.delete(k);
        if (filters.dim) p.set('dim', filters.dim);
        if (filters.order) p.set('order', filters.order);
        if (filters.serial) p.set('serial', filters.serial);
        if (filters.tracking) p.set('tracking', filters.tracking);
        if (filters.from) p.set('from', filters.from);
        if (filters.until) p.set('until', filters.until);
        if (filters.stations?.length) p.set('stations', filters.stations.join(','));
        if (filters.types?.length) p.set('types', filters.types.join(','));
        if (filters.status) p.set('status', filters.status);
        if (filters.staffId) p.set('staffId', filters.staffId);
        if (filters.sources?.length) p.set('sources', filters.sources.join(','));
        if (filters.q) p.set('q', filters.q);
        // Stamp the saved-view marker last (replaceParams cleared it up front).
        if (viewParam) p.set('view', viewParam);
      }),
    [replaceParams],
  );

  const clearFilters = useCallback(
    () =>
      replaceParams((p) => {
        // Keep the dimension; clear the focused entity + all narrowing filters.
        for (const k of FILTER_KEYS) if (k !== 'dim') p.delete(k);
      }),
    [replaceParams],
  );

  const filters: JourneyUrlFilters = useMemo(
    () => ({
      dim,
      order: order || null,
      serial: serial || null,
      tracking: tracking || null,
      from: from || null,
      until: until || null,
      stations,
      types,
      status: status || null,
      staffId: staffId || null,
      sources,
      q: q || null,
    }),
    [dim, order, serial, tracking, from, until, stations, types, status, staffId, sources, q],
  );

  const activeFilterCount =
    (from || until ? 1 : 0) +
    stations.length +
    types.length +
    (status ? 1 : 0) +
    (staffId ? 1 : 0) +
    sources.length;

  return {
    dim,
    entityValue,
    focused: !!entityValue.trim(),
    q,
    from,
    until,
    stations,
    types,
    status,
    staffId,
    sources,
    view,
    filters,
    activeFilterCount,
    setDim,
    setEntity,
    setQ,
    setRange,
    toggleStation: (id: string) => toggleCsv('stations', id),
    toggleType: (id: string) => toggleCsv('types', id),
    setStatus,
    setStaffId,
    toggleSource: (id: string) => toggleCsv('sources', id),
    applyView,
    clearFilters,
  };
}
