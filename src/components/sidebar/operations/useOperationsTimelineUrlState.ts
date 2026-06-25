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
  from: string;
  until: string;
  stations: string[];
  types: string[];
  status: string;
  filters: JourneyUrlFilters;
  /** Count of active *narrowing* filters (excludes dim + focused entity). */
  activeFilterCount: number;
  setDim: (next: JourneyDimension) => void;
  setEntity: (value: string) => void;
  setRange: (from: string | null, until: string | null) => void;
  toggleStation: (id: string) => void;
  toggleType: (id: string) => void;
  setStatus: (value: string | null) => void;
  applyView: (filters: Partial<JourneyUrlFilters>) => void;
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
  const q = searchParams.get('q') ?? '';

  const entityValue = dim === 'order' ? order : dim === 'serial' ? serial : tracking;

  const replaceParams = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('mode', 'history'); // History mode always owns these params.
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
    (value: string) =>
      replaceParams((p) => {
        for (const k of ENTITY_KEYS) p.delete(k);
        const v = value.trim();
        if (v) p.set(JOURNEY_DIMENSION_PARAM[dim], v);
      }),
    [replaceParams, dim],
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
    (key: 'stations' | 'types', id: string) =>
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

  const applyView = useCallback(
    (filters: Partial<JourneyUrlFilters>) =>
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
        if (filters.q) p.set('q', filters.q);
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
      q: q || null,
    }),
    [dim, order, serial, tracking, from, until, stations, types, status, q],
  );

  const activeFilterCount =
    (from || until ? 1 : 0) + stations.length + types.length + (status ? 1 : 0);

  return {
    dim,
    entityValue,
    focused: !!entityValue.trim(),
    from,
    until,
    stations,
    types,
    status,
    filters,
    activeFilterCount,
    setDim,
    setEntity,
    setRange,
    toggleStation: (id: string) => toggleCsv('stations', id),
    toggleType: (id: string) => toggleCsv('types', id),
    setStatus,
    applyView,
    clearFilters,
  };
}
