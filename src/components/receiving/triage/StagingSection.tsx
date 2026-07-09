'use client';

/**
 * StagingSection — shelf assignment for triage (reuses the `locations` catalog).
 * Priority lane is auto-routed on save via `resolveTriageLane` — no operator picker.
 */

import { WorkspaceCard } from '@/design-system/components';
import { Loader2, MapPin } from '@/components/Icons';
import { SELECT_CLASS } from '@/components/sidebar/receiving/receiving-sidebar-shared';
import type { TriageStagingController } from './useTriageStaging';

export function StagingSection({ staging }: { staging: TriageStagingController }) {
  const {
    locations,
    locationsLoading,
    stagingLocationId,
    selectShelf,
    savingLocation,
  } = staging;

  const savingIndicator = savingLocation ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin text-text-faint" />
  ) : null;

  return (
    <WorkspaceCard label="Staging" variant="glass" overflow="visible" actions={savingIndicator ?? undefined}>
      <div className="space-y-1">
        <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">Shelf</p>
        <div className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-text-faint" />
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
    </WorkspaceCard>
  );
}
