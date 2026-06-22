'use client';

import { useMemo } from 'react';
import { cn } from '@/utils/_cn';
import { FbaFnskuScanToast } from '@/components/fba/sidebar/FbaFnskuScanToast';
import { SearchBar } from '@/components/ui/SearchBar';
import {
  receivingScanBandClass,
  sidebarHeaderBandClass,
  sidebarHeaderPillRowClass,
  SIDEBAR_GUTTER,
} from '@/components/layout/header-shell';
import { FBA_SCAN_BAND_HALO } from '@/components/fba/StationFbaInput';
import { SidebarSection } from '@/components/layout/SidebarSection';
import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import { FbaWorkspaceScanField } from '@/components/fba/sidebar/FbaWorkspaceScanField';
import { useMasterNavEnabled } from '@/components/sidebar/master-nav';
import { FbaShippedTable } from '@/components/fba/FbaShippedTable';
import {
  FbaCombineRailBody,
  FbaCombineRailPills,
  FbaPlanRailBody,
  FbaPlanRailPills,
} from '@/components/fba/sidebar/FbaSidebarRails';
import { FBA_MODE_ITEMS, type FbaMode } from '@/lib/fba/fba-modes';
import { sidebarSubBandClass } from '@/components/fba/sidebar/fba-sidebar-shared';
import {
  useFbaPlanData,
  useFbaRailViews,
  useFbaStationIdentity,
  useFbaWorkspaceBridges,
  useFbaWorkspaceUrlState,
} from '@/components/fba/sidebar/fba-workspace-hooks';

/** Suspense fallback for the /fba workspace sidebar. */
export function FbaWorkspaceSidebarFallback() {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-white">
      <div className={sidebarHeaderBandClass}>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-gray-200">
          <div className="h-11 bg-zinc-50 animate-pulse" />
          <div className="h-11 bg-zinc-50 animate-pulse" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className={`${sidebarSubBandClass} ${SIDEBAR_GUTTER} py-2.5`}>
          <div className="h-24 w-full rounded-2xl bg-zinc-100 animate-pulse" />
        </div>
        <div className={`min-h-0 flex-1 space-y-3 ${SIDEBAR_GUTTER} py-3 overflow-y-auto bg-white`}>
          <div className="h-4 w-32 bg-zinc-100 rounded animate-pulse" />
          <div className="space-y-2">
            <div className="h-16 w-full rounded-xl bg-zinc-50 border border-zinc-100 animate-pulse" />
            <div className="h-16 w-full rounded-xl bg-zinc-50 border border-zinc-100 animate-pulse" />
            <div className="h-16 w-full rounded-xl bg-zinc-50 border border-zinc-100 animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The /fba workspace sidebar: mode pills, the pinned FNSKU scan bar, the
 * plan / combine rails, and the shipped search + table. State and side effects
 * live in {@link fba-workspace-hooks}; this component is composition + layout.
 */
export function FbaWorkspaceSidebar() {
  const masterNavEnabled = useMasterNavEnabled();
  const { activeMode, refreshToken, localSearch, setLocalSearch, updateFbaParams } = useFbaWorkspaceUrlState();
  const { orgId, staffId, staffName, stationTheme } = useFbaStationIdentity();
  const { pendingPlans, plansError, modeCounts } = useFbaPlanData({ activeMode, refreshToken, orgId });
  const { planRailView, setPlanRailView, combineRailView, setCombineRailView } = useFbaRailViews();
  const { editorActive } = useFbaWorkspaceBridges(activeMode);

  const isBoard = activeMode === 'combine' || activeMode === 'plan';
  // Combine-only panels (selection + tracking pairing + active shipments) are
  // hidden in plan mode, which is just scan-to-add + the recent rail.
  const isCombine = activeMode === 'combine';

  // Mode pills with live stage-count badges: Plan = PLANNED, Combine = PACKED.
  const modeItems = useMemo(
    () =>
      FBA_MODE_ITEMS.map((it) =>
        it.id === 'plan'
          ? { ...it, count: modeCounts.PLANNED || 0 }
          : it.id === 'combine'
            ? { ...it, count: modeCounts.PACKED || 0 }
            : it,
      ),
    [modeCounts],
  );

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-white">
      {!masterNavEnabled && (
        <div className={sidebarHeaderPillRowClass}>
          <HorizontalButtonSlider
            items={modeItems}
            value={activeMode}
            onChange={(next) => updateFbaParams({ mode: next as FbaMode })}
            variant="nav"
            dense
            className="w-full"
            aria-label="FBA mode"
          />
        </div>
      )}

      {/* Scan bar — pinned at the top of the working area so it never scrolls
          away. The mode is locked per page: Plan on the plan page (FNSKU adds to
          today's plan, Plan button only) and Select on combine (FNSKU selects
          packed items, Select button only). */}
      {isBoard && !editorActive && (
        <div
          className={cn(
            receivingScanBandClass,
            FBA_SCAN_BAND_HALO[stationTheme],
            SIDEBAR_GUTTER,
            'py-1',
          )}
        >
          <FbaWorkspaceScanField
            staffName={staffName}
            staffId={staffId}
            showTrackingCard={false}
            scanMode={activeMode === 'plan' ? 'plan' : 'select'}
            sidebarHeaderBand
          />
        </div>
      )}

      {activeMode === 'plan' && !editorActive ? (
        <div className={sidebarHeaderPillRowClass}>
          <FbaPlanRailPills view={planRailView} onViewChange={setPlanRailView} />
        </div>
      ) : null}

      {isCombine ? (
        <div className={sidebarHeaderPillRowClass}>
          <FbaCombineRailPills view={combineRailView} onViewChange={setCombineRailView} />
        </div>
      ) : null}

      {/* Single scroll container */}
      <div
        data-testid="fba-sidebar-scroll"
        className="min-h-0 flex-1 overflow-y-auto scrollbar-hide bg-white"
        style={{ ['--fba-sticky-top' as any]: '38px' }}
      >
        {activeMode === 'plan' && !editorActive ? <FbaPlanRailBody view={planRailView} /> : null}

        {isCombine ? <FbaCombineRailBody view={combineRailView} stationTheme={stationTheme} /> : null}

        {/* Shipped: search filter */}
        {activeMode === 'shipped' && (
          <div className={`${sidebarSubBandClass} ${SIDEBAR_GUTTER} py-2.5`}>
            <SearchBar
              value={localSearch}
              onChange={setLocalSearch}
              onClear={() => setLocalSearch('')}
              placeholder="FNSKU, ASIN, SKU, product…"
              variant="blue"
              className="w-full"
            />
          </div>
        )}

        {/* Combine review + tracking pairing + active shipments now live in the
            center-right combine workspace on /fba?mode=combine (see fba/page.tsx).
            The sidebar keeps just the scan bar + Recent/Packed rails. */}

        {activeMode === 'shipped' ? (
          <FbaShippedTable
            stationTheme={stationTheme}
            searchQuery={localSearch}
            embedded
          />
        ) : null}

        {/* Station FNSKU scan toast — hidden when editor is active */}
        {isBoard && !editorActive && (
          <FbaFnskuScanToast pendingPlans={pendingPlans} stationTheme={stationTheme} />
        )}

        {/* Plans error banner */}
        {plansError && (
          <SidebarSection className="my-2">
            <div className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-caption font-semibold text-red-700">
              {plansError}
            </div>
          </SidebarSection>
        )}
      </div>
    </div>
  );
}
