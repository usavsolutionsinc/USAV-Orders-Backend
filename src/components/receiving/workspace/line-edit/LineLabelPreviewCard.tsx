'use client';

import { useState } from 'react';
import { WorkspaceCard } from '@/design-system/components';
import { IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Pencil } from '@/components/Icons';
import { ReceivingPoLabelPreview } from '../ReceivingPoLabelPreview';
import { ReceivingProductLabelPreview } from '../ReceivingProductLabelPreview';
import type { ReceivingLabelPayload } from '../receiving-label-helpers';
import { LabelEditPopover, type LabelEditDraft } from './LabelEditPopover';

/**
 * Inline preview of the label that "Print · receive" will produce. Shows the
 * PO/receiving label when the carton has a scan value; otherwise falls back to
 * a product (SKU) label preview. Renders nothing when neither is available.
 *
 * For the PO label, a pencil in the header opens {@link LabelEditPopover} to
 * hand-edit the printed face (platform / notes / condition / reference / date)
 * and print a one-off custom label — built for unfound cartons that need info
 * filled in manually. The product-label branch has no editor (it's a SKU
 * label, not the carton face).
 */
export function LineLabelPreviewCard({
  scanValue,
  labelPayload,
  sku,
  itemName,
  serialNumber,
  labelDraftDefaults,
  buildLabelPayload,
  onApplyAndPrint,
}: {
  scanValue: string;
  labelPayload: ReceivingLabelPayload;
  sku: string | null | undefined;
  itemName: string | null | undefined;
  serialNumber: string;
  /** Seed values for the Edit-label popover. */
  labelDraftDefaults: LabelEditDraft;
  /** Assembles the exact payload a draft previews + prints. */
  buildLabelPayload: (draft: LabelEditDraft) => ReceivingLabelPayload;
  /** Persist (where it can) + apply the print-time override + print. */
  onApplyAndPrint: (draft: LabelEditDraft) => void;
}) {
  const [editorOpen, setEditorOpen] = useState(false);

  if (!scanValue && !sku) return null;
  return (
    <>
      <WorkspaceCard
        variant="glass"
        label="Label"
        actions={
          scanValue ? (
            <HoverTooltip label="Edit label — custom print" asChild>
              <IconButton
                icon={<Pencil className="h-4 w-4" />}
                ariaLabel="Edit label"
                tone="accent"
                onClick={() => setEditorOpen(true)}
              />
            </HoverTooltip>
          ) : undefined
        }
      >
        {/* Themed frame matching the testing/products LabelPreviewCard so all label
            previews read identically. The label face inside is theme-aware (dark
            card + inverted barcode in dark mode); print stays black-on-white. */}
        <div className="rounded border border-border-soft bg-surface-card px-2 py-2 shadow-sm">
          {scanValue ? (
            <ReceivingPoLabelPreview {...labelPayload} embedded />
          ) : sku ? (
            <ReceivingProductLabelPreview
              sku={sku}
              title={itemName ?? ''}
              serialNumber={serialNumber}
              embedded
            />
          ) : null}
        </div>
      </WorkspaceCard>

      {scanValue ? (
        <LabelEditPopover
          open={editorOpen}
          defaults={labelDraftDefaults}
          buildPayload={buildLabelPayload}
          onApplyAndPrint={onApplyAndPrint}
          onClose={() => setEditorOpen(false)}
        />
      ) : null}
    </>
  );
}
