'use client';

import { useState } from 'react';
import { Pencil } from '@/components/Icons';
import { WorkspaceCard } from '@/design-system/components';
import { IconButton } from '@/design-system/primitives';
import { LineMatchingSection } from '@/components/receiving/workspace/line-edit/LineMatchingSection';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import type { TestingController } from './testing-panel-types';
import { TestingPoItemsSection } from './TestingPoItemsSection';

/**
 * Testing workspace analogue of {@link POUnboxingSection}: one card with PO items
 * on top and the Package Pairing dropdown below. The header pencil toggles the
 * pairing section (same as unbox) — it replaces the old CartonAddPopover modal
 * (Item · Web · Box) that lived on the standalone PO-items accordion.
 */
export function TestingPoUnboxingSection({
  row,
  staffId,
  c,
}: {
  row: ReceivingLineRow;
  staffId: string;
  c: TestingController;
}) {
  const [pairingOpen, setPairingOpen] = useState(true);

  if (row.receiving_id == null) return null;

  const pairingToggleLabel = pairingOpen ? 'Hide package pairing' : 'Show package pairing';
  const pairingToggle = (
    <IconButton
      icon={<Pencil className="h-4 w-4" />}
      ariaLabel={pairingToggleLabel}
      title={pairingToggleLabel}
      tone="accent"
      aria-expanded={pairingOpen}
      onClick={() => setPairingOpen((v) => !v)}
    />
  );

  return (
    <WorkspaceCard overflow="visible">
      <div>
        <TestingPoItemsSection
          row={row}
          staffId={staffId}
          c={c}
          embedded
          headerRight={pairingToggle}
        />
        <LineMatchingSection
          row={row}
          staffId={staffId}
          showOpenInUnbox={false}
          embedded
          collapsed={!pairingOpen}
          showTopRule
        />
      </div>
    </WorkspaceCard>
  );
}
