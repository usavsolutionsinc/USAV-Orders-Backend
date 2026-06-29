'use client';

import { WorkspaceCard, StickyActionBar } from '@/design-system/components';
import { Button } from '@/design-system/primitives';
import { ConfirmSheet } from '@/components/ui/BottomSheet';
import { PageHeader } from '@/components/ui/pane-header';
import { Check, Plus, Trash2, X } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { LETTERS } from './room-detail-shared';
import { BigZoneTile } from './RoomDetailPieces';
import { RoomStatsCard } from './RoomStatsCard';
import type { RoomDetailController } from './useRoomDetailForm';

/** The room edit / create form body (shown when `?room=` or `?new=1`). */
export function RoomEditForm({ c }: { c: RoomDetailController }) {
  const {
    creating, selectedRoom, form, setForm, confirmDelete, setConfirmDelete,
    stats, usedLetters, trimmedName, trimmedLetter,
    nameTaken, renameTaken, canSave, isDirty, roomMutating,
    setParam, goToBins, handleSave, handleDelete, handleDiscard,
  } = c;

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
        <RoomStatsCard stats={stats} selectedRoom={selectedRoom} onOpenBins={goToBins} />
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
            const showLocked = isLocked && !isSelected;
            const btn = (
              <button
                key={l}
                type="button"
                disabled={isLocked && !isSelected}
                onClick={() => setForm((f) => ({ ...f, letter: l }))}
                className={`ds-raw-button relative flex h-10 items-center justify-center rounded-xl text-sm font-semibold tabular-nums transition-all active:scale-[0.95] ${
                  isSelected
                    ? 'bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-md shadow-blue-600/30'
                    : isLocked
                      ? 'bg-gray-100 text-gray-300'
                      : 'border border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                }`}
              >
                {l}
              </button>
            );
            return showLocked ? (
              <HoverTooltip key={l} label="Already used by another room" asChild>
                {btn}
              </HoverTooltip>
            ) : btn;
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
            <Button
              variant="secondary"
              onClick={() => setConfirmDelete(true)}
              disabled={roomMutating}
              icon={<Trash2 className="h-3.5 w-3.5" />}
              className="h-10 shrink-0 rounded-full bg-red-50 px-3 text-label text-red-700 ring-red-200 hover:bg-red-100 hover:text-red-700"
            >
              Delete
            </Button>
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
