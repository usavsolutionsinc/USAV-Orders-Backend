'use client';

/**
 * Shared sidebar surface for the Labels and Racks printers. Renders the
 * room list driven by the shared RoomFinderContext — the actual search
 * input lives in the sidebar header band (WarehouseSidebarPanel) so each
 * surface only has one search affordance.
 */

import { useMemo } from 'react';
import { SkeletonCardGrid } from '@/components/ui/SkeletonCard';
import { useRoomFinder } from '@/components/warehouse/roomFinderContext';

interface LabelRoomSidebarProps {
  rooms: string[];
  zoneMap: Record<string, string>;
  loading: boolean;
  selectedRoom?: string;
  zoneLetter?: string;
  onSelect: (room: string) => void;
  /** Override the subtitle when no room is selected. */
  emptySubtitle?: string;
}

export function LabelRoomSidebar({
  rooms,
  zoneMap,
  loading,
  selectedRoom,
  zoneLetter,
  onSelect,
  emptySubtitle = 'Then build the label on the right.',
}: LabelRoomSidebarProps) {
  const { query } = useRoomFinder();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter((room) => {
      const letter = zoneMap[room] ?? '';
      return (
        room.toLowerCase().includes(q) ||
        letter.toLowerCase().includes(q)
      );
    });
  }, [rooms, zoneMap, query]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-gray-100 bg-gradient-to-b from-white to-gray-50/50 px-4 pb-3 pt-4">
        <h2 className="text-[15px] font-bold tracking-tight text-gray-900">
          Pick a room
        </h2>
        <p className="mt-0.5 text-[11px] text-gray-500">
          {selectedRoom
            ? `Zone ${zoneLetter ?? '?'} · ${selectedRoom}`
            : emptySubtitle}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-hide">
        {loading ? (
          <SkeletonCardGrid count={4} className="h-16" />
        ) : rooms.length === 0 ? (
          <EmptyRooms />
        ) : filtered.length === 0 ? (
          <NoMatches query={query} />
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((room) => {
              const letter = zoneMap[room];
              const isSelected = selectedRoom === room;
              return (
                <button
                  key={room}
                  type="button"
                  onClick={() => onSelect(room)}
                  className={`flex items-center gap-3 rounded-2xl border bg-white p-3 text-left transition-all active:scale-[0.99] ${
                    isSelected
                      ? 'border-blue-300 bg-blue-50/50 ring-2 ring-blue-200'
                      : 'border-gray-200 hover:border-blue-200 hover:bg-blue-50/30'
                  }`}
                >
                  <ZoneLetterTile letter={letter} active={isSelected} />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-[14px] font-semibold leading-snug text-gray-900">
                      {room}
                    </p>
                    {!letter && (
                      <p className="mt-0.5 text-[10.5px] font-medium uppercase tracking-wider text-amber-600">
                        No zone letter
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyRooms() {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 px-5 py-10 text-center">
      <p className="text-[13px] font-semibold text-gray-700">No rooms yet</p>
      <p className="mt-1 text-[11.5px] text-gray-500">
        Open the <span className="font-semibold">Rooms</span> tab and add one — it'll show up here.
      </p>
    </div>
  );
}

function NoMatches({ query }: { query: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 px-5 py-10 text-center">
      <p className="text-[13px] font-semibold text-gray-700">
        No rooms match “{query.trim()}”
      </p>
      <p className="mt-1 text-[11.5px] text-gray-500">
        Try a different name or zone letter.
      </p>
    </div>
  );
}

function ZoneLetterTile({ letter, active }: { letter: string | undefined; active: boolean }) {
  if (letter) {
    return (
      <div
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl font-mono text-[20px] font-semibold ring-1 transition-colors ${
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
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-50 font-mono text-[18px] font-semibold text-amber-700 ring-1 ring-amber-200"
      title="No zone letter assigned yet — go to the Rooms tab"
    >
      ?
    </div>
  );
}
