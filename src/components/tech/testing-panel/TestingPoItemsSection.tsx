'use client';

import { PoLinesAccordion } from '@/components/receiving/workspace/PoLinesAccordion';
import { UnmatchedItemsSection } from '@/components/receiving/workspace/UnmatchedItemsSection';
import { type UnitSlotSerial } from '@/components/tech/TestingUnitSlots';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import type { TestingController } from './testing-panel-types';
import { TestingLineSlot, confirmDeleteSerial } from './TestingLineSlot';
import {
  shouldUseUnmatchedItemsSurface,
} from '@/lib/receiving/intake-items-routing';
import { isReturnIntake } from '@/lib/receiving/triage-intake-kind';

interface Props {
  row: ReceivingLineRow;
  staffId: string;
  c: TestingController;
  embedded?: boolean;
  headerRight?: React.ReactNode;
}

/**
 * PO-items block for the testing workspace — same accordion / unmatched list as
 * unbox, but the active-row slot renders {@link TestingLineSlot} (verdict pills)
 * instead of condition + receive serials. Composed inside
 * {@link TestingPoUnboxingSection} in embedded mode so the wrapper owns the card
 * chrome and the single package-pairing pencil (no CartonAddPopover modal).
 */
export function TestingPoItemsSection({
  row,
  staffId,
  c,
  embedded = false,
  headerRight,
}: Props) {
  if (row.receiving_id == null) return null;

  if (shouldUseUnmatchedItemsSurface(row)) {
    return (
      <UnmatchedItemsSection
        receivingId={row.receiving_id}
        staffId={staffId}
        embedded={embedded}
        headerRight={headerRight}
        sourcePlatformHint={c.sourcePlatform || undefined}
        receivingTypeHint={isReturnIntake(row) ? 'RETURN' : c.receivingType}
        listingUrlHint={c.listingLink || undefined}
        renderLineActions={(line) => (
          <TestingLineSlot
            c={c}
            lineId={line.id}
            serials={(line.serials ?? []) as UnitSlotSerial[]}
            expected={line.quantity_expected ?? null}
            disabled={c.saving}
            selectedIndex={c.activeSlotByLine[line.id] ?? 0}
          />
        )}
      />
    );
  }

  return (
    <PoLinesAccordion
      receivingId={row.receiving_id}
      activeLineId={row.id}
      embedded={embedded}
      headerRight={headerRight}
      placeholderActiveRow={row}
      hideNoTestLines
      activeSerialActions={{
        editingSerialId: c.headerSerialEdit?.id ?? null,
        onEdit: (s) => c.setHeaderSerialEdit(s as UnitSlotSerial),
        onDelete: (s, lineId) => {
          if (s.id == null) return;
          if (!confirmDeleteSerial(s.serial_number)) return;
          if (c.headerSerialEdit?.id === s.id) c.setHeaderSerialEdit(null);
          void c.deleteSerial(lineId, s.id);
        },
      }}
      activeRowSlot={({ serials }) => (
        <TestingLineSlot
          c={c}
          lineId={row.id}
          serials={serials as UnitSlotSerial[]}
          expected={row.quantity_expected ?? null}
          disabled={row.receiving_id == null || c.saving}
          selectedIndex={c.activeSlot}
          autoFocus
          showSavedChips={false}
          editingSerial={c.headerSerialEdit}
          onEditingSerialChange={c.setHeaderSerialEdit}
        />
      )}
    />
  );
}
