'use client';

import type { ReactNode } from 'react';
import { ChevronLeft } from '@/components/Icons';
import StaffSelector from '@/components/StaffSelector';
import { sidebarHeaderBandClass } from '@/components/layout/header-shell';

export interface MobilePageHeaderProps {
  /** Contextual back (e.g. drawer, previous pane, close detail) — same role as tech/packer top band. */
  onBack: () => void;
  backAriaLabel?: string;
  staffRole: 'packer' | 'technician';
  selectedStaffId: number;
  onStaffSelect: (staffId: number, staffName: string) => void;
  /** Right cell: forward chevron, view switcher, or spacer. */
  trailing?: ReactNode;
  className?: string;
}

/**
 * Shared mobile top band: boxed back · staff selector · trailing slot.
 * Matches the grid used by `/tech` and `/packer` station flows.
 */
export function MobilePageHeader({
  onBack,
  backAriaLabel = 'Back',
  staffRole,
  selectedStaffId,
  onStaffSelect,
  trailing,
  className = '',
}: MobilePageHeaderProps) {
  const headerBandClass = `${sidebarHeaderBandClass} pt-[env(safe-area-inset-top)]`;

  return (
    <div className={`${headerBandClass} ${className}`.trim()}>
      <div className="grid w-full min-h-[44px] grid-cols-[40px_minmax(0,1fr)_40px] items-stretch divide-x divide-gray-400">
        <div className="flex min-h-[44px] items-stretch bg-white">
          <button
            type="button"
            onClick={onBack}
            aria-label={backAriaLabel}
            className="flex h-full w-full items-center justify-center rounded-none bg-white text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        </div>
        <div className="min-w-0 bg-white">
          <StaffSelector
            role={staffRole}
            variant="boxy"
            selectedStaffId={selectedStaffId}
            onSelect={onStaffSelect}
          />
        </div>
        <div className="flex min-h-[44px] items-stretch justify-stretch bg-white">
          {trailing ?? <span className="block w-full" aria-hidden />}
        </div>
      </div>
    </div>
  );
}
