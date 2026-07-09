'use client';

/**
 * POUnboxingSection — the unified Unboxing / Package-Pairing wrapper.
 *
 * Unbox mode shows PO Items by default with an optional "Units on carton"
 * eyebrow link (not a full tab bar). Package Pairing collapses by default.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package, Pencil } from '@/components/Icons';
import { WorkspaceCard } from '@/design-system/components';
import { IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { CartonUnitsRollupBody } from '../CartonUnitsRollup';
import { LinePoItemsSection } from './LinePoItemsSection';
import { LineMatchingSection } from './LineMatchingSection';
import { UnfoundMatchStrip } from './UnfoundMatchStrip';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import type { InlineActionFeedbackPayload } from '../InlineActionFeedbackCard';
import type { UnboxLineController } from './unbox-line-controller';
import type { ReceivingStepKey } from '../derive-receiving-step-states';
import { receivingSiblingsQueryKey } from '@/lib/queries/receiving-queries';
import { shouldUseUnmatchedItemsSurface } from '@/lib/receiving/intake-items-routing';
import { WorkspaceSectionTitle } from '../WorkspaceSectionLabel';

type PoCartonView = 'po-items' | 'units';

interface SiblingsResponse {
  success: boolean;
  receiving_lines: ReceivingLineRow[];
}

interface POUnboxingSectionProps {
  row: ReceivingLineRow;
  staffId: string;
  poItems: boolean;
  matching: boolean;
  openInUnbox: boolean;
  editLines: boolean;
  serialScan: boolean;
  c: UnboxLineController;
  onItemDescFeedback?: (feedback: InlineActionFeedbackPayload | null) => void;
  onItemDescSaved?: (lineId: number, zohoNotes: string | null) => void;
  includeLinkedPoItems?: boolean;
  activeStep?: ReceivingStepKey | null;
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
  activeStep = null,
}: POUnboxingSectionProps) {
  const receivingId = row.receiving_id ?? null;
  const linkedPo = !c.isUnfound && !shouldUseUnmatchedItemsSurface(row);
  const showPoItems = poItems || (includeLinkedPoItems && matching && linkedPo);
  const showPairing = matching;
  const tabbedPoItems = poItems && showPoItems;

  const [view, setView] = useState<PoCartonView>('po-items');
  // Package Pairing is collapsed by default for every carton (unfound included);
  // the "Edit PO" pencil in the header opens it. Auto-match stays visible above.
  const [pairingOpen, setPairingOpen] = useState(false);
  const canCollapsePairing = showPoItems && showPairing;
  const pairingCollapsed = canCollapsePairing ? !pairingOpen : false;
  const showAutoMatch = c.isUnfound;

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
  const showUnitsLink = tabbedPoItems && totalSerials > 0 && totalSerials !== lineCount;

  const headerRight = useMemo(() => {
    const parts: ReactNode[] = [];
    if (showUnitsLink) {
      parts.push(
        <button
          key="units"
          type="button"
          aria-pressed={view === 'units'}
          onClick={() => setView((v) => (v === 'units' ? 'po-items' : 'units'))}
          className={`inline-flex shrink-0 items-center gap-1 text-eyebrow font-black uppercase tracking-widest transition-colors ${
            view === 'units' ? 'text-blue-600' : 'text-text-muted hover:text-text-default'
          }`}
        >
          <Package className="h-3 w-3 shrink-0" aria-hidden />
          Units on carton · {totalSerials}
        </button>,
      );
    }
    if (canCollapsePairing) {
      parts.push(
        <div key="pairing" className="flex shrink-0 items-center gap-1">
          <span className="text-eyebrow font-black uppercase leading-none tracking-widest text-text-faint">
            Edit PO
          </span>
          <HoverTooltip label={pairingOpen ? 'Hide package pairing' : 'Show package pairing'} asChild>
            <IconButton
              icon={<Pencil className="h-4 w-4" />}
              ariaLabel={pairingOpen ? 'Hide package pairing' : 'Show package pairing'}
              tone="accent"
              aria-expanded={pairingOpen}
              onClick={() => setPairingOpen((v) => !v)}
            />
          </HoverTooltip>
        </div>,
      );
    }
    if (parts.length === 0) return undefined;
    return <div className="flex items-center gap-3">{parts}</div>;
  }, [canCollapsePairing, pairingOpen, showUnitsLink, totalSerials, view]);

  if (!showPoItems && !showPairing) return null;

  const poItemsSection = (
    <LinePoItemsSection
      row={row}
      staffId={staffId}
      serialScan={serialScan}
      openInUnbox={openInUnbox}
      editLines={editLines}
      c={c}
      embedded
      headerRight={headerRight}
      onItemDescFeedback={onItemDescFeedback}
      onItemDescSaved={onItemDescSaved}
      activeStep={activeStep}
    />
  );

  return (
    <WorkspaceCard variant="glass" overflow="visible" bodyClassName="space-y-3 p-4">
      <div>
        {tabbedPoItems ? (
          view === 'units' ? (
            <>
              <div className="mb-2 flex items-center justify-between gap-2">
                <WorkspaceSectionTitle as="p">
                  Units on carton · {totalSerials}
                </WorkspaceSectionTitle>
                {headerRight}
              </div>
              <CartonUnitsRollupBody
                receivingId={receivingId}
                activeLineId={row.id ?? null}
                showEmpty
              />
            </>
          ) : (
            poItemsSection
          )
        ) : showPoItems ? (
          poItemsSection
        ) : null}

        {showAutoMatch ? (
          <UnfoundMatchStrip
            receivingId={receivingId}
            trackingNumber={row.tracking_number ?? null}
            showTopRule={showPoItems || tabbedPoItems}
          />
        ) : null}

        {showPairing ? (
          <LineMatchingSection
            row={row}
            staffId={staffId}
            showOpenInUnbox={openInUnbox}
            embedded
            collapsed={pairingCollapsed}
            // Separate pairing (rule + top spacing) from whatever sits above it —
            // PO items on matched cartons, or the auto-match strip on unfound
            // ones. Without the auto-match case it abutted the strip with 0 gap.
            showTopRule={showPoItems || showAutoMatch}
          />
        ) : null}
      </div>
    </WorkspaceCard>
  );
}
