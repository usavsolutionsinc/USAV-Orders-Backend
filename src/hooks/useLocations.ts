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

async function postRoom(payload: { name: string; description?: string | null }): Promise<LocationRecord> {
  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Failed to create room');
  return data.room;
}

async function patchRoom(args: { oldName: string; newName: string }): Promise<{ updated: number; barcodesRekeyed: number }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(args.oldName)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: args.newName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Failed to rename room');
  return data;
}

async function deleteRoom(name: string): Promise<{ deactivated: number }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(name)}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Failed to delete room');
  return data;
}

export interface BulkBinRangePayload {
  room: string;
  rowLabel: string;
  colStart: number;
  colEnd: number;
  binType?: string | null;
  capacity?: number | null;
}

async function postBulkBins(payload: BulkBinRangePayload): Promise<{ created: number; bins: LocationRecord[] }> {
  const res = await fetch('/api/locations/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Failed to create bins');
  return data;
}

async function postReorderRooms(order: string[]): Promise<{ updated: number }> {
  const res = await fetch('/api/rooms/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Failed to reorder rooms');
  return data;
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
  /** Create a brand-new room (just a parent entry; no bins). */
  createRoom: (name: string) => Promise<LocationRecord | null>;
  /** Rename a room everywhere it appears (parent + all bins + barcodes). */
  renameRoom: (oldName: string, newName: string) => Promise<{ updated: number; barcodesRekeyed: number } | null>;
  /** Soft-delete a room and all of its bins. */
  removeRoom: (name: string) => Promise<{ deactivated: number } | null>;
  /** Bulk-create bins from a range spec ({room, rowLabel, colStart, colEnd}). */
  createBinRange: (payload: BulkBinRangePayload) => Promise<{ created: number; bins: LocationRecord[] } | null>;
  /** Persist a new room display order (array of room names). */
  reorderRooms: (order: string[]) => Promise<{ updated: number } | null>;
  roomMutating: boolean;
  roomMutationError: Error | null;
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

  const { mutate: createRoomRaw, loading: creatingRoom, error: roomCreateError } = useMutation(postRoom);
  const { mutate: renameRoomRaw, loading: renaming, error: renameError } = useMutation(patchRoom);
  const { mutate: deleteRoomRaw, loading: deletingRoom, error: deleteError } = useMutation(deleteRoom);
  const { mutate: bulkBinsRaw, loading: bulkCreating, error: bulkError } = useMutation(postBulkBins);
  const { mutate: reorderRoomsRaw, loading: reordering, error: reorderError } = useMutation(postReorderRooms);

  const createRoom = useCallback(
    async (name: string) => {
      const result = await createRoomRaw({ name });
      if (result) refetch();
      return result as LocationRecord | null;
    },
    [createRoomRaw, refetch],
  );

  const renameRoomFn = useCallback(
    async (oldName: string, newName: string) => {
      const result = await renameRoomRaw({ oldName, newName });
      if (result) refetch();
      return result as { updated: number; barcodesRekeyed: number } | null;
    },
    [renameRoomRaw, refetch],
  );

  const removeRoom = useCallback(
    async (name: string) => {
      const result = await deleteRoomRaw(name);
      if (result) refetch();
      return result as { deactivated: number } | null;
    },
    [deleteRoomRaw, refetch],
  );

  const createBinRange = useCallback(
    async (payload: BulkBinRangePayload) => {
      const result = await bulkBinsRaw(payload);
      if (result) refetch();
      return result as { created: number; bins: LocationRecord[] } | null;
    },
    [bulkBinsRaw, refetch],
  );

  const reorderRoomsFn = useCallback(
    async (order: string[]) => {
      const result = await reorderRoomsRaw(order);
      if (result) refetch();
      return result as { updated: number } | null;
    },
    [reorderRoomsRaw, refetch],
  );

  const roomMutating = creatingRoom || renaming || deletingRoom || bulkCreating || reordering;
  const roomMutationError = roomCreateError || renameError || deleteError || bulkError || reorderError;

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
    createRoom,
    renameRoom: renameRoomFn,
    removeRoom,
    createBinRange,
    reorderRooms: reorderRoomsFn,
    roomMutating,
    roomMutationError,
    findByBarcode,
    binsForRoom,
  };
}
