'use client';

/**
 * Rail selector for the receiving sidebar's scrollable body. Picks the right
 * rail for the active mode + Unbox sub-view:
 *   - history → none (the right-pane table is filtered via URL params instead)
 *   - triage  → Found/Unfound triage body (scan input doubles as filter)
 *   - unbox   → Recent / Queue (priority-sorted) / Viewed (per-staff recents)
 *
 * Incoming has its own dedicated sidebar (IncomingSidebarPanel) handled upstream.
 * Extracted from ReceivingSidebarPanel.
 */

import { TriageSidebarBody } from '@/components/sidebar/receiving/TriageSidebarBody';
import { ReceivingRecentRail } from '@/components/sidebar/receiving/ReceivingRecentRail';
import { ReceivingViewedRail } from '@/components/sidebar/receiving/ReceivingViewedRail';
import { ReceivingScannedRail } from '@/components/sidebar/receiving/ReceivingScannedRail';
import type { ReceivingMode } from '@/components/sidebar/receiving/receiving-sidebar-shared';
import type { UnboxView } from '@/components/sidebar/receiving/useReceivingMode';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

interface ReceivingRailBodyProps {
  mode: ReceivingMode;
  unboxView: UnboxView;
  selectedLine: ReceivingLineRow | null;
  /** Live filter text for the triage Found/Unfound lists. */
  triageFilterText: string;
}

export function ReceivingRailBody({
  mode,
  unboxView,
  selectedLine,
  triageFilterText,
}: ReceivingRailBodyProps) {
  // Keep the (possibly negative) id so each rail's auto-select stays suppressed
  // while a line/carton is open — but never hand a rail the synthetic
  // unmatched-carton stub (negative id) as a pinnable row.
  const selectedLineId = selectedLine?.id ?? null;
  const selectedRow = selectedLine && selectedLine.id > 0 ? selectedLine : null;

  if (mode === 'history') return null;

  if (mode === 'triage') {
    return (
      <TriageSidebarBody
        selectedLineId={selectedLineId}
        selectedRow={selectedRow}
        filterText={triageFilterText}
      />
    );
  }

  if (unboxView === 'queue') {
    // The same priority-sorted Scanned rail the triage Prioritize tab uses
    // (unfound/untagged first, then amazon → ebay → goodwill).
    return (
      <ReceivingScannedRail
        key="rail-unbox-queue"
        scope="unbox"
        selectedLineId={selectedLineId}
        selectedRow={selectedRow}
      />
    );
  }

  if (unboxView === 'viewed') {
    // The lines THIS operator recently opened (server-backed per-staff recents).
    return (
      <ReceivingViewedRail
        key="rail-unbox-viewed"
        selectedLineId={selectedLineId}
        selectedRow={selectedRow}
      />
    );
  }

  return (
    <ReceivingRecentRail
      key="rail-unbox-recent"
      selectedLineId={selectedLineId}
      selectedRow={selectedRow}
    />
  );
}
