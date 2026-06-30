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
import { TriageCombinedList } from './TriageCombinedList';
import { TriageRecentRail } from './TriageRecentRail';
import { TriageUnfoundList } from './TriageUnfoundList';

export type TriageView = 'triage' | 'found' | 'unfound';

export function resolveTriageView(raw: string | null | undefined): TriageView {
  if (raw === 'found') return 'found';
  if (raw === 'unfound') return 'unfound';
  return 'triage';
}

export function TriageSidebarBody({
  selectedLineId,
  selectedRow,
  filterText = '',
}: {
  selectedLineId: number | null;
  selectedRow: ReceivingLineRow | null;
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
      filterText={filterText}
    />
  ) : view === 'unfound' ? (
    <TriageUnfoundList key="rail-triage-unfound" selectedLineId={selectedLineId} filterText={filterText} />
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
