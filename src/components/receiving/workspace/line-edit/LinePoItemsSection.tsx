'use client';

/**
 * PO-items section of the LineEditPanel. Unmatched cartons, returns, and
 * sales-order-linked cartons render the Ecwid add-item / serial-scan
 * {@link UnmatchedItemsSection}; real Zoho PO cartons render
 * {@link PoLinesAccordion}. Lineless real PO cartons fall back to the unmatched
 * surface so the workspace never paints a blank card.
 */

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { openInUnboxHref } from '@/lib/receiving/surface-path';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PoLinesAccordion } from '../PoLinesAccordion';
import { UnmatchedItemsSection } from '../UnmatchedItemsSection';
import { markConditionSet } from '../ReceivingProgressStepper';
import { ActiveLineConditionSerial } from './ActiveLineConditionSerial';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import type { InlineActionFeedbackPayload } from '../InlineActionFeedbackCard';
import type { UnboxLineController } from './unbox-line-controller';
import {
  dispatchLineUpdated,
  dispatchSelectLine,
} from '@/components/station/receiving-lines-table-helpers';
import { invalidateReceivingFeeds, receivingSiblingsQueryKey } from '@/lib/queries/receiving-queries';
import {
  shouldUsePoAccordion,
  shouldUseUnmatchedItemsSurface,
} from '@/lib/receiving/intake-items-routing';
import { isReturnIntake } from '@/lib/receiving/triage-intake-kind';

interface LinePoItemsSectionProps {
  row: ReceivingLineRow;
  staffId: string;
  c: UnboxLineController;
  /** Serial-number entry on the active line (unbox captures serials; triage doesn't). */
  serialScan: boolean;
  /** Offer the unmatched-carton "open in unbox" jump (triage hands off to unbox). */
  openInUnbox: boolean;
  /** PO-items accordion interactivity — false renders a flat read-only display (triage). */
  editLines: boolean;
  onItemDescFeedback?: (feedback: InlineActionFeedbackPayload | null) => void;
  onItemDescSaved?: (lineId: number, zohoNotes: string | null) => void;
  embedded?: boolean;
  headerRight?: React.ReactNode;
  /** Hide the embedded "PO items · N" eyebrow — the tab slider owns the label. */
  suppressHeader?: boolean;
}

interface SiblingsResponse {
  success: boolean;
  receiving_lines: ReceivingLineRow[];
}

export function LinePoItemsSection({
  row,
  staffId,
  c,
  serialScan,
  openInUnbox,
  editLines,
  onItemDescFeedback,
  onItemDescSaved,
  embedded = false,
  headerRight,
  suppressHeader = false,
}: LinePoItemsSectionProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const receivingId = row.receiving_id;
  const wantsPoAccordion = shouldUsePoAccordion(row);
  const queryKey = useMemo(
    () => receivingSiblingsQueryKey(receivingId ?? 0),
    [receivingId],
  );

  const { data, isPending } = useQuery<SiblingsResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(
        `/api/receiving-lines?receiving_id=${receivingId}&include=serials`,
      );
      if (!res.ok) throw new Error('Failed to fetch siblings');
      return res.json();
    },
    enabled: wantsPoAccordion && receivingId != null,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  if (receivingId == null) return null;

  const siblingCount = data?.receiving_lines?.length;
  const linelessRealPo =
    wantsPoAccordion && !isPending && (siblingCount === undefined ? false : siblingCount === 0);
  const useUnmatchedSurface =
    shouldUseUnmatchedItemsSurface(row) || linelessRealPo;

  const openInUnboxHandler = openInUnbox
    ? () => {
        router.push(openInUnboxHref(receivingId, row.id));
      }
    : undefined;

  const receivingTypeHint = isReturnIntake(row) ? 'RETURN' : c.receivingType;

  if (useUnmatchedSurface) {
    return (
      <UnmatchedItemsSection
        receivingId={receivingId}
        staffId={staffId}
        embedded={embedded}
        headerRight={headerRight}
        suppressHeader={suppressHeader}
        showSerialScan={serialScan}
        onOpenInUnbox={openInUnboxHandler}
        sourcePlatformHint={c.sourcePlatform || undefined}
        receivingTypeHint={receivingTypeHint}
        listingUrlHint={c.listingLink || undefined}
        onFileReturnClaim={c.handleFileReturnClaim}
        onActiveConditionChange={(next) => {
          c.setCond(next);
          c.setUnitLabelCondition(next);
        }}
        serialAbsent={c.serialAbsent}
        serialAbsentReason={c.serialAbsentReason}
        requireSerialConfirmation={c.requireSerialConfirmation}
        onSerialAbsentChange={({ absent, reason }) => {
          c.setSerialAbsent(absent);
          c.setSerialAbsentReason(reason);
        }}
        linkedOrderHint={{
          source: row.receiving_source ?? null,
          zoho_purchaseorder_id: row.zoho_purchaseorder_id ?? null,
          zoho_purchaseorder_number: row.zoho_purchaseorder_number ?? null,
        }}
        activeLineId={row.id}
        onUnlinked={() => {
          invalidateReceivingFeeds(queryClient);
        }}
        onLinked={({ carton, line }) => {
          const cartonPatch = {
            zoho_purchaseorder_number: carton.zoho_purchaseorder_number,
            receiving_source: carton.source ?? 'zoho_po',
            source_platform: carton.source_platform ?? row.source_platform,
            source_platform_pill: carton.source_platform ?? row.source_platform_pill,
            carton_intake_type: carton.intake_type ?? row.carton_intake_type,
            receiving_type: carton.intake_type ?? row.receiving_type,
          };
          if (line && line.id > 0 && row.id <= 0) {
            const realRow: ReceivingLineRow = {
              ...row,
              ...cartonPatch,
              id: line.id,
              sku: line.sku ?? row.sku,
              item_name: line.item_name ?? row.item_name,
              quantity_expected: line.quantity_expected,
              quantity_received: line.quantity_received,
              condition_grade: line.condition_grade ?? row.condition_grade,
              receiving_listing_url: line.listing_url ?? row.receiving_listing_url,
              source_platform_pill: line.source_platform_pill ?? cartonPatch.source_platform_pill,
            };
            dispatchSelectLine(realRow);
          } else if (row.id > 0) {
            dispatchLineUpdated({ id: row.id, ...cartonPatch });
          }
          invalidateReceivingFeeds(queryClient);
        }}
      />
    );
  }

  return (
    <PoLinesAccordion
      receivingId={receivingId}
      activeLineId={row.id}
      embedded={embedded}
      headerRight={headerRight}
      suppressHeader={suppressHeader}
      placeholderActiveRow={row}
      readOnly={!editLines}
      onItemDescFeedback={onItemDescFeedback}
      onItemDescSaved={onItemDescSaved}
      activeConditionOverride={c.isMultiQtyLine ? (c.unitLabelCondition ?? c.cond) : c.cond}
      activeSerialActions={{
        editingSerialId: c.headerSerialEdit?.id ?? null,
        onEdit: (s) => c.setHeaderSerialEdit(s),
        onDelete: (s, lineId) => {
          if (s.id == null) return;
          if (!window.confirm(`Remove serial ${s.serial_number}?`)) return;
          if (c.headerSerialEdit?.id === s.id) c.setHeaderSerialEdit(null);
          void c.deleteSerialUnit(s.id, lineId);
        },
      }}
      activeRowSlot={({ serials }) => !serialScan ? null : (
        <ActiveLineConditionSerial
          serials={serials}
          lineId={row.id}
          receivingId={receivingId}
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
          serialAbsent={c.serialAbsent}
          serialAbsentReason={c.serialAbsentReason}
          requireSerialConfirmation={c.requireSerialConfirmation}
          onSerialAbsentChange={({ absent, reason }) => {
            c.setSerialAbsent(absent);
            c.setSerialAbsentReason(reason);
          }}
        />
      )}
    />
  );
}
