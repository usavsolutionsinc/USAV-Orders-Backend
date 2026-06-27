'use client';

/**
 * Items section for an unmatched (no-Zoho-PO) receiving carton.
 *
 * Mounted by {@link LineEditPanel} where {@link PoLinesAccordion} would
 * sit for a Zoho-matched carton. Owns:
 *   - fetching the carton's existing receiving_lines
 *   - the [+] CTA → CartonAddPopover (Item = zoho_catalog search · Web · Box)
 *   - per-line condition pill updates
 *
 * Repair-service linking was retired from here — it now lives in the triage
 * Smart-Matching "Repair Service / Trade in" tab (inline Ecwid order list).
 *
 * Kept deliberately small so LineEditPanel can drop it in without
 * branching on receiving_source for every prop.
 *
 * Thin composition shell: state + handlers live in {@link useUnmatchedItems};
 * the per-line row is {@link UnmatchedLineRow} under `./unmatched-items/`.
 */

import { Loader2, PackageOpen, Plus } from '@/components/Icons';
import { WorkspaceCard } from '@/design-system/components';
import { CartonAddPopover } from '@/components/receiving/workspace/CartonAddPopover';
import { HandlingUnitChip } from '@/components/receiving/HandlingUnitChip';
import { LabelIdentifyButton } from '@/components/receiving/label-identify/LabelIdentifyButton';
import { SerialCard } from '@/components/receiving/workspace/SerialCard';
import { useUnmatchedItems } from './unmatched-items/useUnmatchedItems';
import { UnmatchedLineRow } from './unmatched-items/UnmatchedLineRow';
import type { UnmatchedItemsSectionProps } from './unmatched-items/unmatched-items-shared';

export type {
  UnfoundLine,
  UnmatchedLineRenderHelpers,
  UnmatchedItemsSectionProps,
} from './unmatched-items/unmatched-items-shared';

export function UnmatchedItemsSection(props: UnmatchedItemsSectionProps) {
  const {
    receivingId,
    staffId,
    receivingTypeHint = 'PO',
    onFileReturnClaim,
    onActiveConditionChange,
    renderLineActions,
    showSerialScan = true,
    onOpenInUnbox,
  } = props;

  const c = useUnmatchedItems(props);

  return (
    <WorkspaceCard
      label={`PO items · ${c.lines.length}`}
      actions={
        <div className="flex items-center gap-1.5">
          {c.assignedBox ? (
            <HandlingUnitChip
              handlingUnitId={c.assignedBox.id}
              code={c.assignedBox.code}
              unitCount={c.assignedBox.total}
              dense
            />
          ) : null}
          {onOpenInUnbox ? (
            <button
              type="button"
              onClick={onOpenInUnbox}
              title="Open this carton in unbox mode (serial scan, photos, receive)"
              className="flex h-6 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 text-caption font-bold uppercase tracking-wider text-blue-700 hover:bg-blue-100"
            >
              <PackageOpen className="h-3 w-3" />
              Open in unbox
            </button>
          ) : null}
          {/* Repair-service linking is retired here — it now lives in the triage
              Smart-Matching "Repair Service / Trade in" tab. */}
          <button
            type="button"
            onClick={() => c.setAddOpen(true)}
            aria-label="Add to carton"
            title="Add to carton — internal catalog item, web search, or a handling-unit box"
            className="flex h-6 w-6 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      }
    >
      <div className="space-y-2">
        {/* Primary entry for an unfound carton: scan a serial. On a shipped-serial
            match we pull the product details and create + populate the line — no
            manual Add-item step. Rendered as a regular unbox serial card (white
            card chrome + condition pills), not a themed callout. */}
        {showSerialScan ? (
          <SerialCard
            saved={[]}
            expected={null}
            isSubmitting={c.returnScanBusy}
            showSavedChips={false}
            condition={c.cartonScanCondition}
            onConditionChange={(next) => {
              c.setCartonScanCondition(next);
              onActiveConditionChange?.(next);
            }}
            onAdd={(sn) => c.handleReturnSerialScan(sn)}
            resultSlot={
              // Importing loader — the only feedback surface for the scan.
              // On success the imported line row below (and the bound PO# /
              // platform chips above) ARE the result; no match band.
              c.returnScanBusy ? (
                <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-caption font-bold uppercase tracking-wider text-gray-600">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                  Matching serial — importing the sales order…
                </div>
              ) : undefined
            }
          />
        ) : null}
        {/* Identify an item by photographing its printed label. The LAN vision box
            OCRs the Bose model, the server resolves it to a catalog SKU, and the
            confirmed candidate is added via the same add-unmatched-line path the
            CartonAddPopover uses. Hidden when no vision box is configured. */}
        <LabelIdentifyButton
          onConfirm={(cand) =>
            c.handleAddLine({
              sku_platform_id_row: null,
              sku_catalog_id: cand.sku_catalog_id,
              sku: cand.sku ?? '',
              item_name: cand.product_title ?? cand.item_name ?? cand.model,
              image_url: cand.image_url,
            })
          }
        />
        {c.lines.map((line) => (
          <UnmatchedLineRow
            key={line.id}
            line={line}
            receivingId={receivingId}
            staffId={staffId}
            receivingType={receivingTypeHint}
            onConditionChange={c.handleConditionChange}
            onRemove={c.handleRemoveLine}
            onFileReturnClaim={onFileReturnClaim}
            renderActions={
              renderLineActions
                ? (helpers) => renderLineActions(line, helpers)
                : undefined
            }
            refresh={c.refreshLines}
          />
        ))}
      </div>

      {/* Unified add popover: Item (internal catalog) · Web (eBay Browse) · Box
          (handling-unit LPN). Replaces the old standalone "+ Add item". */}
      {c.addOpen ? (
        <CartonAddPopover
          tabs={['item', 'web', 'box']}
          unitIds={c.cartonUnitIds}
          onAddLine={c.handleAddLine}
          onAssignedBox={c.setAssignedBox}
          onClose={() => c.setAddOpen(false)}
        />
      ) : null}

    </WorkspaceCard>
  );
}
