'use client';

import { ChevronLeft, ChevronRight } from '@/components/Icons';
import StaffSelector from '@/components/StaffSelector';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
import { sidebarHeaderBandClass, sidebarHeaderControlClass } from '@/components/layout/header-shell';

/**
 * Mobile tech view switcher — Testing Station is not listed; reach station via hub/arrow, or History ← back.
 */
export const MOBILE_TECH_VIEW_SWITCHER_OPTIONS = [
  { value: 'history', label: 'Tech History' },
  { value: 'shipped', label: 'Shipped Orders' },
  { value: 'pending', label: 'Pending Orders' },
  { value: 'manual', label: 'Last Order Manual' },
  { value: 'update-manuals', label: 'Update Manuals' },
] as const;

export type MobileTechWorkspaceMode =
  | (typeof MOBILE_TECH_VIEW_SWITCHER_OPTIONS)[number]['value']
  | 'station';
export type MobileTechViewMode = 'hub' | MobileTechWorkspaceMode;

export interface MobileTechTopBannerProps {
  variant: 'hub' | 'workspace';
  selectedStaffId: number;
  onStaffSelect: (id: number) => void;
  /** Opens the same mobile nav drawer as the dashboard hamburger. */
  onOpenAppNav: () => void;
  /** Hub only — advances into Tech History workspace. */
  onOpenWorkspaceFromHub?: () => void;
  /** Testing Station only — opens Tech History (full header with staff + view switcher). */
  onStationOpenTechHistory?: () => void;
  /** Workspace only */
  workspaceViewMode?: MobileTechWorkspaceMode;
  onWorkspaceViewChange?: (next: MobileTechWorkspaceMode) => void;
}

/**
 * Contextual top band for mobile `/tech`.
 * - Hub: back · staff · forward into workspace.
 * - Testing Station: back · staff · forward → Tech History (same default as hub arrow).
 * - Other views: back · staff · view switcher (no goal in header — use content areas for counts).
 */
export function MobileTechTopBanner({
  variant,
  selectedStaffId,
  onStaffSelect,
  onOpenAppNav,
  onOpenWorkspaceFromHub,
  onStationOpenTechHistory,
  workspaceViewMode,
  onWorkspaceViewChange,
}: MobileTechTopBannerProps) {
  const headerBandClass = `${sidebarHeaderBandClass} pt-[env(safe-area-inset-top)]`;

  if (variant === 'hub') {
    return (
      <div className={headerBandClass}>
        <div className="grid w-full min-h-[44px] grid-cols-[40px_minmax(0,1fr)_40px] items-stretch divide-x divide-gray-400">
          <div className="flex min-h-[44px] items-stretch bg-white">
            <button
              type="button"
              onClick={onOpenAppNav}
              aria-label="Open app navigation"
              className="flex h-full w-full items-center justify-center rounded-none bg-white text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          </div>
          <div className="min-w-0 bg-white">
            <StaffSelector
              role="technician"
              variant="boxy"
              selectedStaffId={selectedStaffId}
              onSelect={onStaffSelect}
            />
          </div>
          <div className="flex min-h-[44px] items-stretch bg-white">
            <button
              type="button"
              onClick={onOpenWorkspaceFromHub}
              aria-label="Open tech workspace"
              className="flex h-full w-full items-center justify-center rounded-none bg-white text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const mode = workspaceViewMode ?? 'history';

  const backCell = (
    <div className="flex min-h-[44px] items-stretch bg-white">
      <button
        type="button"
        onClick={onOpenAppNav}
        aria-label="Open app navigation"
        className="flex h-full w-full items-center justify-center rounded-none bg-white text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
    </div>
  );

  const staffCell = (
    <div className="min-w-0 bg-white">
      <StaffSelector
        role="technician"
        variant="boxy"
        selectedStaffId={selectedStaffId}
        onSelect={onStaffSelect}
      />
    </div>
  );

  /** Testing Station: forward opens Tech History with staff + view switcher. */
  if (mode === 'station') {
    return (
      <div className={headerBandClass}>
        <div className="grid w-full min-h-[44px] grid-cols-[40px_minmax(0,1fr)_40px] items-stretch divide-x divide-gray-400">
          {backCell}
          {staffCell}
          <div className="flex min-h-[44px] items-stretch bg-white">
            <button
              type="button"
              onClick={() => onStationOpenTechHistory?.()}
              aria-label="Open Tech History"
              className="flex h-full w-full items-center justify-center rounded-none bg-white text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={headerBandClass}>
      <div className="grid w-full min-h-[44px] grid-cols-[40px_minmax(0,1fr)_minmax(0,1fr)] items-stretch divide-x divide-gray-400">
        {backCell}
        {staffCell}
        <div className="relative min-w-0 bg-white">
          <ViewDropdown
            options={MOBILE_TECH_VIEW_SWITCHER_OPTIONS}
            value={mode}
            onChange={(next) => onWorkspaceViewChange?.(next as MobileTechWorkspaceMode)}
            variant="boxy"
            buttonClassName={`${sidebarHeaderControlClass} !px-2 !py-0.5 !pr-7`}
            optionClassName="text-[10px] font-black tracking-wider"
          />
        </div>
      </div>
    </div>
  );
}
