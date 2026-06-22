'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useLocations } from '@/hooks/useLocations';
import { useBinsOverview } from '@/hooks/useBinsOverview';
import { EMPTY_FORM, LETTERS, type FormState } from './room-detail-shared';

/**
 * Owns the warehouse room detail form: URL-driven selection (`?room=` / `?new=1`),
 * the locations + bins-overview data, per-room live stats, name/zone validation
 * (taken-name + locked-letter checks), dirty tracking, and the create/rename/delete
 * mutations with URL-param navigation. Returns a controller bag the thin shell +
 * edit-form render from.
 */
export function useRoomDetailForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedRoom = searchParams.get('room') ?? null;
  const creating = searchParams.get('new') === '1';

  const {
    rooms,
    roomNames,
    loading: roomsLoading,
    createRoom,
    renameRoom,
    removeRoom,
    roomMutating,
  } = useLocations();
  const { rows: bins, loading: binsLoading } = useBinsOverview({ pollMs: 0 });

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Map existing zone letters so the picker can grey out locked letters.
  const zoneMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of rooms) {
      const key = (r.room || r.name)?.trim();
      if (!key) continue;
      if (r.zone_letter && /^[A-Z]$/.test(r.zone_letter)) map[key] = r.zone_letter;
    }
    return map;
  }, [rooms]);

  const allRoomNames = useMemo(() => {
    const set = new Set<string>();
    for (const r of rooms) {
      const key = (r.room || r.name)?.trim();
      if (key) set.add(key);
    }
    for (const n of roomNames) if (n) set.add(n);
    return Array.from(set);
  }, [rooms, roomNames]);

  const currentRecord = useMemo(() => {
    if (!selectedRoom) return null;
    return (
      rooms.find((r) => (r.room || r.name) === selectedRoom) ?? null
    );
  }, [rooms, selectedRoom]);

  // Hydrate form when selection changes / create mode toggles.
  useEffect(() => {
    if (creating) {
      const usedLetters = new Set(Object.values(zoneMap));
      const next = LETTERS.find((l) => !usedLetters.has(l)) ?? 'A';
      setForm({ name: '', letter: next, description: '' });
      return;
    }
    if (selectedRoom) {
      const desc = currentRecord?.description ?? '';
      setForm({
        name: selectedRoom,
        letter: zoneMap[selectedRoom] ?? '',
        description: desc,
      });
      return;
    }
    setForm(EMPTY_FORM);
  }, [creating, selectedRoom, currentRecord, zoneMap]);

  // Live stats for the selected room — same calc the sidebar uses but
  // limited to the focused room.
  const stats = useMemo(() => {
    if (!selectedRoom) return null;
    let binCount = 0;
    let totalQty = 0;
    let totalCapacity = 0;
    let capacitySamples = 0;
    let empty = 0;
    let low = 0;
    let over = 0;
    let stale = 0;
    let lastCounted: string | null = null;
    for (const b of bins) {
      if ((b.room || '').trim() !== selectedRoom) continue;
      binCount += 1;
      totalQty += b.total_qty;
      if (b.capacity != null && b.capacity > 0) {
        totalCapacity += b.capacity;
        capacitySamples += 1;
      }
      if (b.is_empty) empty += 1;
      if (b.has_low_stock) low += 1;
      if (b.is_over_capacity) over += 1;
      if (b.is_stale) stale += 1;
      if (b.last_counted && (!lastCounted || b.last_counted > lastCounted)) {
        lastCounted = b.last_counted;
      }
    }
    return {
      binCount,
      totalQty,
      totalCapacity,
      capacitySamples,
      empty,
      low,
      over,
      stale,
      lastCounted,
    };
  }, [bins, selectedRoom]);

  const usedLetters = useMemo(() => {
    const set = new Set(Object.values(zoneMap));
    // When editing an existing room, allow its current letter to be picked
    // again (otherwise the form would think it's locked).
    if (selectedRoom && zoneMap[selectedRoom]) set.delete(zoneMap[selectedRoom]);
    return set;
  }, [zoneMap, selectedRoom]);

  const trimmedName = form.name.trim();
  const trimmedLetter = (form.letter || '').toUpperCase();
  const nameTaken =
    creating &&
    trimmedName.length > 0 &&
    allRoomNames.includes(trimmedName);
  const renameTaken =
    !creating &&
    !!selectedRoom &&
    trimmedName.length > 0 &&
    trimmedName !== selectedRoom &&
    allRoomNames.includes(trimmedName);
  const canSave =
    trimmedName.length > 0 &&
    /^[A-Z]$/.test(trimmedLetter) &&
    !nameTaken &&
    !renameTaken;

  const isDirty = useMemo(() => {
    if (creating) return trimmedName.length > 0 || trimmedLetter.length > 0;
    if (!selectedRoom) return false;
    const desc = currentRecord?.description ?? '';
    return (
      trimmedName !== selectedRoom ||
      trimmedLetter !== (zoneMap[selectedRoom] ?? '') ||
      form.description !== desc
    );
  }, [creating, trimmedName, trimmedLetter, selectedRoom, currentRecord, form.description, zoneMap]);

  const setParam = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', 'rooms');
      mutate(params);
      router.replace(`/warehouse?${params.toString()}`);
    },
    [router, searchParams],
  );

  const goToBins = useCallback(() => {
    if (!selectedRoom) return;
    setParam((p) => {
      p.set('tab', 'bins');
      p.set('room', selectedRoom);
      p.delete('new');
      p.delete('edit');
    });
  }, [selectedRoom, setParam]);

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    try {
      if (creating) {
        const result = await createRoom(trimmedName, trimmedLetter);
        if (!result) throw new Error('Create failed');
        toast.success(`Room "${trimmedName}" added (Zone ${trimmedLetter})`);
        setParam((p) => {
          p.delete('new');
          p.set('room', trimmedName);
        });
      } else if (selectedRoom) {
        const isRename = trimmedName !== selectedRoom;
        const result = await renameRoom(
          selectedRoom,
          isRename ? trimmedName : undefined,
          trimmedLetter,
        );
        if (!result) throw new Error('Save failed');
        toast.success(
          isRename
            ? `Renamed to "${trimmedName}" (Zone ${trimmedLetter})`
            : `Saved Zone ${trimmedLetter}`,
        );
        if (isRename) {
          setParam((p) => {
            p.set('room', trimmedName);
          });
        }
      }
    } catch (err: any) {
      toast.error(err?.message || 'Could not save');
    }
  }, [canSave, creating, trimmedName, trimmedLetter, selectedRoom, createRoom, renameRoom, setParam]);

  const handleDelete = useCallback(async () => {
    if (!selectedRoom) return;
    try {
      const result = await removeRoom(selectedRoom);
      if (!result) throw new Error('Delete failed');
      toast.success(`Room "${selectedRoom}" deleted`);
      setParam((p) => {
        p.delete('room');
        p.delete('new');
      });
    } catch (err: any) {
      toast.error(err?.message || 'Could not delete');
    } finally {
      setConfirmDelete(false);
    }
  }, [selectedRoom, removeRoom, setParam]);

  const handleDiscard = useCallback(() => {
    if (creating) {
      setParam((p) => p.delete('new'));
      return;
    }
    if (!selectedRoom) return;
    const desc = currentRecord?.description ?? '';
    setForm({
      name: selectedRoom,
      letter: zoneMap[selectedRoom] ?? '',
      description: desc,
    });
  }, [creating, selectedRoom, currentRecord, zoneMap, setParam]);

  return {
    creating, selectedRoom,
    roomsLoading, binsLoading,
    allRoomNames,
    form, setForm,
    confirmDelete, setConfirmDelete,
    stats, usedLetters,
    trimmedName, trimmedLetter,
    nameTaken, renameTaken, canSave, isDirty,
    roomMutating,
    setParam, goToBins, handleSave, handleDelete, handleDiscard,
  };
}

export type RoomDetailController = ReturnType<typeof useRoomDetailForm>;
