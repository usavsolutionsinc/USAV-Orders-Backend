'use client';

import { HoverTooltip } from '@/components/ui/HoverTooltip';
import {
  STATION_LABELS,
  STATION_OPTIONS,
  type StationAssignment,
  type StationKey,
} from '../staff-access-shared';

interface StationsCardProps {
  stations: StationAssignment;
  borderClass: string;
  busy: boolean;
  onSave: (next: StationAssignment) => void;
}

export function StationsCard({ stations, borderClass, busy, onSave }: StationsCardProps) {
  return (
    <section className={`overflow-hidden rounded-2xl border ${borderClass} bg-surface-card shadow-sm`}>
      <header className="flex items-center justify-between border-b border-border-hairline px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-text-default">Stations</h2>
          <p className="mt-0.5 text-caption text-text-soft">
            The <b>primary</b> station is always shown in the header goal chip and stays locked.
            Add <b>secondary</b> stations to let this staffer switch between goals — the Switch
            control only appears when at least one secondary is set.
          </p>
        </div>
      </header>
      <div className="space-y-3 px-5 py-4">
        {/* Primary station */}
        <label className="flex items-center gap-2.5">
          <span className="w-20 shrink-0 text-micro font-semibold uppercase tracking-wider text-text-soft">Primary</span>
          <select
            value={stations.primary ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              if (!val) { onSave({ primary: null, secondary: [] }); return; }
              const p = val as StationKey;
              onSave({ primary: p, secondary: stations.secondary.filter((s) => s !== p) });
            }}
            disabled={busy}
            className="h-8 rounded-full bg-surface-sunken px-3 text-micro font-bold uppercase tracking-wider text-text-muted outline-none ring-1 ring-border-soft transition disabled:opacity-60"
          >
            <option value="">— none (auto from employee code) —</option>
            {STATION_OPTIONS.map((st) => (
              <option key={st} value={st}>{STATION_LABELS[st]}</option>
            ))}
          </select>
        </label>

        {/* Secondary stations */}
        <div className="flex items-start gap-2.5">
          <span className="mt-1.5 w-20 shrink-0 text-micro font-semibold uppercase tracking-wider text-text-soft">Secondary</span>
          <div className="flex flex-wrap gap-1.5">
            {STATION_OPTIONS.map((st) => {
              const isPrimary = stations.primary === st;
              const selected = stations.secondary.includes(st);
              const disabled = busy || !stations.primary || isPrimary;
              return (
                <HoverTooltip
                  key={st}
                  label={isPrimary ? 'This is the primary station' : !stations.primary ? 'Pick a primary station first' : selected ? 'Remove secondary station' : 'Add secondary station'}
                  asChild
                >
                  {/* ds-raw-button: segmented secondary-station toggle pill (primary/selected/unselected fills), not a single DS variant */}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (!stations.primary || isPrimary) return;
                      const has = stations.secondary.includes(st);
                      onSave({
                        primary: stations.primary,
                        secondary: has
                          ? stations.secondary.filter((s) => s !== st)
                          : [...stations.secondary, st],
                      });
                    }}
                    className={
                      isPrimary
                        ? 'inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-caption font-semibold text-blue-600 ring-1 ring-inset ring-blue-200'
                        : selected
                          ? 'inline-flex items-center gap-1 rounded-full bg-surface-inverse px-2.5 py-1 text-caption font-semibold text-white ring-1 ring-inset ring-surface-inverse transition disabled:opacity-50'
                          : 'inline-flex items-center gap-1 rounded-full bg-surface-card px-2.5 py-1 text-caption font-semibold text-text-muted ring-1 ring-inset ring-border-soft transition hover:bg-surface-hover disabled:opacity-50'
                    }
                  >
                    {STATION_LABELS[st]}
                    {isPrimary && <span className="text-eyebrow font-bold uppercase tracking-wider opacity-70">primary</span>}
                  </button>
                </HoverTooltip>
              );
            })}
          </div>
        </div>
      </div>
      <div className="border-t border-border-hairline bg-surface-canvas/60 px-5 py-2 text-micro text-text-muted">
        {stations.primary
          ? <>Chip shows <b>{STATION_LABELS[stations.primary]}</b>{stations.secondary.length > 0 ? ` · Switch between ${stations.secondary.length + 1} stations` : ' · no switch (single station)'}</>
          : <>No assignment — chip falls back to the station derived from the employee code.</>}
        {' · '}
        <span className="text-text-soft">Set the daily target per station in <a href="/admin?section=goals" className="text-blue-600 hover:underline">Goals</a>.</span>
      </div>
    </section>
  );
}
