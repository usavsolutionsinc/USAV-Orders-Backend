'use client';

import { useCallback, useRef, useState } from 'react';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { ShippingScanBand } from '@/components/sidebar/tech/ShippingScanBand';
import { ShippingRecentRail } from '@/components/sidebar/shipping/ShippingRecentRail';
import { TechRailSearchBar } from '@/components/sidebar/tech/TechRailSearchBar';
import { useIsMobile } from '@/hooks';

interface Props {
  techId: string;
  techName: string;
  /** Staff id used to theme the scan bar's input border. */
  staffId?: string;
  onComplete?: () => void;
}

/**
 * Tech sidebar for Shipping mode — order / FNSKU scan band plus the Up Next
 * order queue rail. Shares the same shell anatomy as {@link TestingSidebarPanel}
 * (scan band, scrollable rail, bottom filter) but uses shipping-specific rails
 * and scan behavior instead of receiving-line testing feeds.
 */
export function ShippingSidebarPanel({
  techId,
  techName,
  staffId,
  onComplete,
}: Props) {
  const isMobile = useIsMobile();
  const [railFilter, setRailFilter] = useState('');
  const startOrderRef = useRef<(tracking: string) => void>(() => {});

  const handleStartReady = useCallback((start: (tracking: string) => void) => {
    startOrderRef.current = start;
  }, []);

  const handleMissingParts = useCallback(() => {
    window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    onComplete?.();
  }, [onComplete]);

  const scanBandProps = {
    userId: techId,
    userName: techName,
    staffId: staffId ?? techId,
    onComplete,
    onStartHandlerReady: handleStartReady,
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-surface-card">
      {!isMobile ? <ShippingScanBand {...scanBandProps} /> : null}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ShippingRecentRail
          techId={techId}
          filterText={railFilter}
          onStart={(tracking) => startOrderRef.current(tracking)}
          onMissingParts={handleMissingParts}
          onAllCompleted={onComplete}
        />
      </div>

      <TechRailSearchBar
        value={railFilter}
        onChange={setRailFilter}
        placeholder="Filter orders…"
      />

      {isMobile ? (
        <div className={`flex-shrink-0 border-t border-border-hairline bg-surface-card ${SIDEBAR_GUTTER} pb-[max(1.125rem,env(safe-area-inset-bottom))] pt-3`}>
          <ShippingScanBand {...scanBandProps} scanOnly />
        </div>
      ) : null}
    </div>
  );
}
