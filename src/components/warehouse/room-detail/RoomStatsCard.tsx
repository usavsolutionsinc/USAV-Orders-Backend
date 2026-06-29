import { WorkspaceCard } from '@/design-system/components';
import { Button } from '@/design-system/primitives';
import { Box } from '@/components/Icons';
import { FillBar } from '../FillBar';
import { Stat, Tally } from './RoomDetailPieces';
import type { RoomDetailController } from './useRoomDetailForm';

type RoomStats = NonNullable<RoomDetailController['stats']>;

/** Live overview card — per-room bin/unit/capacity stats + alert tallies. */
export function RoomStatsCard({
  stats,
  selectedRoom,
  onOpenBins,
}: {
  stats: RoomStats;
  selectedRoom: string | null;
  onOpenBins: () => void;
}) {
  return (
    <WorkspaceCard
      tone="blue"
      label="Live overview"
      actions={
        <Button
          variant="secondary"
          size="sm"
          icon={<Box />}
          onClick={onOpenBins}
          disabled={!selectedRoom}
          className="h-7 rounded-full bg-blue-50 px-2.5 text-blue-700 ring-blue-200 hover:bg-blue-100"
        >
          Open bins
        </Button>
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
  );
}
