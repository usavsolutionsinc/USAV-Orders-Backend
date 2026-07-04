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
 * Which children show is driven by explicit booleans the calling panel passes
 * (`poItems` / `matching`) — unbox shows both; triage shows pairing only (it
 * intentionally hides PO Items). The wrapper degrades to whichever sections the
 * caller enables, so this single component is safe in both panels.
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
import type { InlineActionFeedbackPayload } from '../InlineActionFeedbackCard';
import type { UnboxLineController } from './unbox-line-controller';
import { shouldUseUnmatchedItemsSurface } from '@/lib/receiving/intake-items-routing';

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
}: POUnboxingSectionProps) {
  // Real Zoho PO cartons show the PO-items accordion in triage once linked.
  // Returns and sales-order pairings use the unmatched/serial surface — not the
  // Zoho PO accordion — even when `receiving_source` reads `zoho_po`.
  const linkedPo = !c.isUnfound && !shouldUseUnmatchedItemsSurface(row);
  const showPoItems = poItems || (matching && linkedPo);
  const showPairing = matching;

  // Collapse/expand the Package-Pairing sub-section (title + tabs + body) via a
  // pencil on the "PO items · N" row (headerRight) — same IconButton as the
  // unbox display. The pencil shows whenever BOTH sub-sections render (unbox, or
  // a linked triage carton). Default open state differs by mode: unbox keeps
  // pairing collapsed (it's secondary to the PO items), triage keeps it visible
  // below the items (it's the operator's pairing surface) — the pencil toggles
  // either way. `poItems` is the static "is this the unbox display" tell.
  const [pairingOpen, setPairingOpen] = useState(() => !poItems);
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

  return (
    <WorkspaceCard overflow="visible">
      <div>
        {/* 1 — PO Items (top/header section). Pencil shares the eyebrow row. */}
        {showPoItems ? (
          <LinePoItemsSection
            row={row}
            staffId={staffId}
            serialScan={serialScan}
            openInUnbox={openInUnbox}
            editLines={editLines}
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
