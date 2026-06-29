import { SkeletonCardGrid } from '@/components/ui/SkeletonCard';
import { ZoneLetterTile } from './ZoneLetterTile';

interface RoomPickerProps {
  rooms: string[];
  zoneMap: Record<string, string>;
  loading: boolean;
  selectedRoom?: string;
  onSelect: (n: string) => void;
}

/** Read-only room grid for the zone step (CRUD lives in RoomsBoard). */
export function RoomPicker({ rooms, zoneMap, loading, selectedRoom, onSelect }: RoomPickerProps) {
  if (loading) return <SkeletonCardGrid count={4} className="h-16" />;
  if (rooms.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 px-5 py-10 text-center">
        <p className="text-sm font-semibold text-gray-700">No rooms yet</p>
        <p className="mt-1 text-[11.5px] text-gray-500">
          Open the <span className="font-semibold">Rooms</span> tab and add one — it'll show up here.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {rooms.map((room) => {
        const letter = zoneMap[room];
        const isSelected = selectedRoom === room;
        return (
          <button
            key={room}
            type="button"
            onClick={() => onSelect(room)}
            className={`ds-raw-button flex items-center gap-3 rounded-2xl border bg-white p-3 text-left transition-all active:scale-[0.99] ${
              isSelected
                ? 'border-blue-300 bg-blue-50/50 ring-2 ring-blue-200'
                : 'border-gray-200 hover:border-blue-200 hover:bg-blue-50/30'
            }`}
          >
            <ZoneLetterTile letter={letter} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug text-gray-900 break-words">{room}</p>
              <p className="mt-0.5 text-caption text-gray-500">
                {letter ? `Zone ${letter}` : 'No zone letter'}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
