'use client';

/**
 * POUnboxingSection — the unified Unboxing / Package-Pairing wrapper.
 *
 * Unbox mode (`poItems`) composes PO Items and Units-on-carton behind a
 * {@link HorizontalButtonSlider} tab row (same nav pills as
 * {@link LineNotesTabbedCard}), then Package Pairing below. Triage keeps the
 * flat PO-items eyebrow + pairing stack when a linked PO is shown read-only.
 *
 * Layout (unbox, top → bottom):
 *   1. Tab bar      — PO Items · Units on carton (+ Edit PO pencil when pairing
 *                     is collapsible).
 *   2. Tab body     — accordion editor OR read-only unit rollup.
 *   3. Package Pairing — Link-a-PO · Items · Zendesk · Email PO · Repair.
 *
 * Both children render in `embedded` mode (bare — no own card chrome); this
 * wrapper owns the single card surface. The pencil is a COLLAPSE toggle for
 * the Package-Pairing sub-section (collapsed by default on open).
 *
 * Which children show is driven by explicit booleans the calling panel passes
 * (`poItems` / `matching`) — unbox shows both; triage shows pairing only (it
 * intentionally hides PO Items). The wrapper degrades to whichever sections the
 * caller enables, so this single component is safe in both panels.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Boxes, PackageOpen, Pencil } from '@/components/Icons';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { WorkspaceCard } from '@/design-system/components';
import { IconButton } from '@/design-system/primitives';
import { CartonUnitsRollupBody } from '../CartonUnitsRollup';
import { LinePoItemsSection } from './LinePoItemsSection';
import { LineMatchingSection } from './LineMatchingSection';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import type { InlineActionFeedbackPayload } from '../InlineActionFeedbackCard';
import type { UnboxLineController } from './unbox-line-controller';
import { receivingSiblingsQueryKey } from '@/lib/queries/receiving-queries';
import { shouldUseUnmatchedItemsSurface } from '@/lib/receiving/intake-items-routing';

type PoCartonTab = 'po-items' | 'units';

interface SiblingsResponse {
  success: boolean;
  receiving_lines: ReceivingLineRow[];
}

interface POUnboxingSectionProps {
  row: ReceivingLineRow;
  staffId: string;
  /** Show the PO-items card (unbox). Off in triage, where pairing subsumes it. */
  poItems: boolean;
  /** Show the Package-Pairing hub (both modes). */
  matching: boolean;
  /** Offer the unmatched "open in unbox" jump (triage hands off to unbox). */
  openInUnbox: boolean;
  /** PO-items accordion interactivity — false renders read-only (triage). */
  editLines: boolean;
  /** Serial entry on the active line (unbox only). */
  serialScan: boolean;
  c: UnboxLineController;
  onItemDescFeedback?: (feedback: InlineActionFeedbackPayload | null) => void;
  onItemDescSaved?: (lineId: number, zohoNotes: string | null) => void;
  /**
   * When false, linked PO items are not rendered here — the caller owns a
   * separate PO-items card (triage layout).
   */
  includeLinkedPoItems?: boolean;
}

export function POUnboxingSection({
  row,
  staffId,
  poItems,
  matching,
  openInUnbox,
  editLines,
  serialScan,
  c,
  onItemDescFeedback,
  onItemDescSaved,
  includeLinkedPoItems = true,
}: POUnboxingSectionProps) {
  const receivingId = row.receiving_id ?? null;
  const linkedPo = !c.isUnfound && !shouldUseUnmatchedItemsSurface(row);
  const showPoItems = poItems || (includeLinkedPoItems && matching && linkedPo);
  const showPairing = matching;
  const tabbedPoItems = poItems && showPoItems;

  const [tab, setTab] = useState<PoCartonTab>('po-items');
  const [pairingOpen, setPairingOpen] = useState(() => !poItems);
  const canCollapsePairing = showPoItems && showPairing;
  const pairingCollapsed = canCollapsePairing ? !pairingOpen : false;

  const siblingsEnabled = tabbedPoItems && typeof receivingId === 'number' && receivingId > 0;
  const { data: siblingsData } = useQuery<SiblingsResponse>({
    queryKey: receivingSiblingsQueryKey(receivingId ?? 0),
    queryFn: async () => {
      const res = await fetch(
        `/api/receiving-lines?receiving_id=${receivingId}&include=serials`,
      );
      if (!res.ok) throw new Error('Failed to fetch carton siblings');
      return res.json();
    },
    enabled: siblingsEnabled,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  const lineCount = siblingsData?.receiving_lines?.length ?? 0;
  const totalSerials = (siblingsData?.receiving_lines ?? []).reduce(
    (n, l) => n + (l.serials?.length ?? 0),
    0,
  );

  const tabItems: HorizontalSliderItem[] = useMemo(
    () => [
      {
        id: 'po-items',
        label: 'PO Items',
        icon: PackageOpen,
        count: lineCount > 0 ? lineCount : undefined,
      },
      {
        id: 'units',
        label: 'Units on carton',
        icon: Boxes,
        count: totalSerials > 0 ? totalSerials : undefined,
      },
    ],
    [lineCount, totalSerials],
  );

  if (!showPoItems && !showPairing) return null;

  const pairingToggleLabel = pairingOpen ? 'Hide package pairing' : 'Show package pairing';
  const pairingToggle = canCollapsePairing ? (
    <div className="flex shrink-0 items-center gap-1.5">
      <span className="text-eyebrow font-black uppercase leading-none tracking-widest text-text-faint">
        Edit PO
      </span>
      <IconButton
        icon={<Pencil className="h-4 w-4" />}
        ariaLabel={pairingToggleLabel}
        title={pairingToggleLabel}
        tone="accent"
        aria-expanded={pairingOpen}
        onClick={() => setPairingOpen((v) => !v)}
      />
    </div>
  ) : undefined;

  const poItemsSection = (
    <LinePoItemsSection
      row={row}
      staffId={staffId}
      serialScan={serialScan}
      openInUnbox={openInUnbox}
      editLines={editLines}
      c={c}
      embedded
      suppressHeader={tabbedPoItems}
      headerRight={tabbedPoItems ? undefined : pairingToggle}
      onItemDescFeedback={onItemDescFeedback}
      onItemDescSaved={onItemDescSaved}
    />
  );

  return (
    <WorkspaceCard
      variant="glass"
      overflow="visible"
      bodyClassName={tabbedPoItems ? 'space-y-3 p-4' : undefined}
    >
      <div>
        {tabbedPoItems ? (
          <>
            <div className="flex min-w-0 flex-nowrap items-center justify-between gap-2">
              <HorizontalButtonSlider
                variant="nav"
                dense
                overlay
                className="min-w-0 flex-1 overflow-hidden"
                items={tabItems}
                value={tab}
                onChange={(id) => setTab(id as PoCartonTab)}
                aria-label="Carton items tabs"
              />
              {pairingToggle}
            </div>

            {tab === 'units' ? (
              <CartonUnitsRollupBody
                receivingId={receivingId}
                activeLineId={row.id ?? null}
                showEmpty
              />
            ) : null}

            {tab === 'po-items' ? poItemsSection : null}
          </>
        ) : showPoItems ? (
          poItemsSection
        ) : null}

        {showPairing ? (
          <LineMatchingSection
            row={row}
            staffId={staffId}
            showOpenInUnbox={openInUnbox}
            embedded
            collapsed={pairingCollapsed}
            showTopRule={showPoItems}
          />
        ) : null}
      </div>
    </WorkspaceCard>
  );
}
