'use client';

/**
 * SurfaceRenderer — mounts a surface's published `station_definitions`
 * composition on a real page (Studio-driven operator-surfaces refactor,
 * Phase 3b). It lays out the archetype scaffold and drops a `StationSlot` for
 * each region; `StationSlot` reads the active config for (pageKey, modeKey, slot)
 * and renders the composed blocks (or nothing, when a slot is empty).
 *
 * This is the production render host the plan called for — the same
 * StationSlot/BlockRenderer runtime the Studio node-editor preview uses, now on
 * a live surface. It only renders when `SurfaceGate` resolves `render:'composed'`
 * (active composition + per-org flag); otherwise the legacy tree renders.
 */

import { getSurface, type SurfaceKey } from '@/lib/stations/surface-keys';
import { StationSlot } from '@/components/stations/StationSlot';

export function SurfaceRenderer({ surfaceKey }: { surfaceKey: SurfaceKey }) {
  const surface = getSurface(surfaceKey);
  const slotProps = { pageKey: surface.pageKey, modeKey: surface.modeKey, stationLabel: surface.label };

  // Station archetype scaffold: focus-locked trigger pinned on top, then a
  // master queue + a workspace body, advance action bar at the foot. Linear
  // vertical scaffold, no grids (ui-design-system.md).
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface-canvas">
      <div className="shrink-0 border-b border-border-hairline bg-surface-card p-2">
        <StationSlot {...slotProps} slot="trigger" />
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="w-80 shrink-0 overflow-y-auto border-r border-border-hairline bg-surface-card">
          <StationSlot {...slotProps} slot="queue" />
        </aside>
        <div className="min-w-0 flex-1 overflow-y-auto p-2">
          <StationSlot {...slotProps} slot="workspace" />
        </div>
      </div>
      <div className="shrink-0 border-t border-border-hairline bg-surface-card p-2">
        <StationSlot {...slotProps} slot="advance" />
      </div>
    </div>
  );
}
