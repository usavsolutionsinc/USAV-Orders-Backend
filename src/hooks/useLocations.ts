import { useCallback, useMemo } from 'react';
import { useFetch, useMutation } from './_data';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LocationRecord {
  id: number;
  name: string;
  room: string | null;
  description: string | null;
  barcode: string | null;
  is_active: boolean;
  sort_order: number;
  row_label: string | null;
  col_label: string | null;
  bin_type: string | null;
  capacity: number | null;
  parent_id: number | null;
}

export interface CreateLocationPayload {
  name: string;
  room?: string | null;
  description?: string | null;
  barcode?: string | null;
  sortOrder?: number;
  rowLabel?: string | null;
  colLabel?: string | null;
  binType?: string | null;
  capacity?: number | null;
  parentId?: number | null;
}

/** Room → { rows: { [row]: cols[] } } structure for cascading pickers. */
export type RoomStructure = Record<string, { rows: Record<string, string[]> }>;

// ─── Fetcher ────────────────────────────────────────────────────────────────

interface LocationsResponse {
  locations: LocationRecord[];
  roomStructure: RoomStructure;
}

async function fetchLocations(): Promise<LocationsResponse> {
  const res = await fetch('/api/locations');
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Failed to fetch locations');
  return {
    locations: Array.isArray(data?.locations) ? data.locations : [],
    roomStructure: data?.roomStructure ?? {},
  };
}

async function postLocation(payload: CreateLocationPayload): Promise<LocationRecord> {
  const res = await fetch('/api/locations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Failed to create location');
  return data.location;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export interface UseLocationsResult {
  locations: LocationRecord[];
  /** Room-level locations only (no row/col). */
  rooms: LocationRecord[];
  /** Bin-level locations only (with row/col). */
  bins: LocationRecord[];
  /** Room → rows → cols cascading structure. */
  roomStructure: RoomStructure;
  /** Get distinct rooms as strings. */
  roomNames: string[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  create: (payload: CreateLocationPayload) => Promise<LocationRecord | null>;
  creating: boolean;
  createError: Error | null;
  /** Resolve a barcode to its location record. */
  findByBarcode: (barcode: string) => LocationRecord | undefined;
  /** Get all bins for a specific room. */
  binsForRoom: (room: string) => LocationRecord[];
}

export function useLocations(): UseLocationsResult {
  const { data, loading, error, refetch } = useFetch(fetchLocations, []);

  const {
    mutate: createRaw,
    loading: creating,
    error: createError,
  } = useMutation(postLocation);

  const create = useCallback(
    async (payload: CreateLocationPayload): Promise<LocationRecord | null> => {
      const result = await createRaw(payload);
      if (result) refetch();
      return result as LocationRecord | null;
    },
    [createRaw, refetch],
  );

  const locations = data?.locations ?? [];
  const roomStructure = data?.roomStructure ?? {};

  const rooms = useMemo(
    () => locations.filter((l) => !l.row_label && !l.col_label),
    [locations],
  );

  const bins = useMemo(
    () => locations.filter((l) => l.row_label && l.col_label),
    [locations],
  );

  const roomNames = useMemo(
    () => [...new Set(locations.map((l) => l.room).filter(Boolean))] as string[],
    [locations],
  );

  const findByBarcode = useCallback(
    (barcode: string) => locations.find((l) => l.barcode === barcode),
    [locations],
  );

  const binsForRoom = useCallback(
    (room: string) => bins.filter((b) => b.room === room),
    [bins],
  );

  return {
    locations,
    rooms,
    bins,
    roomStructure,
    roomNames,
    loading,
    error,
    refetch,
    create,
    creating,
    createError,
    findByBarcode,
    binsForRoom,
  };
}
