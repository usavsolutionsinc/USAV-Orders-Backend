import { Button } from '@/design-system/primitives';
import { LayoutDashboard, Pencil, Plus } from '@/components/Icons';

// ─── Empty state ────────────────────────────────────────────────────────────

interface EmptyStateProps {
  loading: boolean;
  roomCount: number;
  onCreate: () => void;
}

export function EmptyState({ loading, roomCount, onCreate }: EmptyStateProps) {
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
        <Button
          variant="primary"
          size="lg"
          icon={<Plus />}
          onClick={() => onCreate()}
          className="h-11 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 px-4 text-white shadow-md shadow-blue-600/30"
        >
          {roomCount === 0 ? 'Add your first room' : 'Add a new room'}
        </Button>
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

export function BigZoneTile({ letter, placeholder }: { letter: string; placeholder: boolean }) {
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

export function Stat({
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

export function Tally({
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
