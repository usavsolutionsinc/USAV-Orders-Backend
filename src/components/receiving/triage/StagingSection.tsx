'use client';

/**
 * StagingSection — the Stage step's card (§4, A1/A2/A3): physical shelf
 * assignment (reuses the existing `locations` catalog — G7, no parallel
 * table) + priority lane (auto-suggested via the Studio-pluggable decision
 * policy, manual override always wins — §4.2/D3).
 *
 * Shelf uses a plain `<select>` (locations is a bounded, well-known catalog;
 * no need for a search field yet). Lane is a small pill row, mirroring
 * `UnmatchedItemsSection`'s `IntakeClassifyRow` — `motion.button` (not a raw
 * `<button>`) keeps it off the raw-button ratchet.
 */

import { motion } from 'framer-motion';
import { WorkspaceCard } from '@/design-system/components';
import { Loader2, MapPin } from '@/components/Icons';
import { SELECT_CLASS } from '@/components/sidebar/receiving/receiving-sidebar-shared';
import { TRIAGE_LANE_OPTS, triageLaneLabel, type TriageLane } from '@/lib/receiving/triage-lane-policy';
import type { TriageStagingController } from './useTriageStaging';

const LANE_PILL_BASE =
  'shrink-0 rounded-full border px-2.5 py-1 text-eyebrow font-black uppercase tracking-widest transition-colors';
const LANE_ACTIVE = 'border-blue-500 bg-blue-600 text-white';
const LANE_INACTIVE = 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50';

export function StagingSection({ staging }: { staging: TriageStagingController }) {
  const {
    locations,
    locationsLoading,
    stagingLocationId,
    priorityLane,
    suggestedLane,
    selectShelf,
    selectLane,
    savingLocation,
    savingLane,
  } = staging;

  const effectiveLane = priorityLane ?? suggestedLane;

  return (
    <WorkspaceCard
      label="Staging"
      actions={
        savingLocation || savingLane ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
        ) : undefined
      }
    >
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-eyebrow font-black uppercase tracking-widest text-gray-500">Shelf</p>
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            <select
              className={SELECT_CLASS}
              value={stagingLocationId ?? ''}
              disabled={locationsLoading}
              onChange={(e) => {
                const v = e.target.value;
                void selectShelf(v ? Number(v) : null);
              }}
            >
              <option value="">{locationsLoading ? 'Loading…' : 'Select a shelf…'}</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.room ? `${loc.room} · ${loc.name}` : loc.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-eyebrow font-black uppercase tracking-widest text-gray-500">
            Priority lane
            {!priorityLane && suggestedLane ? (
              <span className="ml-1.5 font-semibold normal-case tracking-normal text-gray-400">
                (auto: {triageLaneLabel(suggestedLane)})
              </span>
            ) : null}
          </p>
          <div
            role="radiogroup"
            aria-label="Priority lane"
            className="flex flex-nowrap items-center gap-1.5 overflow-x-auto scrollbar-hide"
          >
            {TRIAGE_LANE_OPTS.map((o) => {
              const active = o.value === effectiveLane;
              return (
                <motion.button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  title={o.label}
                  onClick={() => void selectLane(o.value as TriageLane)}
                  className={`${LANE_PILL_BASE} ${active ? LANE_ACTIVE : LANE_INACTIVE}`}
                >
                  {o.label}
                </motion.button>
              );
            })}
          </div>
        </div>
      </div>
    </WorkspaceCard>
  );
}
