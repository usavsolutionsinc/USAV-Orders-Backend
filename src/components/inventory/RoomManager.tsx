'use client';

/**
 * Standalone room manager: list, create, rename, re-letter, delete, reorder.
 * Used on /inventory/rooms (and reusable elsewhere). The bin label printer
 * still has its own embedded room picker because it's mid-flow there; this
 * component is what staff use when they're managing rooms as the primary task.
 */

import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { AnimatePresence, motion, Reorder, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import { BottomSheet, ConfirmSheet } from '@/components/ui/BottomSheet';
import { SkeletonCardGrid } from '@/components/ui/SkeletonCard';
import { Check, Pencil, Plus, Trash2 } from '@/components/Icons';
import { successFeedback, errorFeedback, scanFeedback } from '@/lib/feedback/confirm';
import { useLocations } from '@/hooks/useLocations';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

interface Props {
  /** Optional: when provided, tapping a room card outside edit mode fires this. */
  onPickRoom?: (name: string) => void;
  /** Optional: which room is currently picked (for highlight). */
  pickedRoom?: string | null;
  /** Hide bin counts when false (default true). */
  showCounts?: boolean;
}

function nextFreeLetter(used: Set<string>): string {
  for (const l of LETTERS) if (!used.has(l)) return l;
  return 'A';
}

export function RoomManager({ onPickRoom, pickedRoom, showCounts = true }: Props) {
  const {
    locations,
    rooms,
    roomNames,
    loading,
    createRoom,
    renameRoom,
    removeRoom,
    reorderRooms,
    roomMutating,
  } = useLocations();

  const [editMode, setEditMode] = useState(false);
  const [editingRoom, setEditingRoom] = useState<string | null>(null);
  const [addingRoom, setAddingRoom] = useState(false);
  const [confirmDeleteRoom, setConfirmDeleteRoom] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());

  // Room name canonical list — union of parent rows and bin-room values.
  const allRoomNames = useMemo(() => {
    const set = new Set<string>();
    for (const r of rooms) {
      const key = (r.room || r.name)?.trim();
      if (key) set.add(key);
    }
    for (const r of roomNames) if (r) set.add(r);
    return Array.from(set);
  }, [rooms, roomNames]);

  // Server-of-record zone letters from the locations table.
  const zoneMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of rooms) {
      const key = (r.room || r.name)?.trim();
      if (!key) continue;
      if (r.zone_letter && /^[A-Z]$/.test(r.zone_letter)) map[key] = r.zone_letter;
    }
    return map;
  }, [rooms]);

  const orderedRooms = useMemo(() => {
    const baseline = localOrder
      ? localOrder.filter((n) => allRoomNames.includes(n))
      : [...allRoomNames].sort((a, b) => {
          const sa = rooms.find((r) => (r.room || r.name) === a)?.sort_order ?? 0;
          const sb = rooms.find((r) => (r.room || r.name) === b)?.sort_order ?? 0;
          if (sa !== sb) return sa - sb;
          return a.localeCompare(b);
        });
    for (const n of allRoomNames) if (!baseline.includes(n)) baseline.push(n);
    return baseline.filter((n) => !pendingDeletes.has(n));
  }, [allRoomNames, localOrder, rooms, pendingDeletes]);

  const binCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of locations) {
      if (!l.room || !l.row_label || !l.col_label) continue;
      c[l.room] = (c[l.room] ?? 0) + 1;
    }
    return c;
  }, [locations]);

  const usedLetters = useMemo(() => new Set(Object.values(zoneMap)), [zoneMap]);

  const handleAddRoom = useCallback(async (name: string, letter: string) => {
    const next = [name, ...(localOrder ?? orderedRooms)].filter((v, i, arr) => arr.indexOf(v) === i);
    setLocalOrder(next);
    try {
      const result = await createRoom(name, letter);
      if (!result) throw new Error('Create failed');
      successFeedback();
      toast.success(`Room "${name}" added (Zone ${letter})`);
    } catch (err: any) {
      errorFeedback();
      setLocalOrder((cur) => (cur ?? next).filter((n) => n !== name));
      toast.error(err?.message || 'Could not add room');
    }
  }, [createRoom, localOrder, orderedRooms]);

  const handleSaveRoom = useCallback(async (
    oldName: string,
    newName: string,
    letter: string,
  ) => {
    const upperLetter = letter.toUpperCase();
    const isRename = oldName !== newName;
    try {
      const result = await renameRoom(oldName, isRename ? newName : undefined, upperLetter);
      if (!result) throw new Error('Save failed');
      if (isRename) {
        setLocalOrder((cur) => {
          if (!cur) return cur;
          const idx = cur.indexOf(oldName);
          if (idx === -1) return cur;
          const arr = [...cur];
          arr[idx] = newName;
          return arr;
        });
      }
      successFeedback();
      toast.success(
        isRename
          ? `Renamed to "${newName}" (Zone ${upperLetter})`
          : `Zone letter updated to ${upperLetter}`,
      );
    } catch (err: any) {
      errorFeedback();
      toast.error(err?.message || 'Could not save');
    }
  }, [renameRoom]);

  const handleConfirmDelete = useCallback(async () => {
    const name = confirmDeleteRoom;
    if (!name) return;
    setPendingDeletes((s) => new Set(s).add(name));
    try {
      const result = await removeRoom(name);
      if (!result) throw new Error('Delete failed');
      setLocalOrder((cur) => cur?.filter((n) => n !== name) ?? cur);
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
  }, [confirmDeleteRoom, removeRoom]);

  const handleReorder = useCallback((order: string[]) => {
    setLocalOrder(order);
  }, []);

  const handleToggleEdit = useCallback(() => {
    successFeedback();
    setEditMode((v) => {
      if (v && localOrder) {
        const order = localOrder.filter((n) => !pendingDeletes.has(n));
        reorderRooms(order)
          .then(() => {
            toast.success('Room order saved');
            setLocalOrder(null);
          })
          .catch((err) => {
            errorFeedback();
            toast.error(err?.message || 'Could not save order');
          });
      }
      return !v;
    });
  }, [localOrder, pendingDeletes, reorderRooms]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Rooms</h1>
          <p className="text-xs text-gray-500">
            Create, rename, reorder. Zone letter shows on every label and QR.
          </p>
        </div>
        <button
          type="button"
          onClick={handleToggleEdit}
          aria-pressed={editMode}
          className={`flex h-11 w-11 items-center justify-center rounded-full transition-all active:scale-95 ${
            editMode
              ? 'bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-md shadow-blue-600/30'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          {editMode ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
        </button>
      </div>

      {loading ? (
        <SkeletonCardGrid count={5} className="h-16" />
      ) : (
        <Reorder.Group
          axis="y"
          values={orderedRooms}
          onReorder={handleReorder}
          className="flex flex-col gap-2"
          as="div"
        >
          {orderedRooms.length === 0 && !editMode && (
            <div className="rounded-3xl border border-dashed border-gray-200 px-5 py-12 text-center">
              <p className="text-[13px] font-semibold text-gray-700">No rooms yet</p>
              <p className="mt-1 text-[11px] text-gray-400">
                Tap the pencil and then Add Room to get started.
              </p>
            </div>
          )}

          {orderedRooms.map((room) => (
            <Reorder.Item
              key={room}
              value={room}
              dragListener={editMode}
              whileDrag={{ scale: 1.02, zIndex: 20 }}
              className="touch-none"
              as="div"
            >
              <RoomCard
                room={room}
                letter={zoneMap[room]}
                binCount={showCounts ? binCounts[room] ?? 0 : null}
                editMode={editMode}
                mutating={roomMutating}
                picked={pickedRoom === room}
                onSelect={(n) => {
                  if (editMode) {
                    setEditingRoom(n);
                  } else if (onPickRoom) {
                    onPickRoom(n);
                  }
                }}
                onStartRename={(n) => setEditingRoom(n)}
                onRequestDelete={(n) => setConfirmDeleteRoom(n)}
              />
            </Reorder.Item>
          ))}

          {editMode && (
            <button
              type="button"
              onClick={() => setAddingRoom(true)}
              className="mt-1 flex h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-blue-300 bg-blue-50/40 text-[13px] font-semibold text-blue-600 transition-colors hover:bg-blue-100/60 active:scale-[0.99]"
            >
              <Plus className="h-4 w-4" />
              Add Room
            </button>
          )}
        </Reorder.Group>
      )}

      <RoomEditSheet
        open={addingRoom}
        onClose={() => setAddingRoom(false)}
        title="Add a new room"
        message="Give it a friendly name and a zone letter (A–Z). The letter shows on every printed label and inside the QR code."
        confirmLabel="Add Room"
        initialName=""
        initialLetter={nextFreeLetter(usedLetters)}
        lockedLetters={usedLetters}
        onSave={(name, letter) => handleAddRoom(name, letter)}
      />

      <RoomEditSheet
        open={editingRoom !== null}
        onClose={() => setEditingRoom(null)}
        title="Edit room"
        message="Rename the friendly label and/or change which zone letter (A–Z) it maps to."
        confirmLabel="Save"
        initialName={editingRoom ?? ''}
        initialLetter={editingRoom ? zoneMap[editingRoom] ?? nextFreeLetter(usedLetters) : 'A'}
        lockedLetters={new Set(
          Object.entries(zoneMap)
            .filter(([k]) => k !== editingRoom)
            .map(([, v]) => v),
        )}
        onSave={(name, letter) => {
          if (editingRoom) handleSaveRoom(editingRoom, name, letter);
        }}
      />

      <ConfirmSheet
        open={!!confirmDeleteRoom}
        onClose={() => setConfirmDeleteRoom(null)}
        title={`Delete ${confirmDeleteRoom ?? ''}?`}
        message="Soft delete — bins remain in history. You can recreate the room by printing labels under that name again."
        confirmLabel="Delete Room"
        destructive
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

interface RoomCardProps {
  room: string;
  letter?: string;
  binCount: number | null;
  editMode: boolean;
  mutating: boolean;
  picked: boolean;
  onSelect: (n: string) => void;
  onStartRename: (n: string) => void;
  onRequestDelete: (n: string) => void;
}

function RoomCard(p: RoomCardProps) {
  const reduceMotion = useReducedMotion();
  const pressTimer = useRef<number | null>(null);
  const longPressedRef = useRef(false);

  const startPress = () => {
    longPressedRef.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressedRef.current = true;
      successFeedback();
      p.onStartRename(p.room);
    }, 380);
  };
  const cancelPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  return (
    <motion.div
      layout={!reduceMotion}
      whileTap={p.editMode ? undefined : { scale: 0.99 }}
      transition={{ type: 'spring', damping: 28, stiffness: 320 }}
      className={`relative flex items-center gap-2 overflow-hidden rounded-2xl border bg-white pl-2 pr-3 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-16px_rgba(0,0,0,0.10)] ${
        p.picked ? 'border-blue-300 ring-2 ring-blue-200' : 'border-gray-200'
      }`}
    >
      {p.editMode && (
        <div
          aria-hidden="true"
          className="flex h-12 w-6 flex-shrink-0 cursor-grab items-center justify-center text-gray-300 active:cursor-grabbing"
        >
          <div className="flex flex-col gap-[3px]">
            <span className="block h-1 w-1 rounded-full bg-current" />
            <span className="block h-1 w-1 rounded-full bg-current" />
            <span className="block h-1 w-1 rounded-full bg-current" />
          </div>
        </div>
      )}

      <button
        type="button"
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onClick={() => {
          if (longPressedRef.current) return;
          p.onSelect(p.room);
        }}
        className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 pl-2 pr-1 text-left active:bg-gray-50/60"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-snug tracking-tight text-gray-900 break-words">
            {p.room}
          </p>
          {p.binCount !== null && (
            <p className="mt-1 text-[11px] font-medium text-gray-500">
              {p.binCount} bin{p.binCount === 1 ? '' : 's'}
            </p>
          )}
        </div>
        <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl font-mono text-[18px] font-semibold ${
          p.letter
            ? 'bg-gradient-to-br from-blue-50 to-blue-100/60 text-blue-700 ring-1 ring-blue-200'
            : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
        }`}>
          {p.letter ?? '?'}
        </div>
      </button>

      {p.editMode && (
        <button
          type="button"
          onClick={() => p.onRequestDelete(p.room)}
          aria-label={`Delete ${p.room}`}
          disabled={p.mutating}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600 transition-colors hover:bg-red-100 active:scale-95 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </motion.div>
  );
}

interface RoomEditSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  confirmLabel?: string;
  initialName: string;
  initialLetter: string;
  lockedLetters: Set<string>;
  onSave: (name: string, letter: string) => void;
}

function RoomEditSheet({
  open, onClose, title, message,
  confirmLabel = 'Save',
  initialName, initialLetter, lockedLetters,
  onSave,
}: RoomEditSheetProps) {
  const [name, setName] = useState(initialName);
  const [letter, setLetter] = useState(initialLetter);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setLetter(initialLetter);
      const t = setTimeout(() => inputRef.current?.focus(), 220);
      return () => clearTimeout(t);
    }
  }, [open, initialName, initialLetter]);

  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0 && /[A-Z]/.test(letter);

  const handleSave = () => {
    if (!canSave) return;
    onSave(trimmedName, letter);
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      {message && (
        <p className="mb-3 text-center text-[12px] text-gray-500">{message}</p>
      )}
      <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        Room Name
      </label>
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
          if (e.key === 'Escape') onClose();
        }}
        placeholder="e.g. Receiving Cage 04"
        autoComplete="off"
        className="mt-1 mb-4 h-12 w-full rounded-2xl border border-gray-300 bg-gray-50 px-4 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-200"
      />

      <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        Zone letter (A–Z)
      </label>
      <div className="mt-2 mb-4 grid grid-cols-6 gap-1.5 sm:grid-cols-9">
        {LETTERS.map((l) => {
          const isLocked = lockedLetters.has(l);
          const isSelected = letter === l;
          return (
            <button
              key={l}
              type="button"
              disabled={isLocked && !isSelected}
              onClick={() => { scanFeedback(); setLetter(l); }}
              className={`relative flex h-10 items-center justify-center rounded-xl text-[14px] font-semibold tabular-nums transition-all active:scale-[0.95] ${
                isSelected
                  ? 'bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-md shadow-blue-600/30'
                  : isLocked
                    ? 'bg-gray-100 text-gray-300'
                    : 'border border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50'
              }`}
              title={isLocked && !isSelected ? 'Already used by another room' : undefined}
            >
              {l}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-sm font-semibold tracking-wide text-white shadow-md shadow-blue-600/30 transition-transform active:scale-[0.98] disabled:opacity-40 sm:flex-1"
        >
          <Check className="mr-1.5 h-4 w-4" />
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-12 w-full items-center justify-center rounded-2xl text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100 sm:flex-1"
        >
          Cancel
        </button>
      </div>
    </BottomSheet>
  );
}
