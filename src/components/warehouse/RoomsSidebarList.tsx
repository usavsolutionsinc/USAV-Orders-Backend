'use client';

/**
 * Sidebar body for `?tab=rooms`. Renders the full list of rooms (matching
 * the cards from RoomsBoard), a contextual rooms-search bar, and an
 * edit-mode toggle. Selecting a room sets `?room=<name>` so the right pane
 * (RoomDetailForm) can drive its form state from the URL.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion, Reorder, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import { useLocations } from '@/hooks/useLocations';
import { useBinsOverview } from '@/hooks/useBinsOverview';
import { useRoomFinder } from './roomFinderContext';
import { Check, GripVertical, Pencil, Plus, Trash2, X } from '@/components/Icons';
import { successFeedback, errorFeedback } from '@/lib/feedback/confirm';

interface RoomSummary {
  key: string;
  room: string;
  letter: string | null;
  binCount: number;
  totalQty: number;
  alerts: number;
}

export function RoomsSidebarList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedRoom = searchParams.get('room') ?? null;
  const editMode = searchParams.get('edit') === '1';
  const creating = searchParams.get('new') === '1';

  const {
    rooms,
    roomNames,
    loading: roomsLoading,
    removeRoom,
    reorderRooms,
    roomMutating,
  } = useLocations();
  const { rows: bins, loading: binsLoading } = useBinsOverview({ pollMs: 0 });

  const { query } = useRoomFinder();
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());

  const setParam = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', 'rooms');
      mutate(params);
      router.replace(`/warehouse?${params.toString()}`);
    },
    [router, searchParams],
  );

  const selectRoom = useCallback(
    (name: string | null) => {
      setParam((p) => {
        if (name) p.set('room', name);
        else p.delete('room');
        p.delete('new');
      });
    },
    [setParam],
  );

  const setEditMode = useCallback(
    (next: boolean) => {
      setParam((p) => {
        if (next) p.set('edit', '1');
        else p.delete('edit');
      });
    },
    [setParam],
  );

  const startCreate = useCallback(() => {
    setParam((p) => {
      p.set('new', '1');
      p.delete('room');
    });
  }, [setParam]);

  // Zone letters from server (parent rows).
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

  const summaries: RoomSummary[] = useMemo(() => {
    const byRoom = new Map<string, RoomSummary>();
    for (const name of allRoomNames) {
      byRoom.set(name, {
        key: name,
        room: name,
        letter: zoneMap[name] ?? null,
        binCount: 0,
        totalQty: 0,
        alerts: 0,
      });
    }
    for (const b of bins) {
      const name = (b.room || '').trim();
      if (!name) continue;
      let s = byRoom.get(name);
      if (!s) {
        s = { key: name, room: name, letter: b.zone_letter, binCount: 0, totalQty: 0, alerts: 0 };
        byRoom.set(name, s);
      }
      s.binCount += 1;
      s.totalQty += b.total_qty;
      if (b.is_over_capacity) s.alerts += 1;
      if (b.has_low_stock) s.alerts += 1;
      if (b.is_stale) s.alerts += 1;
    }
    return Array.from(byRoom.values());
  }, [allRoomNames, zoneMap, bins]);

  const orderedSummaries = useMemo(() => {
    const base = localOrder
      ? localOrder.filter((n) => summaries.some((s) => s.room === n))
      : summaries
          .slice()
          .sort((a, b) => {
            const sa = rooms.find((r) => (r.room || r.name) === a.room)?.sort_order ?? 0;
            const sb = rooms.find((r) => (r.room || r.name) === b.room)?.sort_order ?? 0;
            if (sa !== sb) return sa - sb;
            return a.room.localeCompare(b.room);
          })
          .map((s) => s.room);
    for (const s of summaries) if (!base.includes(s.room)) base.push(s.room);
    const map = new Map(summaries.map((s) => [s.room, s]));
    return base
      .filter((n) => !pendingDeletes.has(n))
      .map((n) => map.get(n))
      .filter((s): s is RoomSummary => Boolean(s));
  }, [summaries, localOrder, rooms, pendingDeletes]);

  // Apply search filter to the display list (DB lookup is just the global
  // /api/locations fetch; the rooms search filters that result client-side
  // since the dataset is small and already in memory).
  const filteredSummaries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orderedSummaries;
    return orderedSummaries.filter(
      (s) =>
        s.room.toLowerCase().includes(q) ||
        (s.letter && s.letter.toLowerCase().includes(q)),
    );
  }, [orderedSummaries, query]);

  // If the URL points at a room that no longer exists, clear the selection
  // gracefully so the right pane shows the empty state.
  useEffect(() => {
    if (!selectedRoom || roomsLoading) return;
    if (!allRoomNames.includes(selectedRoom)) selectRoom(null);
  }, [selectedRoom, allRoomNames, roomsLoading, selectRoom]);

  const handleReorder = useCallback((order: string[]) => {
    setLocalOrder(order);
  }, []);

  const exitEdit = useCallback(async () => {
    successFeedback();
    if (localOrder) {
      try {
        const order = localOrder.filter((n) => !pendingDeletes.has(n));
        await reorderRooms(order);
        toast.success('Room order saved');
        setLocalOrder(null);
      } catch (err: any) {
        errorFeedback();
        toast.error(err?.message || 'Could not save order');
      }
    }
    setEditMode(false);
  }, [localOrder, pendingDeletes, reorderRooms, setEditMode]);

  const handleDelete = useCallback(
    async (name: string) => {
      const ok = window.confirm(`Delete room "${name}"? Bins are preserved in history.`);
      if (!ok) return;
      setPendingDeletes((s) => new Set(s).add(name));
      try {
        const result = await removeRoom(name);
        if (!result) throw new Error('Delete failed');
        setLocalOrder((cur) => cur?.filter((n) => n !== name) ?? cur);
        if (selectedRoom === name) selectRoom(null);
        successFeedback();
        toast.success(`Room "${name}" deleted`);
      } catch (err: any) {
        errorFeedback();
        setPendingDeletes((s) => {
          const next = new Set(s);
          next.delete(name);
          return next;
        });
        toast.error(err?.message || 'Could not delete');
      }
    },
    [removeRoom, selectedRoom, selectRoom],
  );

  const loading = roomsLoading || binsLoading;
  const orderedNames = filteredSummaries.map((s) => s.room);

  const totals = useMemo(
    () =>
      orderedSummaries.reduce(
        (acc, s) => {
          acc.bins += s.binCount;
          acc.qty += s.totalQty;
          return acc;
        },
        { bins: 0, qty: 0 },
      ),
    [orderedSummaries],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Header band: title + edit/add controls ─────────────────────── */}
      <div className="border-b border-gray-100 bg-gradient-to-b from-white to-gray-50/50 px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight text-gray-900">Rooms</h2>
            <p className="mt-0.5 text-caption font-medium text-gray-500">
              {loading
                ? 'Loading…'
                : `${orderedSummaries.length} room${orderedSummaries.length === 1 ? '' : 's'} · ${totals.bins} bin${totals.bins === 1 ? '' : 's'} · ${totals.qty} unit${totals.qty === 1 ? '' : 's'}`}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                successFeedback();
                startCreate();
              }}
              className={`flex h-9 items-center gap-1 rounded-full px-3 text-label font-semibold transition-all active:scale-[0.97] ${
                creating
                  ? 'bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-md shadow-blue-600/30'
                  : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              }`}
              title="Add a new room"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                if (editMode) exitEdit();
                else {
                  successFeedback();
                  setEditMode(true);
                }
              }}
              aria-pressed={editMode}
              className={`flex h-9 w-9 items-center justify-center rounded-full transition-all active:scale-95 ${
                editMode
                  ? 'bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-md shadow-blue-600/30'
                  : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
              title={editMode ? 'Finish editing' : 'Edit rooms'}
            >
              {editMode ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Edit-mode hint */}
        <AnimatePresence>
          {editMode && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 overflow-hidden rounded-lg bg-blue-50/70 px-2.5 py-1.5 text-[10.5px] leading-snug text-blue-700 ring-1 ring-blue-100"
            >
              Drag rooms to reorder · trash deletes (bins preserved). Tap any
              room to open it in the form on the right.
            </motion.p>
          )}
        </AnimatePresence>

        {/* Contextual rooms search lives in the sidebar's header band
            (WarehouseSidebarPanel). One bar per surface — writes into the
            shared RoomFinderContext which this list reads via
            useRoomFinder(). */}
      </div>

      {/* ── Scrolling list of room cards ───────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-3 scrollbar-hide">
        {loading ? (
          <SkeletonList />
        ) : filteredSummaries.length === 0 ? (
          <EmptyState query={query} onAdd={startCreate} />
        ) : (
          <Reorder.Group
            axis="y"
            values={orderedNames}
            onReorder={handleReorder}
            className="flex flex-col gap-2"
            as="div"
          >
            <AnimatePresence initial={false}>
              {filteredSummaries.map((s) => (
                <Reorder.Item
                  key={s.key}
                  value={s.room}
                  dragListener={editMode}
                  whileDrag={{ scale: 1.02, zIndex: 20 }}
                  className="touch-none"
                  as="div"
                >
                  <RoomRow
                    summary={s}
                    selected={selectedRoom === s.room}
                    editMode={editMode}
                    mutating={roomMutating}
                    onSelect={() => {
                      successFeedback();
                      selectRoom(s.room);
                    }}
                    onDelete={() => handleDelete(s.room)}
                  />
                </Reorder.Item>
              ))}
            </AnimatePresence>
          </Reorder.Group>
        )}
      </div>
    </div>
  );
}

// ─── List row ──────────────────────────────────────────────────────────────

interface RoomRowProps {
  summary: RoomSummary;
  selected: boolean;
  editMode: boolean;
  mutating: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

function RoomRow({ summary, selected, editMode, mutating, onSelect, onDelete }: RoomRowProps) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      layout={!reduceMotion}
      transition={{ type: 'spring', damping: 28, stiffness: 320 }}
      className={`relative overflow-hidden rounded-2xl bg-white shadow-sm transition-all ${
        selected
          ? 'ring-2 ring-blue-500 shadow-blue-600/10'
          : 'ring-1 ring-gray-200/70 hover:ring-blue-200'
      }`}
    >
      <div className="flex items-stretch gap-2 p-3">
        {editMode && (
          <div
            aria-hidden
            className="flex w-5 shrink-0 cursor-grab items-center justify-center text-gray-300 active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </div>
        )}

        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <ZoneTile letter={summary.letter} active={selected} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold leading-snug tracking-tight text-gray-900">
              {summary.room}
            </p>
            <p className="mt-0.5 truncate text-[10.5px] font-medium text-gray-500">
              {summary.binCount} bin{summary.binCount === 1 ? '' : 's'} · {summary.totalQty} unit{summary.totalQty === 1 ? '' : 's'}
              {summary.alerts > 0 ? (
                <span className="ml-1 font-semibold text-amber-600">· {summary.alerts} alert{summary.alerts === 1 ? '' : 's'}</span>
              ) : null}
            </p>
          </div>
        </button>

        {editMode && (
          <button
            type="button"
            onClick={onDelete}
            disabled={mutating}
            aria-label={`Delete ${summary.room}`}
            className="flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-full bg-red-50 text-red-600 transition-colors hover:bg-red-100 active:scale-95 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </motion.div>
  );
}

function ZoneTile({ letter, active }: { letter: string | null; active: boolean }) {
  if (letter) {
    return (
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-mono text-base font-semibold ring-1 transition-colors ${
          active
            ? 'bg-gradient-to-br from-blue-500 to-blue-700 text-white ring-blue-700/20 shadow-sm shadow-blue-600/30'
            : 'bg-gradient-to-br from-blue-50 to-blue-100/70 text-blue-700 ring-blue-200'
        }`}
      >
        {letter}
      </div>
    );
  }
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 font-mono text-sm font-semibold text-amber-700 ring-1 ring-amber-200"
      title="No zone letter assigned"
    >
      ?
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="h-[60px] animate-pulse rounded-2xl bg-gradient-to-r from-gray-100 via-gray-50 to-gray-100"
        />
      ))}
    </div>
  );
}

function EmptyState({ query, onAdd }: { query: string; onAdd: () => void }) {
  if (query.trim()) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-50 ring-1 ring-gray-200">
          <X className="h-5 w-5 text-gray-400" />
        </div>
        <p className="text-[12.5px] font-semibold text-gray-700">No rooms match “{query}”</p>
        <p className="max-w-[240px] text-caption text-gray-500">
          Try a different name or zone letter.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100 ring-1 ring-blue-200">
        <Plus className="h-5 w-5 text-blue-500" />
      </div>
      <p className="text-[12.5px] font-semibold text-gray-700">No rooms yet</p>
      <p className="max-w-[240px] text-caption text-gray-500">
        Add your first room. Each room gets a zone letter that prints on every
        label.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="mt-1 inline-flex h-9 items-center gap-1 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 px-3 text-label font-semibold text-white shadow-md shadow-blue-600/30"
      >
        <Plus className="h-3.5 w-3.5" />
        Add a room
      </button>
    </div>
  );
}
