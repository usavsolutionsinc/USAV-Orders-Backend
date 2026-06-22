'use client';

/**
 * PO-items section of the LineEditPanel. Unmatched cartons render the Ecwid
 * add-item / link-repair {@link UnmatchedItemsSection}; matched cartons render
 * the canonical {@link PoLinesAccordion} with the active row's integrated
 * condition + serial-scan slot. Same slot either way, so the rest of the
 * workspace is identical across the two flows. Extracted from LineEditPanel;
 * behaviour is unchanged.
 */

import { useRouter } from 'next/navigation';
import { PoLinesAccordion } from '../PoLinesAccordion';
import { UnmatchedItemsSection } from '../UnmatchedItemsSection';
import { markConditionSet } from '../ReceivingProgressStepper';
import { ActiveLineConditionSerial } from './ActiveLineConditionSerial';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import type { WorkspaceCapabilities } from '../workspace-capabilities';
import type { UnboxLineController } from './unbox-line-controller';

interface LinePoItemsSectionProps {
  row: ReceivingLineRow;
  staffId: string;
  caps: WorkspaceCapabilities;
  c: UnboxLineController;
}

export function LinePoItemsSection({ row, staffId, caps, c }: LinePoItemsSectionProps) {
  const router = useRouter();

  if (row.receiving_id == null) return null;

  if (row.receiving_source === 'unmatched') {
    return (
      <UnmatchedItemsSection
        receivingId={row.receiving_id}
        staffId={staffId}
        showSerialScan={caps.serialScan}
        // Triage identifies; unboxing (serials, photos, receive) happens in unbox
        // mode — this jumps there with the carton pre-opened via the recvId deep link.
        onOpenInUnbox={
          caps.openInUnbox
            ? () => {
                const params = new URLSearchParams({ recvId: String(row.receiving_id) });
                if (row.id > 0) params.set('lineId', String(row.id));
                router.push(`/receiving?${params.toString()}`);
              }
            : undefined
        }
        sourcePlatformHint={c.sourcePlatform || undefined}
        receivingTypeHint={c.receivingType}
        listingUrlHint={c.listingLink || undefined}
        onFileReturnClaim={c.handleFileReturnClaim}
        // Mirror the picked grade into `cond` so the label preview/print tracks
        // it. The matched-carton flow does this through ActiveLineConditionSerial.
        onActiveConditionChange={(next) => {
          c.setCond(next);
          c.setUnitLabelCondition(next);
        }}
      />
    );
  }

  return (
    <PoLinesAccordion
      receivingId={row.receiving_id}
      activeLineId={row.id}
      readOnly={!caps.editLines}
      activeConditionOverride={c.isMultiQtyLine ? (c.unitLabelCondition ?? c.cond) : c.cond}
      activeSerialActions={{
        editingSerialId: c.headerSerialEdit?.id ?? null,
        // Only called for the active row — the accordion routes a non-active
        // row's Edit through the handoff store + line switch, which this panel
        // consumes on (re)mount.
        onEdit: (s) => c.setHeaderSerialEdit(s),
        onDelete: (s, lineId) => {
          if (s.id == null) return;
          if (!window.confirm(`Remove serial ${s.serial_number}?`)) return;
          if (c.headerSerialEdit?.id === s.id) c.setHeaderSerialEdit(null);
          void c.deleteSerialUnit(s.id, lineId);
        },
      }}
      activeRowSlot={({ serials }) => !caps.serialScan ? null : (
        <ActiveLineConditionSerial
          serials={serials}
          lineId={row.id}
          receivingId={row.receiving_id ?? null}
          quantityExpected={row.quantity_expected ?? null}
          cond={c.cond}
          receivingType={c.receivingType}
          serialSubmitting={c.serialSubmitting}
          editingSerial={c.headerSerialEdit}
          serialLookup={c.serialLookup}
          onFileReturnClaim={c.handleFileReturnClaim}
          onSubmitSerial={(sn, grade) => c.enqueueSerial(sn, grade)}
          onDeleteSerialUnit={(id, lineId) => void c.deleteSerialUnit(id, lineId)}
          onReplaceSerialUnit={(original, next) => void c.replaceSerialUnit(original, next)}
          onSetUnitGrade={(id, grade) => void c.setUnitGrade(id, grade)}
          onActiveConditionChange={c.setUnitLabelCondition}
          onConditionChange={(next) => {
            c.setCond(next);
            markConditionSet(row.id);
            void c.patch({ condition_grade: next });
          }}
          onEditingSerialChange={c.setHeaderSerialEdit}
        />
      )}
    />
  );
}
