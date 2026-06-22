import { PoLinesAccordion } from '@/components/receiving/workspace/PoLinesAccordion';
import { UnmatchedItemsSection } from '@/components/receiving/workspace/UnmatchedItemsSection';
import { type UnitSlotSerial } from '@/components/tech/TestingUnitSlots';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import type { TestingController } from './testing-panel-types';
import { TestingLineSlot, confirmDeleteSerial } from './TestingLineSlot';

/**
 * The per-line testing slots: an UnmatchedItemsSection (off-PO cartons) or the
 * PoLinesAccordion (matched POs), each rendering a {@link TestingLineSlot} for
 * its active row. Renders nothing until the line is linked to a carton.
 */
export function TestingActiveRows({ c, row }: { c: TestingController; row: ReceivingLineRow }) {
  if (row.receiving_id == null) return null;

  if (row.receiving_source === 'unmatched') {
    return (
      <UnmatchedItemsSection
        receivingId={row.receiving_id}
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
