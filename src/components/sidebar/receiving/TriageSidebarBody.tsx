'use client';

/**
 * Triage-mode sidebar body: a Found / Unfound toggle over two lists.
 *   • Found   → the recent received-carton rail (ReceivingRecentRail)
 *   • Unfound → cartons Zoho can't match yet (TriageUnfoundList)
 *
 * The toggle lives in the URL (`?triview=`) per the sidebar-mode contract, so a
 * deep-link / refresh preserves it. Default is Unfound — the actionable triage
 * list. Both lists drive the right pane via the shared `receiving-select-line`
 * event, so this component owns only the toggle + which list renders.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import {
  HorizontalButtonSlider,
  type HorizontalSliderItem,
} from '@/components/ui/HorizontalButtonSlider';
import { ReceivingScannedRail } from './ReceivingScannedRail';
import { TriageUnfoundList } from './TriageUnfoundList';

export type TriageView = 'found' | 'unfound';

export function resolveTriageView(raw: string | null | undefined): TriageView {
  return raw === 'found' ? 'found' : 'unfound';
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = resolveTriageView(searchParams.get('triview'));

  const setView = (next: TriageView) => {
    if (next === view) return;
    // Different sub-list = different query; don't carry the prior selection.
    // Clearing lets the new sub-list's rail auto-select its own top.
    window.dispatchEvent(new CustomEvent('receiving-clear-line'));
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'unfound') params.delete('triview');
    else params.set('triview', next);
    router.replace(`/receiving?${params.toString()}`);
  };

  // Shared slider (variant="fba" — the per-item colored tone). URL value stays
  // `triview=found`; the operator-facing label reads "Prioritize" since that
  // rail is the priority-sorted work view.
  const TABS: HorizontalSliderItem[] = [
    { id: 'unfound', label: 'Unfound', tone: 'orange' },
    { id: 'found', label: 'Prioritize', tone: 'emerald' },
  ];

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 bg-white/90 px-3 pb-2 pt-1 backdrop-blur">
        <HorizontalButtonSlider
          items={TABS}
          value={view}
          onChange={(id) => setView(id as TriageView)}
          variant="fba"
          aria-label="Triage view"
        />
      </div>
      {view === 'unfound' ? (
        <TriageUnfoundList selectedLineId={selectedLineId} filterText={filterText} />
      ) : (
        <ReceivingScannedRail
          selectedLineId={selectedLineId}
          selectedRow={selectedRow}
          filterText={filterText}
        />
      )}
    </div>
  );
}

export default TriageSidebarBody;
