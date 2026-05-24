'use client';

/**
 * Right-pane room form for /warehouse?tab=rooms.
 *
 * Driven by URL state:
 *   • `?room=<name>` — show + edit an existing room
 *   • `?new=1`       — show the create form
 *   • neither        — empty state with a CTA
 *
 * Replaces the old RoomsBoard. The room *list* now lives in the sidebar
 * (RoomsSidebarList); this surface focuses on a single room's form fields,
 * live bin stats, and the destructive/edit actions for that room.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useLocations } from '@/hooks/useLocations';
import { useBinsOverview } from '@/hooks/useBinsOverview';
import { WorkspaceCard, StickyActionBar } from '@/design-system/components';
import { ConfirmSheet } from '@/components/ui/BottomSheet';
import { FillBar } from './FillBar';
import {
  Box,
  Check,
  LayoutDashboard,
  Pencil,
  Plus,
  Trash2,
  X,
} from '@/components/Icons';
import { successFeedback, errorFeedback, scanFeedback } from '@/lib/feedback/confirm';
import { PageHeader } from '@/components/ui/pane-header';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

interface FormState {
  name: string;
  letter: string;
  description: string;
}

const EMPTY_FORM: FormState = { name: '', letter: '', description: '' };

export function RoomDetailForm() {
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
        successFeedback();
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
        successFeedback();
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
      errorFeedback();
      toast.error(err?.message || 'Could not save');
    }
  }, [canSave, creating, trimmedName, trimmedLetter, selectedRoom, createRoom, renameRoom, setParam]);

  const handleDelete = useCallback(async () => {
    if (!selectedRoom) return;
    try {
      const result = await removeRoom(selectedRoom);
      if (!result) throw new Error('Delete failed');
      successFeedback();
      toast.success(`Room "${selectedRoom}" deleted`);
      setParam((p) => {
        p.delete('room');
        p.delete('new');
      });
    } catch (err: any) {
      errorFeedback();
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

  // ── Empty state — no selection ─────────────────────────────────────────
  if (!selectedRoom && !creating) {
    return (
      <EmptyState
        loading={roomsLoading}
        roomCount={allRoomNames.length}
        onCreate={() => setParam((p) => p.set('new', '1'))}
      />
    );
  }

  // ── Edit / Create form ────────────────────────────────────────────────
  const title = creating ? 'Add a new room' : selectedRoom;
  const subtitle = creating
    ? 'Give it a friendly name and a zone letter (A–Z). The letter prints on every label and inside the QR code.'
    : 'Update the friendly name or zone letter. Renames cascade through bins and rekey their barcodes.';

  return (
    <div className="flex flex-col pb-28">
      <PageHeader
        eyebrow={creating ? 'New room' : 'Editing room'}
        value={trimmedName || title || 'Untitled room'}
        valueTitle={trimmedName || title || undefined}
        onClose={() => setParam((p) => { p.delete('room'); p.delete('new'); })}
      />

      {/* Hero: zone tile + subtitle */}
      <div className="flex items-start gap-3 px-4 py-4">
        <BigZoneTile letter={trimmedLetter} placeholder={creating && !trimmedLetter} />
        <p className="max-w-[60ch] text-[12.5px] leading-snug text-gray-500">
          {subtitle}
        </p>
      </div>

      <div className="flex flex-col gap-4 px-4">
      {/* Hero block ends; below is the original form structure */}

      {/* Stats card (only when editing an existing room with data) */}
      {!creating && stats && (
        <WorkspaceCard
          tone="blue"
          label="Live overview"
          actions={
            <button
              type="button"
              onClick={goToBins}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-blue-50 px-2.5 text-caption font-semibold text-blue-700 ring-1 ring-blue-200 transition-colors hover:bg-blue-100"
              disabled={!selectedRoom}
            >
              <Box className="h-3.5 w-3.5" />
              Open bins
            </button>
          }
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Bins" value={stats.binCount} icon={<Box className="h-3.5 w-3.5" />} />
            <Stat label="Units" value={stats.totalQty} />
            <Stat
              label="Capacity"
              value={
                stats.capacitySamples > 0 && stats.totalCapacity > 0
                  ? stats.totalCapacity
                  : '—'
              }
            />
            <Stat
              label="Alerts"
              value={stats.over + stats.stale + stats.low}
              tone={stats.over + stats.stale + stats.low > 0 ? 'amber' : 'slate'}
            />
          </div>

          {stats.capacitySamples > 0 && stats.totalCapacity > 0 && (
            <div className="mt-4">
              <FillBar
                pct={stats.totalQty / stats.totalCapacity}
                current={stats.totalQty}
                max={stats.totalCapacity}
              />
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            <Tally label="Empty" n={stats.empty} tone="slate" />
            <Tally label="Low" n={stats.low} tone="amber" />
            <Tally label="Over" n={stats.over} tone="red" />
            <Tally label="Stale" n={stats.stale} tone="purple" />
          </div>
        </WorkspaceCard>
      )}

      {/* Name field */}
      <WorkspaceCard label="Room name">
        <p className="mb-2 text-caption text-gray-500">
          The friendly label your team sees in pickers, scanners, and reports.
        </p>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Zone 1 – New"
          autoComplete="off"
          className={`h-12 w-full rounded-2xl border bg-gray-50 px-4 text-base font-semibold text-gray-900 outline-none transition-colors focus:bg-white focus:ring-2 ${
            (nameTaken || renameTaken)
              ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
              : 'border-gray-200 focus:border-blue-500 focus:ring-blue-200'
          }`}
        />
        {(nameTaken || renameTaken) && (
          <p className="mt-1.5 text-caption font-medium text-red-600">
            A room named “{trimmedName}” already exists.
          </p>
        )}
      </WorkspaceCard>

      {/* Zone letter picker */}
      <WorkspaceCard
        label="Zone letter"
        actions={
          <span className="rounded-full bg-blue-50 px-2 py-0.5 font-mono text-caption font-semibold text-blue-700 ring-1 ring-blue-200">
            {trimmedLetter || '—'}
          </span>
        }
      >
        <p className="mb-3 text-caption text-gray-500">
          One A–Z letter per room. Locked letters are already in use by
          another room.
        </p>
        <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-9 md:grid-cols-13">
          {LETTERS.map((l) => {
            const isLocked = usedLetters.has(l);
            const isSelected = trimmedLetter === l;
            return (
              <button
                key={l}
                type="button"
                disabled={isLocked && !isSelected}
                onClick={() => {
                  scanFeedback();
                  setForm((f) => ({ ...f, letter: l }));
                }}
                className={`relative flex h-10 items-center justify-center rounded-xl text-sm font-semibold tabular-nums transition-all active:scale-[0.95] ${
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
      </WorkspaceCard>

      {/* Description */}
      <WorkspaceCard label="Notes (optional)">
        <p className="mb-2 text-caption text-gray-500">
          Anything pickers should know — e.g. “fragile only” or “overflow cage.”
        </p>
        <textarea
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          rows={3}
          placeholder="Add a short note…"
          className="w-full resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-[13.5px] text-gray-900 outline-none transition-colors focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-200"
        />
        {!creating && (
          <p className="mt-1 text-[10.5px] text-gray-400">
            Note storage lands in the next update — name + zone letter save
            today.
          </p>
        )}
      </WorkspaceCard>

      {/* Destructive zone */}
      {!creating && selectedRoom && (
        <WorkspaceCard tone="red" label="Danger zone">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900">
                Delete this room
              </p>
              <p className="mt-0.5 text-[11.5px] text-gray-500">
                Soft delete — bins stay in history and you can recreate the
                room by printing labels under that name again.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={roomMutating}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-red-50 px-3 text-label font-semibold text-red-700 ring-1 ring-red-200 transition-colors hover:bg-red-100 active:scale-95 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        </WorkspaceCard>
      )}

      <ConfirmSheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${selectedRoom ?? ''}?`}
        message="Soft delete — bins remain in history. You can recreate the room by printing labels under that name again."
        confirmLabel="Delete Room"
        destructive
        onConfirm={handleDelete}
      />

      <StickyActionBar
        primary={{
          label: roomMutating
            ? 'Saving…'
            : creating
              ? 'Create room'
              : 'Save changes',
          onClick: handleSave,
          isLoading: roomMutating,
          disabled: !canSave || (!creating && !isDirty),
          tone: 'blue',
          icon: creating ? <Plus className="h-4 w-4" /> : <Check className="h-4 w-4" />,
        }}
        secondary={
          isDirty
            ? {
                label: creating ? 'Cancel' : 'Discard',
                onClick: handleDiscard,
                icon: <X className="h-4 w-4" />,
              }
            : undefined
        }
        hints={[
          { key: '⏎', label: creating ? 'Create' : 'Save' },
          { key: 'Esc', label: 'Close' },
        ]}
      />
      </div>
    </div>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────────

interface EmptyStateProps {
  loading: boolean;
  roomCount: number;
  onCreate: () => void;
}

function EmptyState({ loading, roomCount, onCreate }: EmptyStateProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-50 to-blue-100 ring-1 ring-blue-200">
        <LayoutDashboard className="h-7 w-7 text-blue-600" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-bold tracking-tight text-gray-900">
          {loading ? 'Loading rooms…' : 'Pick a room to edit'}
        </h2>
        <p className="max-w-[42ch] text-sm leading-snug text-gray-500">
          {loading
            ? 'Fetching room records and bin counts from the database…'
            : roomCount === 0
              ? 'No rooms exist yet. Add your first one to start labelling bins.'
              : 'Select a room in the sidebar to open its form here, or add a brand-new room.'}
        </p>
      </div>
      {!loading && (
        <button
          type="button"
          onClick={() => {
            successFeedback();
            onCreate();
          }}
          className="inline-flex h-11 items-center gap-1.5 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 px-4 text-sm font-semibold text-white shadow-md shadow-blue-600/30 transition-transform active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          {roomCount === 0 ? 'Add your first room' : 'Add a new room'}
        </button>
      )}
      {!loading && roomCount > 0 && (
        <p className="text-[10.5px] uppercase tracking-[0.18em] text-gray-400">
          {roomCount} room{roomCount === 1 ? '' : 's'} on file
        </p>
      )}
    </div>
  );
}

// ─── Small visual helpers ───────────────────────────────────────────────────

function BigZoneTile({ letter, placeholder }: { letter: string; placeholder: boolean }) {
  if (placeholder || !letter) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-gray-50 to-gray-100 font-mono text-2xl font-semibold text-gray-300 ring-1 ring-gray-200">
        <Pencil className="h-5 w-5" />
      </div>
    );
  }
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 font-mono text-2xl font-semibold text-white shadow-md shadow-blue-600/30 ring-1 ring-blue-700/30">
      {letter}
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  tone = 'slate',
}: {
  label: string;
  value: number | string;
  icon?: React.ReactNode;
  tone?: 'slate' | 'amber';
}) {
  const valueClass =
    tone === 'amber'
      ? 'text-amber-700'
      : 'text-gray-900';
  return (
    <div className="rounded-2xl bg-gradient-to-b from-gray-50/70 to-white px-3 py-2.5 ring-1 ring-gray-100">
      <div className="flex items-center gap-1 text-micro font-semibold uppercase tracking-wider text-gray-500">
        {icon}
        {label}
      </div>
      <p className={`mt-1 text-lg font-bold tabular-nums leading-none ${valueClass}`}>
        {value}
      </p>
    </div>
  );
}

function Tally({
  label,
  n,
  tone,
}: {
  label: string;
  n: number;
  tone: 'slate' | 'amber' | 'red' | 'purple';
}) {
  if (n === 0) return null;
  const cls =
    tone === 'amber'
      ? 'bg-amber-50 text-amber-800 ring-amber-200'
      : tone === 'red'
        ? 'bg-red-50 text-red-700 ring-red-200'
        : tone === 'purple'
          ? 'bg-purple-50 text-purple-700 ring-purple-200'
          : 'bg-slate-50 text-slate-700 ring-slate-200';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-semibold uppercase tracking-wider ring-1 ${cls}`}
    >
      {label}
      <span className="tabular-nums">{n}</span>
    </span>
  );
}
