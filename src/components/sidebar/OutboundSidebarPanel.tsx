'use client';

import { LabelsModeBody } from '@/components/outbound/labels/LabelsModeBody';
import { ScanOutModeBody } from '@/components/outbound/scan-out/ScanOutModeBody';
import {
  OUTBOUND_MODE_ITEMS,
  type OutboundMode,
} from '@/components/outbound/outbound-sidebar-shared';
import { useOutboundUrlState } from '@/hooks/useOutboundUrlState';
import { sidebarHeaderPillRowClass } from '@/components/layout/header-shell';
import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import { useMasterNavEnabled } from '@/components/sidebar/master-nav';

export function OutboundSidebarPanel() {
  const { mode, updateMode } = useOutboundUrlState();
  const masterNavEnabled = useMasterNavEnabled();

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface-card">
      {!masterNavEnabled && (
        <div className={sidebarHeaderPillRowClass}>
          <HorizontalButtonSlider
            items={OUTBOUND_MODE_ITEMS}
            value={mode}
            onChange={(id) => updateMode(id as OutboundMode)}
            variant="nav"
            dense
            className="w-full"
            aria-label="Outbound mode"
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === 'scan-out' ? <ScanOutModeBody /> : <LabelsModeBody />}
      </div>
    </div>
  );
}
