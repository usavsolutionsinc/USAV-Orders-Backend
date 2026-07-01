'use client';

/**
 * Triage-mode sidebar body: a Triage / Prioritize / Unfound toggle over three
 * lists.
 *   • Triage    → the combined working feed, newest-scanned first (default).
 *                 Prioritize ∪ Unfound in ONE list (TriageCombinedList).
 *   • Prioritize → the priority-sorted door rail, matched only (TriageRecentRail).
 *   • Unfound   → cartons Zoho can't match yet (TriageUnfoundList).
 *
 * Prioritize and Unfound are filtered SUBSETS of Triage: linking a PO moves a
 * carton between those two subsets, but on the Triage tab it stays in the list
 * (just re-sorted), so the operator never loses what they just scanned in.
 *
 * The toggle is pinned above the scroll body in {@link ReceivingSidebarPanel}
 * via {@link TriageViewToggle}. This component owns only which list renders.
 */

import { useSearchParams } from 'next/navigation';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { isPendingTriageScanRow } from '@/components/sidebar/receiving/receiving-sidebar-shared';
import { TriageCombinedList } from './TriageCombinedList';
import { TriageRecentRail } from './TriageRecentRail';
import { TriageUnfoundList } from './TriageUnfoundList';
import { TriageDoneList } from './TriageDoneList';

export type TriageView = 'triage' | 'found' | 'unfound' | 'done';

export function resolveTriageView(raw: string | null | undefined): TriageView {
  if (raw === 'found') return 'found';
  if (raw === 'unfound') return 'unfound';
  if (raw === 'done') return 'done';
  return 'triage';
}

export function TriageSidebarBody({
  selectedLineId,
  selectedRow,
  leadingRow = null,
  filterText = '',
}: {
  selectedLineId: number | null;
  selectedRow: ReceivingLineRow | null;
  /** Pre-resolve scan stub (tracking # title) pinned at the top of the Triage tab. */
  leadingRow?: ReceivingLineRow | null;
  /** Desktop search text from the sidebar SearchBar (filters both lists). */
  filterText?: string;
}) {
  const searchParams = useSearchParams();
  const view = resolveTriageView(searchParams.get('triview'));

  return view === 'triage' ? (
    <TriageCombinedList
      key="rail-triage-combined"
      selectedLineId={selectedLineId}
      selectedRow={selectedRow}
      leadingRow={leadingRow}
      isRowDisabled={isPendingTriageScanRow}
      filterText={filterText}
    />
  ) : view === 'unfound' ? (
    <TriageUnfoundList key="rail-triage-unfound" selectedLineId={selectedLineId} filterText={filterText} />
  ) : view === 'done' ? (
    <TriageDoneList key="rail-triage-done" selectedLineId={selectedLineId} filterText={filterText} />
  ) : (
    <TriageRecentRail
      key="rail-triage-prioritize"
      selectedLineId={selectedLineId}
      selectedRow={selectedRow}
      filterText={filterText}
    />
  );
}

export default TriageSidebarBody;
