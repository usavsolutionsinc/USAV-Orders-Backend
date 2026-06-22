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
 *
 * Thin composition shell: URL state + data + mutations live in
 * {@link useRoomDetailForm}; the empty state + edit form are presentational
 * components under `./room-detail/`.
 */

import { useRoomDetailForm } from './room-detail/useRoomDetailForm';
import { EmptyState } from './room-detail/RoomDetailPieces';
import { RoomEditForm } from './room-detail/RoomEditForm';

export function RoomDetailForm() {
  const c = useRoomDetailForm();

  // ── Empty state — no selection ─────────────────────────────────────────
  if (!c.selectedRoom && !c.creating) {
    return (
      <EmptyState
        loading={c.roomsLoading}
        roomCount={c.allRoomNames.length}
        onCreate={() => c.setParam((p) => p.set('new', '1'))}
      />
    );
  }

  // ── Edit / Create form ────────────────────────────────────────────────
  return <RoomEditForm c={c} />;
}
