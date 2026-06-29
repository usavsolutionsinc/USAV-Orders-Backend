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
 * The toggle lives in the URL (`?triview=`) per the sidebar-mode contract, so a
 * deep-link / refresh preserves it. Default (param absent) is Triage — the
 * combined list. Both lists drive the right pane via the shared
 * `receiving-select-line` event, so this component owns only the toggle + which
 * list renders.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { AlertTriangle, Flag, Layers } from '@/components/Icons';
import {
  HorizontalButtonSlider,
  type HorizontalSliderItem,
} from '@/components/ui/HorizontalButtonSlider';
import { sidebarNavOverlayBandClass } from '@/components/layout/header-shell';
import { TriageCombinedList } from './TriageCombinedList';
import { TriageRecentRail } from './TriageRecentRail';
import { TriageUnfoundList } from './TriageUnfoundList';
import { ReceivingScannedRailDb } from './_db-spike/ReceivingScannedRailDb';

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = resolveTriageView(searchParams.get('triview'));
  // Opt-in TanStack DB spike rail (?railEngine=db). Off by default → the live
  // sidebar is unchanged; add the param to evaluate the live-query rail.
  const dbSpike = searchParams.get('railEngine') === 'db';

  const setView = (next: TriageView) => {
    if (next === view) return;
    // Different sub-list = different query; don't carry the prior selection.
    // Clearing lets the new sub-list's rail auto-select its own top.
    window.dispatchEvent(new CustomEvent('receiving-clear-line'));
    const params = new URLSearchParams(searchParams.toString());
    // Triage is the default → drops out of the URL; the subset tabs are explicit.
    if (next === 'triage') params.delete('triview');
    else params.set('triview', next);
    router.replace(`/receiving?${params.toString()}`);
  };

  // Shared slider (variant="nav" — filled-active nav pills with icons, matching
  // the inventory ledger tabs). Order: Triage (combined, default) · Prioritize
  // (priority-sorted matched) · Unfound (unmatched). URL value stays
  // `triview=found` for Prioritize (the priority-sorted work view).
  const TABS: HorizontalSliderItem[] = [
    { id: 'triage', label: 'Triage', icon: Layers },
    { id: 'found', label: 'Prioritize', icon: Flag },
    { id: 'unfound', label: 'Unfound', icon: AlertTriangle },
  ];

  return (
    <div className="flex flex-col">
      <div className={sidebarNavOverlayBandClass}>
        <HorizontalButtonSlider
          className="w-full"
          items={TABS}
          value={view}
          onChange={(id) => setView(id as TriageView)}
          variant="nav"
          dense
          overlay
          aria-label="Triage view"
        />
      </div>
      {dbSpike ? (
        <ReceivingScannedRailDb
          key="rail-triage-db-spike"
          selectedLineId={selectedLineId}
          filterText={filterText}
        />
      ) : view === 'triage' ? (
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
      )}
    </div>
  );
}

export default TriageSidebarBody;
