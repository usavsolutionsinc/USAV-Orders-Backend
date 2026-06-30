'use client';

/**
 * Rail selector for the receiving sidebar's scrollable body. Picks the right
 * feed for the active mode + Unbox sub-view:
 *   - history → none (the right-pane table is filtered via URL params instead)
 *   - triage  → Triage/Prioritize/Unfound body
 *   - unbox   → Unboxed (unboxRecent) / Queue (scanned) / Viewed (per-staff)
 *
 * Unbox rails paint scan results via a single cache upsert on resolve (no
 * tracking# importing stub). Triage keeps the importing-row reconcile path.
 */

import { TriageSidebarBody } from '@/components/sidebar/receiving/TriageSidebarBody';
import { ReceivingFeedRail } from '@/components/sidebar/receiving/ReceivingFeedRail';
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
  const selectedLineId = selectedLine?.id ?? null;
  // Unfound cartons are lineless stubs (negative id) but still open a workspace
  // keyed on receiving_id — pass them through so the rail highlight + pin stay
  // in sync with the right pane.
  const selectedRow =
    selectedLine && (selectedLine.id > 0 || selectedLine.receiving_id != null)
      ? selectedLine
      : null;

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
    return (
      <ReceivingFeedRail
        key="rail-unbox-queue"
        feed="unboxQueue"
        scope="unbox"
        selectedLineId={selectedLineId}
        selectedRow={selectedRow}
      />
    );
  }

  if (unboxView === 'viewed') {
    return (
      <ReceivingFeedRail
        key="rail-unbox-viewed"
        feed="viewed"
        selectedLineId={selectedLineId}
        selectedRow={selectedRow}
      />
    );
  }

  return (
    <ReceivingFeedRail
      key="rail-unbox-recent"
      feed="unboxRecent"
      selectedLineId={selectedLineId}
      selectedRow={selectedRow}
    />
  );
}
