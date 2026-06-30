'use client';

/**
 * POUnboxingSection — the unified Unboxing / Package-Pairing wrapper.
 *
 * Combines what used to be TWO separate workspace cards — the "PO Items" editor
 * ({@link LinePoItemsSection}) and the "Package Pairing" hub
 * ({@link LineMatchingSection}) — into ONE {@link WorkspaceCard} with a SINGLE
 * shared edit pencil on the "PO items · N" header row ({@link IconButton}, same
 * as {@link LineLabelPreviewCard}).
 *
 * Layout (top → bottom):
 *   1. PO Items     — the carton's lines (title / qty / price / condition / serial),
 *                     condition pills + serial scan on the active line.
 *   2. Package Pairing — Link-a-PO · Items · Zendesk · Email PO · Repair,
 *                     the "Paired" summary.
 *
 * Both children render in `embedded` mode (bare — no own card chrome, no own
 * pencil); this wrapper owns the single card surface and the one header pencil.
 * The pencil is a COLLAPSE toggle for the Package-Pairing sub-section (collapsed
 * by default on open): clicking it expands or hides the pairing tabs/body. PO Items
 * on top is unaffected. It does not open the Items tab.
 *
 * Which children show is still driven by the {@link WorkspaceCapabilities} matrix
 * (`caps.poItems` / `caps.matching`) — unbox shows both; triage shows pairing
 * only (it intentionally hides PO Items). The wrapper degrades to whichever
 * sections the mode enables, so this single component is safe in every variant.
 *
 * Maintainability: this is pure composition. All state/handlers live in the
 * controller (`useUnboxLineController`). Adding a sub-section = drop another
 * embedded child here; adding a pairing source = one tab + one inline component
 * in LineMatchingSection (see EmailPoLinkTab / PoLinkTab for the shape).
 */

import { useState } from 'react';
import { Pencil } from '@/components/Icons';
import { WorkspaceCard } from '@/design-system/components';
import { IconButton } from '@/design-system/primitives';
import { LinePoItemsSection } from './LinePoItemsSection';
import { LineMatchingSection } from './LineMatchingSection';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import type { WorkspaceCapabilities } from '../workspace-capabilities';
import type { InlineActionFeedbackPayload } from '../InlineActionFeedbackCard';
import type { UnboxLineController } from './unbox-line-controller';

interface POUnboxingSectionProps {
  row: ReceivingLineRow;
  staffId: string;
  caps: WorkspaceCapabilities;
  c: UnboxLineController;
  onItemDescFeedback?: (feedback: InlineActionFeedbackPayload | null) => void;
  onItemDescSaved?: (lineId: number, zohoNotes: string | null) => void;
}

export function POUnboxingSection({
  row,
  staffId,
  caps,
  c,
  onItemDescFeedback,
  onItemDescSaved,
}: POUnboxingSectionProps) {
  // A paired/matched carton IS a normal PO, so show its PO Items accordion even
  // in modes that normally hide it (triage hides PO Items for UNFOUND cartons) —
  // once linked it reads as a normal PO with Package Pairing below it. In triage
  // the accordion is read-only (caps.editLines=false); unbox is unchanged.
  const linked = !c.isUnfound;
  const showPoItems = caps.poItems || (caps.matching && linked);
  const showPairing = caps.matching;

  // Collapse/expand the Package-Pairing sub-section (title + tabs + body) via a
  // pencil on the "PO items · N" row (headerRight) — same IconButton as the
  // unbox display. The pencil shows whenever BOTH sub-sections render (unbox, or
  // a linked triage carton). Default open state differs by mode: unbox keeps
  // pairing collapsed (it's secondary to the PO items), triage keeps it visible
  // below the items (it's the operator's pairing surface) — the pencil toggles
  // either way. `caps.poItems` is the static "is this the unbox display" tell.
  const [pairingOpen, setPairingOpen] = useState(() => !caps.poItems);
  const canCollapsePairing = showPoItems && showPairing;
  const pairingCollapsed = canCollapsePairing ? !pairingOpen : false;

  // Nothing to show for this mode — render nothing rather than an empty card.
  if (!showPoItems && !showPairing) return null;

  const pairingToggleLabel = pairingOpen ? 'Hide package pairing' : 'Show package pairing';
  const pairingToggle = canCollapsePairing ? (
    // "Edit PO" microcopy sits to the LEFT of the pencil (the header row is
    // justify-between, so this group is right-aligned and the label leads the
    // pencil). It names what the pencil does — open the PO/package-pairing editor.
    <div className="flex items-center gap-1.5">
      <span className="text-eyebrow font-black uppercase leading-none tracking-widest text-gray-400">
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

  return (
    <WorkspaceCard overflow="visible">
      <div>
        {/* 1 — PO Items (top/header section). Pencil shares the eyebrow row. */}
        {showPoItems ? (
          <LinePoItemsSection
            row={row}
            staffId={staffId}
            caps={caps}
            c={c}
            embedded
            headerRight={pairingToggle}
            onItemDescFeedback={onItemDescFeedback}
            onItemDescSaved={onItemDescSaved}
          />
        ) : null}

        {/* 2 — Package Pairing (below PO Items). The whole section (incl. its
            title + a top divider) collapses via the header pencil. */}
        {showPairing ? (
          <LineMatchingSection
            row={row}
            staffId={staffId}
            showOpenInUnbox={caps.openInUnbox}
            embedded
            collapsed={pairingCollapsed}
            showTopRule={showPoItems}
          />
        ) : null}
      </div>
    </WorkspaceCard>
  );
}
