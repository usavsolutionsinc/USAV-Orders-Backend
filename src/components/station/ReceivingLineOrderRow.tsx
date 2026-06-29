'use client';

/**
 * A single receiving line rendered as a dashboard-style order row. Built from
 * the shared RowTitle / RowMetaColumns / ReceivingIdentityChips primitives so it
 * lines up with the collapsed PO summary. Re-exported from ReceivingLinesTable
 * for back-compat with existing importers. Extracted unchanged.
 */

import { Check } from '@/components/Icons';
import {
  conditionGradeTableLabel,
  workflowStatusTableLabel,
  getStatusDotBg,
  getWorkflowIconMeta,
  shouldShowWorkflowStatusIcon,
} from '@/components/station/receiving-constants';
import { ReceivingIdentityChips } from '@/components/receiving/ReceivingIdentityChips';
import { RowTitle, RowMetaColumns, META_COL } from '@/components/ui/RowMetaColumns';
import { DeliveryStateIcon } from '@/components/station/ReceivingDeliveryStateIcon';
import { IconWithTooltip } from '@/components/ui/IconWithTooltip';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import {
  dashboardOrderRowChipsClass,
  dashboardOrderRowShellClass,
} from '@/lib/dashboard-order-row-layout';
import { fmtShortTs } from '@/components/station/receiving-lines-table-helpers';
import { IncomingAttachTrackingButton } from '@/components/station/IncomingAttachTrackingButton';
import type { ReceivingLineRow } from './receiving-line-row';

export function ReceivingLineOrderRow({
  row,
  isSelected,
  onSelect,
  index,
  isMobile,
  isIncoming = false,
  isHistory = false,
  selectMode = false,
}: {
  row: ReceivingLineRow;
  isSelected: boolean;
  onSelect: () => void;
  index: number;
  isMobile: boolean;
  /** Incoming view: serials aren't assigned until unboxing and the carrier /
   *  "EXPECTED" status are redundant, so we drop those chips/labels. */
  isIncoming?: boolean;
  /** History view: everything shown has already been received (an unfound box
   *  is received too — it just can't be marked received in Zoho because the PO
   *  isn't found there). So the workflow status icon (EXPECTED clock / RECEIVED
   *  check) and the testing verdict (FAILED box) are noise — we drop the icon
   *  and read the dot as a uniform "received" green. */
  isHistory?: boolean;
  /** Multi-select mode: render a checkbox and treat `isSelected` as "checked".
   *  Click toggles membership instead of opening the workspace. */
  selectMode?: boolean;
}) {
  // Unfound cartons (no Zoho PO) arrive labelled "Unfound PO" from the server
  // (buildUnmatchedEmptyReceivingLine / UNMATCHED_EMPTY_LINE_LABEL).
  const productTitle = row.item_name || row.zoho_item_id || 'Unnamed inbound line';
  const quantityText = `${row.quantity_received}/${row.quantity_expected ?? '?'}`;
  const qtyExpected = row.quantity_expected ?? 0;
  const workflowLabel = workflowStatusTableLabel(row.workflow_status || 'EXPECTED');
  // The workflow status renders as a compact icon (not text) — RECEIVED and
  // EXPECTED are the dominant states; everything else falls back to a generic
  // package glyph. The label rides along as the `title` for hover/a11y.
  const { Icon: WorkflowIcon, tone: workflowIconTone } = getWorkflowIconMeta(workflowLabel);
  const condGrade = (row.condition_grade || '').toUpperCase();
  const conditionLabel = conditionGradeTableLabel(row.condition_grade);
  const trackingValue = (row.tracking_number || '').trim();
  const skuValue = (row.sku || '').trim();
  const poValue = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
  // Join all serials so SerialChip's CSV-aware helper picks the most recent and
  // shows its last 6 chars. Clipboard carries the full list for traceability.
  const serialsCsv = (row.serials ?? [])
    .map((s) => (s.serial_number || '').trim())
    .filter(Boolean)
    .join(', ');

  return (
    <div
      data-line-row-id={row.id}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      role={selectMode ? 'checkbox' : 'button'}
      tabIndex={0}
      aria-checked={selectMode ? isSelected : undefined}
      aria-pressed={selectMode ? undefined : isSelected}
      aria-label={`Select receiving line ${row.id}`}
      className={`${dashboardOrderRowShellClass(isMobile)} border-b border-gray-100 px-3 py-1.5 transition-colors cursor-pointer hover:bg-blue-50/50 ${
        isSelected ? 'bg-blue-50/80' : index % 2 === 1 ? 'bg-gray-50/40' : 'bg-white'
      }`}
    >
      <div className="flex min-w-0 flex-col">
        <RowTitle
          leading={
            selectMode ? (
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                  isSelected ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white'
                }`}
              >
                {isSelected && <Check className="h-3 w-3" />}
              </span>
            ) : undefined
          }
          // History reads as received across the board (unfound boxes included),
          // so the dot is a uniform "received" green there rather than the
          // workflow-derived color that paints unfound rows amber/"pending".
          dot={isHistory ? 'bg-emerald-500' : getStatusDotBg(row.workflow_status, row.quantity_received, row.quantity_expected)}
          dotTitle={isHistory ? 'Received' : workflowLabel}
          dotTrack={META_COL.dotTrackWide}
          title={productTitle}
        />
        <RowMetaColumns
          // In select mode the title row gains a leading checkbox (w-4 + mr-2 =
          // 1.5rem), shifting the title text right. Add that same offset to the
          // meta indent so the qty · condition · rest subrow stays aligned under
          // the title instead of stranding at the original (un-shifted) x.
          indent={selectMode ? `calc(${META_COL.indentWide} + 1.5rem)` : META_COL.indentWide}
          qtyCol={META_COL.qtyColWide}
          qty={
            <span className={qtyExpected > 1 ? 'text-yellow-600' : row.quantity_expected && row.quantity_received >= row.quantity_expected ? 'text-emerald-600' : 'text-gray-500'}>
              {quantityText}
            </span>
          }
          condition={<span className={condGrade === 'BRAND_NEW' ? 'text-yellow-600' : condGrade === 'PARTS' ? 'text-amber-800' : 'text-gray-400'}>{conditionLabel}</span>}
          rest={
            <div className="flex items-center gap-2">
              {/* History timeline: door-scan ("scanned at") and unbox times +
                  who. Gated on data so incoming/expected rows stay clean.
                  Desktop-only — the mobile table isn't the history surface. */}
              {!isIncoming && (row.scanned_at || row.received_at || row.unboxed_at) ? (
                <HoverTooltip
                  label={[
                    fmtShortTs(row.scanned_at ?? row.received_at)
                      ? `Scanned ${fmtShortTs(row.scanned_at ?? row.received_at)}${row.scanned_by_name ? ` by ${row.scanned_by_name}` : ''}`
                      : '',
                    fmtShortTs(row.unboxed_at)
                      ? `Unboxed ${fmtShortTs(row.unboxed_at)}${row.unboxed_by_name ? ` by ${row.unboxed_by_name}` : ''}`
                      : '',
                  ].filter(Boolean).join(' · ')}
                  asChild
                  focusable={false}
                >
                  <span className="hidden items-center gap-1.5 text-eyebrow font-semibold text-gray-400 sm:inline-flex">
                    {fmtShortTs(row.scanned_at ?? row.received_at) ? (
                      <span>↓ {fmtShortTs(row.scanned_at ?? row.received_at)}{row.scanned_by_name ? ` · ${row.scanned_by_name}` : ''}</span>
                    ) : null}
                    {fmtShortTs(row.unboxed_at) ? (
                      <span>📦 {fmtShortTs(row.unboxed_at)}{row.unboxed_by_name ? ` · ${row.unboxed_by_name}` : ''}</span>
                    ) : null}
                  </span>
                </HoverTooltip>
              ) : null}
              {/* Workflow status icon: shown in the active receive workspace,
                  hidden in History (received is implied; EXPECTED doesn't apply
                  since unfound is still received) and in Incoming. This also
                  drops the testing verdict (FAILED box) from the unbox history. */}
              {shouldShowWorkflowStatusIcon({ isHistory, isIncoming }) ? (
                <IconWithTooltip
                  Icon={WorkflowIcon}
                  label={workflowLabel}
                  iconClassName={workflowIconTone}
                />
              ) : null}
              <DeliveryStateIcon state={row.delivery_state} />
            </div>
          }
        />
      </div>

      <ReceivingIdentityChips
        po={poValue}
        sku={skuValue}
        tracking={trackingValue}
        serialsCsv={serialsCsv}
        includeSerial={!isIncoming}
        asColumns={!isMobile}
        className={dashboardOrderRowChipsClass(isMobile)}
        // Incoming AWAITING_TRACKING: the empty tracking chip becomes the
        // "Add tracking" trigger, pre-targeted to this PO.
        trackingAction={
          isIncoming && row.delivery_state === 'AWAITING_TRACKING' && (row.zoho_purchaseorder_id || '').trim()
            ? (
              <IncomingAttachTrackingButton
                poId={(row.zoho_purchaseorder_id || '').trim()}
                poNumber={row.zoho_purchaseorder_number}
              />
            )
            : undefined
        }
      />
    </div>
  );
}
